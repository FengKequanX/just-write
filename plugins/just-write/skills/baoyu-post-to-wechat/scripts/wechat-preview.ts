import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertMarkdown } from './md-to-wechat.ts';
import { buildWechatBodyImageTag } from './wechat-typography.ts';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 生成可离线查看的手机宽度预览，不连接公众号或保存草稿。 */
export async function createWechatPreview(
  markdownPath: string,
  outputPath: string,
  options: { theme?: string; color?: string; citeStatus?: boolean } = {},
): Promise<{ previewPath: string; warnings: string[] }> {
  const previewPath = path.resolve(outputPath);
  if (previewPath === path.resolve(markdownPath)) throw new Error('预览路径不能覆盖文章原稿');
  const converted = await convertMarkdown(markdownPath, options);
  try {
    fs.mkdirSync(path.dirname(previewPath), { recursive: true });
    const assetsName = `${path.basename(previewPath, path.extname(previewPath))}.assets`;
    const assetsDir = path.join(path.dirname(previewPath), assetsName);
    let article = fs.readFileSync(converted.htmlPath, 'utf8');
    for (const [index, image] of converted.contentImages.entries()) {
      fs.mkdirSync(assetsDir, { recursive: true });
      const name = `image-${index + 1}${path.extname(image.localPath) || '.png'}`;
      fs.copyFileSync(image.localPath, path.join(assetsDir, name));
      const url = `${encodeURIComponent(assetsName)}/${encodeURIComponent(name)}`;
      article = article.split(image.placeholder).join(buildWechatBodyImageTag(url));
    }
    // 预览宽度以整个手机阅读视口计算，正文保留实际转换结果的内联样式。
    article = article.replace('</head>', '<style>html{margin:0;background:#FBFAF7}body{margin:0;box-sizing:border-box}*,*::before,*::after{box-sizing:border-box}</style></head>');
    const warningList = converted.readingWarnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(converted.title)} · 公众号预览</title><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#f2efe9;color:#17171b;font:16px/1.6 system-ui,sans-serif}h1{font-size:22px;margin:0 0 8px}p{margin:8px 0}nav{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}button{font:inherit;padding:6px 12px;border:1px solid #bdb7af;border-radius:6px;background:white;cursor:pointer}button[aria-pressed=true]{color:white;background:#17171b}iframe{display:block;width:min(var(--reader-width,390px),100%);border:0;margin:auto;min-height:600px;background:#FBFAF7}button:focus-visible{outline:3px solid #2563eb;outline-offset:3px}
    </style></head><body><h1>${escapeHtml(converted.title)}</h1><p>本地预览采用公众号转换后的样式；微信客户端的字体和样式过滤仍需在草稿中核对。</p><nav aria-label="手机阅读宽度"><button data-width="360" aria-pressed="false">手机 360px</button><button data-width="390" aria-pressed="true">手机 390px</button><button data-width="430" aria-pressed="false">手机 430px</button></nav>${warningList ? `<details><summary>需要检查的阅读问题</summary><ul>${warningList}</ul></details>` : ''}<iframe title="公众号正文预览" srcdoc="${escapeHtml(article)}"></iframe><script>
    const reader=document.querySelector('iframe');
    const fit=()=>{
      const doc=reader.contentDocument;const body=doc?.body;const output=doc?.getElementById('output')||body?.firstElementChild;
      if(output)reader.style.height=Math.max(600,Math.ceil(output.getBoundingClientRect().bottom+parseFloat(getComputedStyle(body).paddingBottom||'0')+8))+'px';
    };
    const resize=()=>{reader.getBoundingClientRect();fit();};
    reader.addEventListener('load',async()=>{await reader.contentDocument.fonts.ready;resize();new ResizeObserver(fit).observe(reader.contentDocument.getElementById('output')||reader.contentDocument.body);});
    window.addEventListener('resize',resize);
    document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
      reader.style.setProperty('--reader-width',button.dataset.width+'px');
      document.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
      resize();setTimeout(resize,0);
    }));
    </script></body></html>`;
    fs.writeFileSync(previewPath, html, 'utf8');
    return { previewPath, warnings: converted.readingWarnings };
  } finally {
    const tempDir = path.dirname(converted.htmlPath);
    // 仅清理转换器在系统临时目录中为本次预览创建的目录。
    if (path.dirname(tempDir) === path.resolve(os.tmpdir()) && path.basename(tempDir).startsWith('wechat-article-images-')) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('用法：bun wechat-preview.ts <文章.md> --out <预览.html> [--theme default] [--color 色值] [--no-cite]');
  } else {
    try {
      const markdownPath = args.shift()!;
      let outputPath = `${markdownPath.replace(/\.md$/i, '')}.preview.html`;
      const options: { theme?: string; color?: string; citeStatus?: boolean } = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--out' && args[i + 1]) outputPath = args[++i]!;
        else if (args[i] === '--theme' && args[i + 1]) options.theme = args[++i];
        else if (args[i] === '--color' && args[i + 1]) options.color = args[++i];
        else if (args[i] === '--no-cite') options.citeStatus = false;
        else throw new Error(`未知或不完整的参数：${args[i]}`);
      }
      if (path.resolve(outputPath) === path.resolve(markdownPath)) throw new Error('预览路径不能覆盖文章原稿');
      console.log(JSON.stringify(await createWechatPreview(markdownPath, outputPath, options), null, 2));
    } catch (error) {
      console.error(`预览生成失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
