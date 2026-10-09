import fs from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  CdpConnection,
  findChromeExecutable,
  getDefaultProfileDir,
  getAccountProfileDir,
  launchChrome,
  sleep,
} from './cdp.ts';
import { loadWechatExtendConfig, resolveAccount } from './wechat-extend-config.ts';
import { platformExitCode, type PlatformOperationResult } from '../../../lib/platform-result';
import { finishBrowserDraft } from './wechat-save-draft';
import { parseBrowserArgs, readWechatMetadata, ensureTitleAgreement } from './wechat-cli';

const WECHAT_URL = 'https://mp.weixin.qq.com/';

interface MarkdownMeta {
  title: string;
  author: string;
  content: string;
}

function parseMarkdownFile(filePath: string): MarkdownMeta {
  const text = fs.readFileSync(filePath, 'utf-8');
  let title = '';
  let author = '';
  let content = '';

  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const fm = fmMatch[1]!;
    const titleMatch = fm.match(/^title:\s*(.+)$/m);
    if (titleMatch) title = titleMatch[1]!.trim().replace(/^["']|["']$/g, '');
    const authorMatch = fm.match(/^author:\s*(.+)$/m);
    if (authorMatch) author = authorMatch[1]!.trim().replace(/^["']|["']$/g, '');
  }

  const bodyText = fmMatch ? text.slice(fmMatch[0].length) : text;

  if (!title) {
    const h1Match = bodyText.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1]!.trim();
  }

  const lines = bodyText.split('\n');
  const paragraphs: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('![')) continue;
    if (trimmed.startsWith('---')) continue;
    paragraphs.push(trimmed);
  }
  content = paragraphs.join('\n');

  return { title, author, content };
}

async function loadImagesFromDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const images = entries
    .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
    .sort()
    .map(f => path.join(dir, f));
  return images;
}

export interface WeChatBrowserOptions {
  title?: string;
  content?: string;
  images?: string[];
  imagesDir?: string;
  markdownFile?: string;
  submit?: boolean;
  timeoutMs?: number;
  profileDir?: string;
  chromePath?: string;
  account?: string;
}

