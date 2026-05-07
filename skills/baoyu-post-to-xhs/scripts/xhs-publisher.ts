import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium, type BrowserContext, type Page } from 'playwright';

// --- Constants ---

const XHS_CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';
const DEFAULT_PROFILE_DIR = '~/.baoyu-skills/xhs-chrome-profile';
const LOGIN_TIMEOUT_MS = 120_000;

// --- Types ---

interface PublishOptions {
  imagesDir: string;
  title?: string;
  description?: string;
  profileDir: string;
  dryRun: boolean;
}

// --- Caption Loading ---

interface CaptionData {
  title: string;
  description: string;
}

function loadCaption(imagesDir: string, overrides: { title?: string; description?: string }): CaptionData {
  const captionPath = path.join(imagesDir, 'caption.md');

  if (fs.existsSync(captionPath)) {
    const content = fs.readFileSync(captionPath, 'utf-8');
    const lines = content.split('\n');

    const title = overrides.title || lines[0]?.trim() || '未命名';
    const descLines = lines.slice(1).filter((l) => !l.startsWith('#') && !l.startsWith('—'));
    const description = overrides.description || descLines.join('\n').trim() || '';

    return { title: title.slice(0, 20), description: description.slice(0, 1000) };
  }

  return {
    title: (overrides.title || '未命名').slice(0, 20),
    description: (overrides.description || '').slice(0, 1000),
  };
}

// --- Image Discovery ---

function discoverImages(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Images directory not found: ${dir}`);
  }

  const entries = fs.readdirSync(dir);
  const images = entries
    .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    .sort()
    .map((f) => path.resolve(dir, f));

  if (images.length === 0) {
    throw new Error(`No images found in ${dir}`);
  }

  if (images.length > 20) {
    console.log(`[xhs-publisher] Warning: ${images.length} images found, using first 20 (XHS limit)`);
    return images.slice(0, 20);
  }

  return images;
}

// --- Browser Setup ---

function resolveProfileDir(profileDir: string): string {
  const expanded = profileDir.startsWith('~')
    ? profileDir.replace('~', process.env.HOME || process.env.USERPROFILE || '')
    : profileDir;
  return path.resolve(expanded);
}

async function launchBrowser(profileDir: string): Promise<BrowserContext> {
  const resolved = resolveProfileDir(profileDir);
  fs.mkdirSync(resolved, { recursive: true });

  console.log(`[xhs-publisher] Launching browser (profile: ${resolved})`);

  const context = await chromium.launchPersistentContext(resolved, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  return context;
}

// --- Login ---

async function waitForLogin(page: Page): Promise<void> {
  const currentUrl = page.url();

  if (currentUrl.includes('/publish/publish') && !currentUrl.includes('login')) {
    console.log('[xhs-publisher] Already logged in');
    return;
  }

  console.log('[xhs-publisher] Waiting for login... Please scan QR code if prompted.');

  try {
    await page.waitForURL('**/publish/publish', {
      timeout: LOGIN_TIMEOUT_MS,
    });
    console.log('[xhs-publisher] Login successful');
  } catch {
    throw new Error('Login timed out. Please scan QR code within 120 seconds.');
  }
}

// --- Image Upload ---

async function uploadImages(page: Page, imagePaths: string[]): Promise<void> {
  console.log(`[xhs-publisher] Uploading ${imagePaths.length} images...`);

  const selectors = [
    'input[type="file"][accept*="image"]',
    'input[type="file"][multiple]',
    'input[type="file"]',
  ];

  let fileInput = null;
  for (const sel of selectors) {
    fileInput = await page.$(sel);
    if (fileInput) {
      console.log(`[xhs-publisher] Found file input: ${sel}`);
      break;
    }
  }

  if (!fileInput) {
    console.log('[xhs-publisher] File input not visible, clicking upload area...');
    const uploadArea = await page.$(
      '.upload-wrapper, .upload-area, [class*="upload"], [class*="image-upload"]',
    );
    if (uploadArea) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10_000 }),
        uploadArea.click(),
      ]);
      await fileChooser.setFiles(imagePaths);
      console.log('[xhs-publisher] Images uploaded via file chooser');
      return;
    }

    throw new Error('Could not find image upload input or area');
  }

  await fileInput.setInputFiles(imagePaths);
  console.log('[xhs-publisher] Images uploaded via file input');

  await page.waitForTimeout(3000);
  for (let i = 0; i < 15; i++) {
    const uploading = await page.$('[class*="uploading"], [class*="loading"]');
    if (!uploading) break;
    await page.waitForTimeout(2000);
  }

  console.log('[xhs-publisher] All images uploaded');
}

// --- Form Filling ---

async function fillTitle(page: Page, title: string): Promise<void> {
  console.log(`[xhs-publisher] Filling title: "${title}"`);

  const selectors = [
    '#title',
    'input[placeholder*="标题"]',
    'input[placeholder*="title"]',
    '.title-input input',
    'input[maxlength="20"]',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      await el.fill('');
      await el.fill(title);
      await el.dispatchEvent('input');
      console.log(`[xhs-publisher] Title filled via: ${sel}`);
      return;
    }
  }

  throw new Error('Title input not found');
}

async function fillDescription(page: Page, description: string): Promise<void> {
  console.log(`[xhs-publisher] Filling description (${description.length} chars)`);

  const selectors = [
    '.ql-editor',
    'textarea[placeholder*="描述"]',
    'textarea[placeholder*="正文"]',
    '[contenteditable="true"]',
    'textarea',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      const tag = await el.evaluate((e) => e.tagName.toLowerCase());

      if (tag === 'textarea' || tag === 'input') {
        await el.fill(description);
      } else {
        await el.click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(description, { delay: 10 });
      }

      await el.dispatchEvent('input');
      console.log(`[xhs-publisher] Description filled via: ${sel}`);
      return;
    }
  }

  console.log('[xhs-publisher] Warning: description input not found, skipping');
}

// --- Publishing ---

async function clickPublish(page: Page): Promise<void> {
  console.log('[xhs-publisher] Clicking publish...');

  const selectors = [
    'button:has-text("发布")',
    'button:has-text("发布笔记")',
    '.publish-btn',
    '[class*="publish"] button',
  ];

  for (const sel of selectors) {
    const btn = await page.$(sel);
    if (btn) {
      const isVisible = await btn.isVisible();
      if (isVisible) {
        await btn.click();
        console.log(`[xhs-publisher] Publish clicked via: ${sel}`);
        return;
      }
    }
  }

  throw new Error('Publish button not found');
}

async function verifyPublish(page: Page): Promise<boolean> {
  await page.waitForTimeout(3000);

  const url = page.url();
  if (!url.includes('/publish/publish')) {
    console.log('[xhs-publisher] Page navigated away — publish likely succeeded');
    return true;
  }

  const toast = await page.$('.el-message, .toast, [class*="success"], [class*="message"]');
  if (toast) {
    const text = await toast.textContent();
    console.log(`[xhs-publisher] Toast message: ${text}`);
    return text?.includes('成功') || text?.includes('success') || false;
  }

  return false;
}

// --- Main Publish Flow ---

async function publishToXhs(options: PublishOptions): Promise<void> {
  const { imagesDir, profileDir, dryRun } = options;
  const imagePaths = discoverImages(imagesDir);
  const caption = loadCaption(imagesDir, {
    title: options.title,
    description: options.description,
  });

  console.log(`[xhs-publisher] Title: "${caption.title}"`);
  console.log(`[xhs-publisher] Description: ${caption.description.length} chars`);
  console.log(`[xhs-publisher] Images: ${imagePaths.length}`);

  if (dryRun) {
    console.log('\n[xhs-publisher] DRY RUN — skipping actual publish');
    console.log(`  Title: ${caption.title}`);
    console.log(`  Description: ${caption.description.slice(0, 100)}...`);
    console.log(`  Images: ${imagePaths.map((p) => path.basename(p)).join(', ')}`);
    return;
  }

  const context = await launchBrowser(profileDir);

  try {
    const page = context.pages()[0] || (await context.newPage());

    await page.goto(XHS_CREATOR_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await waitForLogin(page);
    await page.waitForTimeout(1000);

    if (!page.url().includes('/publish/publish')) {
      await page.goto(XHS_CREATOR_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    await uploadImages(page, imagePaths);
    await page.waitForTimeout(1000);

    await fillTitle(page, caption.title);
    await fillDescription(page, caption.description);
    await page.waitForTimeout(500);

    await clickPublish(page);

    const success = await verifyPublish(page);
    if (success) {
      console.log('[xhs-publisher] Published successfully!');
    } else {
      console.log('[xhs-publisher] Publish result unclear — please verify manually');
    }
  } finally {
    await context.close();
  }
}

// --- CLI ---

function printUsage(): never {
  console.log(`Publish carousel images to Xiaohongshu (小红书)

Usage:
  bun xhs-publisher.ts --images <dir> [options]

Options:
  --images <dir>    Directory containing carousel images
  --title <text>    Note title (max 20 chars, from caption.md if omitted)
  --desc <text>     Note description (from caption.md if omitted)
  --profile <dir>   Chrome profile path (default: ~/.baoyu-skills/xhs-chrome-profile)
  --dry-run         Preview without publishing
  --help            Show this help

Examples:
  bun xhs-publisher.ts --images ./xhs-images/
  bun xhs-publisher.ts --images ./xhs-images/ --title "测试标题" --dry-run
  bun xhs-publisher.ts --images ./xhs-images/ --profile ~/my-xhs-profile
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) printUsage();

  let imagesDir: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let profileDir = DEFAULT_PROFILE_DIR;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--images' && args[i + 1]) {
      imagesDir = args[++i];
    } else if (arg === '--title' && args[i + 1]) {
      title = args[++i];
    } else if (arg === '--desc' && args[i + 1]) {
      description = args[++i];
    } else if (arg === '--profile' && args[i + 1]) {
      profileDir = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!imagesDir) {
    console.error('Error: --images <dir> is required');
    process.exit(1);
  }

  const absImagesDir = path.isAbsolute(imagesDir)
    ? imagesDir
    : path.resolve(process.cwd(), imagesDir);

  await publishToXhs({
    imagesDir: absImagesDir,
    title,
    description,
    profileDir,
    dryRun,
  });
}

await main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