export async function postToWeChat(options: WeChatBrowserOptions): Promise<PlatformOperationResult> {
  const { submit = false, timeoutMs = 120_000, profileDir = getDefaultProfileDir() } = options;

  let title = options.title || '';
  let content = options.content || '';
  let images = options.images || [];

  if (options.markdownFile) {
    const absPath = path.isAbsolute(options.markdownFile) ? options.markdownFile : path.resolve(process.cwd(), options.markdownFile);
    if (!fs.existsSync(absPath)) throw new Error(`Markdown file not found: ${absPath}`);
    const meta = parseMarkdownFile(absPath);
    if (!title) title = meta.title;
    if (!content) content = meta.content;
    console.log(`[wechat-browser] Parsed markdown: title="${meta.title}", content=${meta.content.length} chars`);
  }

  if (options.imagesDir) {
    const absDir = path.isAbsolute(options.imagesDir) ? options.imagesDir : path.resolve(process.cwd(), options.imagesDir);
    if (!fs.existsSync(absDir)) throw new Error(`Images directory not found: ${absDir}`);
    images = await loadImagesFromDir(absDir);
    console.log(`[wechat-browser] Found ${images.length} images in ${absDir}`);
  }

  if (title.length > 20) {
    throw new Error(`标题超出 20 字符：${title.length}；请明确调整，不自动压缩`);
  }

  if (content.length > 1000) {
    throw new Error(`正文超出 1000 字符：${content.length}；请明确调整，不自动截断`);
  }

  if (!title) throw new Error('Title is required (use --title or --markdown)');
  if (!content) throw new Error('Content is required (use --content or --markdown)');
  if (images.length === 0) throw new Error('At least one image is required (use --image or --images)');

  for (const img of images) {
    if (!fs.existsSync(img)) throw new Error(`Image not found: ${img}`);
  }

  const chromePath = findChromeExecutable(options.chromePath);
  if (!chromePath) throw new Error('Chrome not found. Set WECHAT_BROWSER_CHROME_PATH env var.');

  console.log(`[wechat-browser] Launching Chrome (profile: ${profileDir})`);

  const launched = await launchChrome(WECHAT_URL, profileDir, chromePath);
  const chrome = launched.chrome;

  let cdp: CdpConnection | null = null;

  try {
    cdp = launched.cdp;

    const targets = await cdp.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
    let pageTarget = targets.targetInfos.find((t) => t.type === 'page' && t.url.includes('mp.weixin.qq.com'));

    if (!pageTarget) {
      const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: WECHAT_URL });
      pageTarget = { targetId, url: WECHAT_URL, type: 'page' };
    }

    let { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });

    await cdp.send('Page.enable', {}, { sessionId });
    await cdp.send('Runtime.enable', {}, { sessionId });
    await cdp.send('DOM.enable', {}, { sessionId });

    console.log('[wechat-browser] Waiting for page load...');
    await sleep(3000);

    const checkLoginStatus = async (): Promise<boolean> => {
      const result = await cdp!.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `window.location.href`,
        returnByValue: true,
      }, { sessionId });
      return result.result.value.includes('/cgi-bin/home');
    };

    const waitForLogin = async (): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await checkLoginStatus()) return true;
        await sleep(2000);
      }
      return false;
    };

    let isLoggedIn = await checkLoginStatus();
    if (!isLoggedIn) {
      console.log('[wechat-browser] Not logged in. Please scan QR code to log in...');
      isLoggedIn = await waitForLogin();
      if (!isLoggedIn) throw new Error('Timed out waiting for login. Please log in first.');
    }
    console.log('[wechat-browser] Logged in.');

    await sleep(2000);

    console.log('[wechat-browser] Looking for "贴图" menu...');
    const menuResult = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: `
        const menuItems = document.querySelectorAll('.new-creation__menu .new-creation__menu-item');
        const count = menuItems.length;
        const texts = Array.from(menuItems).map(m => m.querySelector('.new-creation__menu-title')?.textContent?.trim() || m.textContent?.trim() || '');
        JSON.stringify({ count, texts });
      `,
      returnByValue: true,
    }, { sessionId });
    console.log(`[wechat-browser] Menu items: ${menuResult.result.value}`);

    const getTargets = async () => {
      return await cdp!.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
    };

    const initialTargets = await getTargets();
    const initialIds = new Set(initialTargets.targetInfos.map(t => t.targetId));
    console.log(`[wechat-browser] Initial targets count: ${initialTargets.targetInfos.length}`);

    console.log('[wechat-browser] Finding "贴图" menu position...');
    const menuPos = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: `
        (function() {
          const menuItems = document.querySelectorAll('.new-creation__menu .new-creation__menu-item');
          console.log('Found menu items:', menuItems.length);
          for (const item of menuItems) {
            const title = item.querySelector('.new-creation__menu-title');
            const text = title?.textContent?.trim() || '';
            console.log('Menu item text:', text);
            if (text === '图文' || text === '贴图') {
              item.scrollIntoView({ block: 'center' });
              const rect = item.getBoundingClientRect();
              console.log('Found 贴图，rect:', JSON.stringify(rect));
              return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height });
            }
          }
          return 'null';
        })()
      `,
      returnByValue: true,
    }, { sessionId });
    console.log(`[wechat-browser] Menu position: ${menuPos.result.value}`);

    const pos = menuPos.result.value !== 'null' ? JSON.parse(menuPos.result.value) : null;
    if (!pos) throw new Error('贴图 menu not found or not visible');

    console.log('[wechat-browser] Clicking "贴图" menu with mouse events...');
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: pos.x,
      y: pos.y,
      button: 'left',
      clickCount: 1,
    }, { sessionId });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: pos.x,
      y: pos.y,
      button: 'left',
      clickCount: 1,
    }, { sessionId });

    console.log('[wechat-browser] Waiting for editor...');
    await sleep(3000);

    const waitForEditor = async (): Promise<{ targetId: string; isNewTab: boolean } | null> => {
      const start = Date.now();

      while (Date.now() - start < 30_000) {
        const targets = await getTargets();
        const pageTargets = targets.targetInfos.filter(t => t.type === 'page');

        for (const t of pageTargets) {
          console.log(`[wechat-browser] Target: ${t.url}`);
        }

        const newTab = pageTargets.find(t => !initialIds.has(t.targetId) && t.url.includes('mp.weixin.qq.com'));
        if (newTab) {
          console.log(`[wechat-browser] Found new tab: ${newTab.url}`);
          return { targetId: newTab.targetId, isNewTab: true };
        }

        const editorTab = pageTargets.find(t => t.url.includes('appmsg'));
        if (editorTab) {
          console.log(`[wechat-browser] Found editor tab: ${editorTab.url}`);
          return { targetId: editorTab.targetId, isNewTab: !initialIds.has(editorTab.targetId) };
        }

        const currentUrl = await cdp!.send<{ result: { value: string } }>('Runtime.evaluate', {
          expression: `window.location.href`,
          returnByValue: true,
        }, { sessionId });
        console.log(`[wechat-browser] Current page URL: ${currentUrl.result.value}`);

        if (currentUrl.result.value.includes('appmsg')) {
          console.log(`[wechat-browser] Current page navigated to editor`);
          return { targetId: pageTarget!.targetId, isNewTab: false };
        }

        await sleep(1000);
      }
      return null;
    };

    const editorInfo = await waitForEditor();
    if (!editorInfo) {
      const finalTargets = await getTargets();
      console.log(`[wechat-browser] Final targets: ${finalTargets.targetInfos.filter(t => t.type === 'page').map(t => t.url).join(', ')}`);
      throw new Error('Editor not found.');
    }

    if (editorInfo.isNewTab) {
      console.log('[wechat-browser] Switching to editor tab...');
      const editorSession = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: editorInfo.targetId, flatten: true });
      sessionId = editorSession.sessionId;

      await cdp.send('Page.enable', {}, { sessionId });
      await cdp.send('Runtime.enable', {}, { sessionId });
      await cdp.send('DOM.enable', {}, { sessionId });
    } else {
      console.log('[wechat-browser] Editor opened in current page');
    }

    await cdp.send('Page.enable', {}, { sessionId });
    await cdp.send('Runtime.enable', {}, { sessionId });
    await cdp.send('DOM.enable', {}, { sessionId });

    await sleep(2000);

    console.log('[wechat-browser] Uploading all images at once...');
    const absolutePaths = images.map(p => path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));
    console.log(`[wechat-browser] Images: ${absolutePaths.join(', ')}`);

    // --- PRIMARY approach: intercept file chooser dialog ---
    let uploadSuccess = false;
    try {
      console.log('[wechat-browser] [primary] Enabling file chooser interception...');
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, { sessionId });

      // Set up listener for file chooser opened event BEFORE clicking
      const fileChooserPromise = new Promise<{ backendNodeId: number; mode: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('File chooser dialog not opened within 10s')), 10_000);
        cdp!.on('Page.fileChooserOpened', (params: unknown) => {
          clearTimeout(timeout);
          const p = params as { backendNodeId: number; mode: string };
          console.log(`[wechat-browser] [primary] File chooser opened: backendNodeId=${p.backendNodeId}, mode=${p.mode}`);
          resolve(p);
        });
      });

      // Trigger file chooser by calling .click() on the file input with userGesture
      const fileInputSelectors = [
        '.js_upload_btn_container input[type=file]',
        'input[type=file][multiple][accept*="image"]',
        'input[type=file][accept*="image"]',
        'input[type=file][multiple]',
        'input[type=file]',
      ];

      console.log('[wechat-browser] [primary] Clicking file input via JS .click() with userGesture...');
      const clickResult = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `
          (function() {
            const selectors = ${JSON.stringify(fileInputSelectors)};
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                el.click();
                return JSON.stringify({ clicked: sel });
              }
            }
            const debug = [];
            document.querySelectorAll('input[type=file]').forEach((inp, i) => {
              debug.push({ i, accept: inp.accept, multiple: inp.multiple, parentClass: inp.parentElement?.className?.slice(0, 60) });
            });
            return JSON.stringify({ error: 'no file input found', fileInputs: debug });
          })()
        `,
        returnByValue: true,
        userGesture: true,
      }, { sessionId });
      console.log(`[wechat-browser] [primary] Click result: ${clickResult.result.value}`);

      const clickStatus = JSON.parse(clickResult.result.value);
      if (clickStatus.error) {
        throw new Error(`File input not found: ${clickStatus.error}`);
      }

      // Wait for the file chooser event
      console.log('[wechat-browser] [primary] Waiting for file chooser dialog...');
      const chooser = await fileChooserPromise;

      console.log(`[wechat-browser] [primary] Setting files via backendNodeId=${chooser.backendNodeId}...`);
      await cdp.send('DOM.setFileInputFiles', {
        files: absolutePaths,
        backendNodeId: chooser.backendNodeId,
      }, { sessionId });
      console.log('[wechat-browser] [primary] Files set successfully via file chooser interception');
      uploadSuccess = true;
    } catch (primaryErr) {
      console.log(`[wechat-browser] [primary] File chooser approach failed: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`);
      // Disable interception before falling back
      try { await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }, { sessionId }); } catch {}
    }

    // --- FALLBACK approach: direct DOM.setFileInputFiles on nodeId ---
    if (!uploadSuccess) {
      console.log('[wechat-browser] [fallback] Trying direct DOM.setFileInputFiles...');
      const { root } = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', {}, { sessionId });

      const fileInputSelectors = [
        '.js_upload_btn_container input[type=file]',
        'input[type=file][multiple][accept*="image"]',
        'input[type=file][accept*="image"]',
        'input[type=file][multiple]',
        'input[type=file]',
      ];

      let nodeId = 0;
      for (const sel of fileInputSelectors) {
        const result = await cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, { sessionId });
        if (result.nodeId) {
          console.log(`[wechat-browser] [fallback] Found file input with selector: ${sel}`);
          nodeId = result.nodeId;
          break;
        }
      }

      if (!nodeId) throw new Error('File input not found with any selector');

      await cdp.send('DOM.setFileInputFiles', { nodeId, files: absolutePaths }, { sessionId });
      console.log('[wechat-browser] [fallback] Files set via nodeId');

      // Dispatch change event
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const selectors = ${JSON.stringify(fileInputSelectors)};
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return 'dispatched on ' + sel;
              }
            }
            return 'no input found for event dispatch';
          })()
        `,
        returnByValue: true,
      }, { sessionId });
      console.log('[wechat-browser] [fallback] Change event dispatched');
    }

    // Wait for images to upload
    console.log('[wechat-browser] Waiting for images to upload...');
    const targetCount = absolutePaths.length;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const uploadCheck = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            uploaded: document.querySelectorAll('.weui-desktop-upload__thumb, .pic_item, [class*=upload_thumb], [class*="pic_item"], [class*="upload__thumb"]').length,
            loading: document.querySelectorAll('[class*="upload_loading"], [class*="uploading"], .weui-desktop-upload__loading').length
          })
        `,
        returnByValue: true,
      }, { sessionId });
      const status = JSON.parse(uploadCheck.result.value);
      console.log(`[wechat-browser] Upload progress: ${status.uploaded}/${targetCount} (loading: ${status.loading})`);
      if (status.uploaded >= targetCount) break;
    }

    console.log('[wechat-browser] Filling title...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        const titleInput = document.querySelector('#title');
        if (titleInput) {
          titleInput.value = ${JSON.stringify(title)};
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          throw new Error('Title input not found');
        }
      `,
    }, { sessionId });
    await sleep(500);

    console.log('[wechat-browser] Filling content...');
    // Try ProseMirror editor first (new WeChat UI), then fallback to old editor
    const contentResult = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: `
        (function() {
          const contentHtml = ${JSON.stringify('<p>' + content.split('\n').filter(l => l.trim()).join('</p><p>') + '</p>')};

          // New UI: ProseMirror contenteditable
          const pm = document.querySelector('.ProseMirror[contenteditable=true]');
          if (pm) {
            pm.innerHTML = contentHtml;
            pm.dispatchEvent(new Event('input', { bubbles: true }));
            return 'ProseMirror: content set, length=' + pm.textContent.length;
          }

          // Old UI: .js_pmEditorArea
          const oldEditor = document.querySelector('.js_pmEditorArea');
          if (oldEditor) {
            return JSON.stringify({ type: 'old', x: oldEditor.getBoundingClientRect().x + 50, y: oldEditor.getBoundingClientRect().y + 20 });
          }

          return 'editor_not_found';
        })()
      `,
      returnByValue: true,
    }, { sessionId });

    const contentStatus = contentResult.result.value;
    console.log(`[wechat-browser] Content result: ${contentStatus}`);

    if (contentStatus === 'editor_not_found') {
      throw new Error('Content editor not found');
    }

    // Fallback: old editor uses keyboard simulation
    if (contentStatus.startsWith('{')) {
      const editorClickPos = JSON.parse(contentStatus);
      if (editorClickPos.type === 'old') {
        console.log('[wechat-browser] Using old editor with keyboard simulation...');
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: editorClickPos.x,
          y: editorClickPos.y,
          button: 'left',
          clickCount: 1,
        }, { sessionId });
        await sleep(50);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: editorClickPos.x,
          y: editorClickPos.y,
          button: 'left',
          clickCount: 1,
        }, { sessionId });
        await sleep(300);

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line!.length > 0) {
            await cdp.send('Input.insertText', { text: line }, { sessionId });
          }
          if (i < lines.length - 1) {
            await cdp.send('Input.dispatchKeyEvent', {
              type: 'keyDown',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
            }, { sessionId });
            await cdp.send('Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
            }, { sessionId });
          }
          await sleep(50);
        }
        console.log('[wechat-browser] Content typed via keyboard.');
      }
    }
    await sleep(500);

    return await finishBrowserDraft(submit, {
      evaluate: async expression => {
        const response = await cdp!.send<{ result: { value: unknown } }>('Runtime.evaluate', { expression, returnByValue: true }, { sessionId });
        return response.result.value;
      }, wait: sleep,
    }, { account: options.account, inputSummary: { title, contentLength: content.length, imageCount: images.length } });
  } finally {
    if (cdp) {
      cdp.close();
    }
    console.log('[wechat-browser] Done. Browser window left open.');
  }
}

function printUsage(): never {
  console.log(`将图文预填到微信编辑器；默认不保存。
用法：bun wechat-browser.ts [选项]
  --markdown <path>  提取标题与图文正文
  --title <text>     标题，最多 20 字符，超限报错
  --content <text>   正文，最多 1000 字符，超限报错
  --image <path>     图片，可重复
  --images <dir>     图片目录
  --profile <dir>    浏览器目录
  --account <alias>  明确目标账号
  --save-draft       明确保存草稿
  --submit           保存开关的兼容别名
  --json             JSON 结果，日志写入 stderr
  --help             帮助
退出码：0 预填完成；1 平台拒绝；2 参数/运行错误；3 保存或验证待核验。`);
  process.exit(0);
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) printUsage();

  const options = parseBrowserArgs(args, 'image');
  ensureTitleAgreement(readWechatMetadata(options.markdownFile), options.title);
  const extConfig = loadWechatExtendConfig();
  const resolved = resolveAccount(extConfig, options.accountAlias);
  if (!options.markdownFile && !options.title) throw new Error('需要 --title 或 --markdown');
  if (!options.markdownFile && !options.content) throw new Error('需要 --content 或 --markdown');
  if (!options.images.length && !options.imagesDir) throw new Error('需要 --image 或 --images');
  const originalLog = console.log;
  if (options.json) console.log = console.error;
  try {
    const result = await postToWeChat({ ...options,
      profileDir: options.profileDir ?? resolved.chrome_profile_path ?? (resolved.alias ? getAccountProfileDir(resolved.alias) : undefined),
      account: resolved.alias ?? resolved.source,
    });
    originalLog(JSON.stringify(result, null, 2)); return platformExitCode(result);
  } finally { console.log = originalLog; }
}

if (import.meta.main) await main().then(code => { process.exitCode = code; }).catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
});
