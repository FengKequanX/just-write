import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { marked } from 'marked';

// --- Types ---

interface AspectSize {
  width: number;
  height: number;
}

interface PageSection {
  type: 'cover' | 'content' | 'ending';
  title: string;
  bodyHtml: string;
  slug: string;
  tags?: string[];
  author?: string;
}

interface MarkdownSection {
  heading?: { depth: number; text: string };
  tokens: marked.Token[];
}

interface Frontmatter {
  title?: string;
  author?: string;
  description?: string;
  [key: string]: string | undefined;
}

// --- Constants ---

const ASPECT_SIZES: Record<string, AspectSize> = {
  '3:4': { width: 1080, height: 1440 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
};

const DEFAULT_ASPECT = '3:4';
const CONTENT_TOP_PAD = 72;
const CONTENT_BOTTOM_PAD = 100;
const PAGE_NUM_HEIGHT = 48;
const SECTION_TITLE_HEIGHT = 120;
const CHARS_PER_LINE = 30;
const LINE_HEIGHT_PX = 56; // 30px font * 1.85 line-height ≈ 56px per line
const IMG_EST_HEIGHT = 400;
const BLOCK_PADDING = 24;

// --- Chrome Discovery ---

function findChrome(): string {
  const envPaths = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  ].filter(Boolean);

  for (const p of envPaths) {
    if (p && fs.existsSync(p)) return p;
  }

  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const pf = process.env.ProgramFiles;
    const pf86 = process.env['ProgramFiles(x86)'];
    if (pf) candidates.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (pf86) candidates.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (local) candidates.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    // Edge (Chromium-based)
    if (pf) candidates.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (pf86) candidates.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));

    // Playwright's bundled Chromium — search recursively for chrome.exe
    const localAppData = local || '';
    const pwDir = path.join(localAppData, 'ms-playwright');
    if (fs.existsSync(pwDir)) {
      for (const entry of fs.readdirSync(pwDir)) {
        if (entry.startsWith('chromium') && !entry.includes('headless')) {
          const subDir = path.join(pwDir, entry);
          try {
            for (const sub of fs.readdirSync(subDir)) {
              const candidate = path.join(subDir, sub, 'chrome.exe');
              if (fs.existsSync(candidate)) candidates.push(candidate);
            }
          } catch { /* not a dir */ }
        }
      }
    }
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    // Playwright bundled
    const pwDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
    if (fs.existsSync(pwDir)) {
      for (const entry of fs.readdirSync(pwDir)) {
        if (entry.startsWith('chromium')) {
          candidates.push(path.join(pwDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
        }
      }
    }
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
    const pwDir = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (fs.existsSync(pwDir)) {
      for (const entry of fs.readdirSync(pwDir)) {
        if (entry.startsWith('chromium')) {
          candidates.push(path.join(pwDir, entry, 'chrome-linux', 'chrome'));
        }
      }
    }
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error(
    'Chrome not found. Set CHROME_PATH env var or install Google Chrome.\n' +
    'Download: https://www.google.com/chrome/',
  );
}

// --- Chrome Rendering ---

function renderWithChrome(
  htmlPath: string,
  outputPath: string,
  width: number,
  height: number,
): Promise<void> {
  const chrome = findChrome();
  const fileUrl = pathToFileURL(htmlPath).href;

  return new Promise<void>((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-software-rasterizer',
      `--window-size=${width},${height}`,
      '--default-background-color=00000000',
      '--hide-scrollbars',
      `--screenshot=${outputPath}`,
      fileUrl,
    ];

    const proc = spawn(chrome, args, { stdio: 'pipe' });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Chrome screenshot timed out for ${path.basename(htmlPath)}`));
    }, 30_000);

    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`Chrome exited with code ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// --- Utilities ---

function parseFrontmatter(text: string): { fm: Frontmatter; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { fm: {}, body: text };

  const fm: Frontmatter = {};
  for (const line of match[1]!.split('\n')) {
    const ci = line.indexOf(': ');
    if (ci > 0) {
      const key = line.slice(0, ci).trim();
      const val = line.slice(ci + 2).trim().replace(/^['"]|['"]$/g, '');
      if (val) fm[key] = val;
    }
  }

  return { fm, body: text.slice(match[0].length) };
}

function slugify(text: string): string {
  return text
    .replace(/[^\w一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .toLowerCase();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveImagePaths(html: string, baseDir: string): string {
  return html.replace(
    /(<img\s[^>]*src=["'])(?!https?:|data:|file:)([^"']+)/g,
    (_, prefix, src) => {
      const absolute = path.resolve(baseDir, src);
      return `${prefix}${pathToFileURL(absolute).href}`;
    },
  );
}

// --- Markdown Parsing ---

function splitByHeadings(tokens: marked.Token[]): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { tokens: [] };

  for (const token of tokens) {
    if (token.type === 'heading' && (token.depth === 1 || token.depth === 2)) {
      if (current.tokens.length > 0 || current.heading) {
        sections.push(current);
      }
      current = {
        heading: { depth: token.depth, text: token.text },
        tokens: [],
      };
    } else if (token.type !== 'hr') {
      current.tokens.push(token);
    }
  }

  if (current.tokens.length > 0 || current.heading) {
    sections.push(current);
  }

  return sections;
}

function buildPageSections(
  sections: MarkdownSection[],
  fm: Frontmatter,
  author: string,
  topicTags: string,
): PageSection[] {
  const pages: PageSection[] = [];
  let mainTitle = fm.title || '';
  let subtitle = fm.description || '';

  const h1 = sections.find((s) => s.heading?.depth === 1);
  if (h1) {
    mainTitle = mainTitle || h1.heading!.text;
    const firstP = h1.tokens.find((t) => t.type === 'paragraph');
    if (firstP && 'text' in firstP && !subtitle) {
      subtitle = firstP.text.slice(0, 100);
    }
  }
  if (!mainTitle) mainTitle = '未命名文章';

  pages.push({
    type: 'cover',
    title: mainTitle,
    bodyHtml: subtitle,
    slug: 'cover',
  });

  for (const section of sections) {
    if (section.heading?.depth === 1) {
      const bodyTokens = section.tokens.filter((t) => {
        if (t.type === 'paragraph' && 'text' in t && t.text.slice(0, 100) === subtitle) {
          return false;
        }
        return true;
      });
      if (bodyTokens.length > 0) {
        const html = marked.parse(bodyTokens.map((t) => t.raw).join('')) as string;
        if (html.trim()) {
          pages.push({ type: 'content', title: '', bodyHtml: html, slug: 'intro' });
        }
      }
    } else if (section.heading?.depth === 2) {
      const html = marked.parse(section.tokens.map((t) => t.raw).join('')) as string;
      pages.push({
        type: 'content',
        title: section.heading.text,
        bodyHtml: html,
        slug: slugify(section.heading.text),
      });
    } else if (!section.heading && section.tokens.length > 0) {
      const html = marked.parse(section.tokens.map((t) => t.raw).join('')) as string;
      if (html.trim()) {
        pages.push({ type: 'content', title: '', bodyHtml: html, slug: 'intro' });
      }
    }
  }

  const tags = topicTags
    ? topicTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  pages.push({
    type: 'ending',
    title: '',
    bodyHtml: '',
    slug: 'ending',
    tags,
    author: author || fm.author || '作者名',
  });

  return pages;
}

// --- HTML Generation ---

function loadCss(theme: string): string {
  const scriptDir = path.dirname(
    typeof import.meta.path === 'string'
      ? import.meta.path
      : process.argv[1] || import.meta.url.replace('file://', ''),
  );
  const cssPath = path.join(scriptDir, '..', 'themes', theme, 'style.css');
  try {
    return fs.readFileSync(cssPath, 'utf-8');
  } catch {
    console.error(`[md-to-xhs] Theme CSS not found: ${cssPath}`);
    return '';
  }
}

function buildCoverHtml(
  title: string,
  subtitle: string,
  author: string,
  css: string,
  pageNum: number,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="cover">
  <div class="cover-accent-glow"></div>
  <div class="cover-bg-shape"></div>
  <div class="title-area">
    <div class="brand">${escapeHtml(author)}</div>
    <div class="title">${escapeHtml(title)}</div>
    <div class="divider"></div>
    ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
  </div>
  <div class="cover-bottom-bar"></div>
  <div class="author">${escapeHtml(author)}</div>
  <div class="page-num">${pageNum}</div>
</body></html>`;
}

function buildContentHtml(
  sectionTitle: string,
  bodyHtml: string,
  css: string,
  pageNum: number,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="content">
  ${sectionTitle ? `<div class="section-title">${escapeHtml(sectionTitle)}</div>` : ''}
  <div class="body">${bodyHtml}</div>
  <div class="page-num">${pageNum}</div>
</body></html>`;
}

function buildEndingHtml(
  tags: string[],
  author: string,
  css: string,
  pageNum: number,
): string {
  const tagHtml = tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="ending">
  <div class="cta">感谢阅读</div>
  <div class="tags">
    ${tagHtml}
  </div>
  <div class="end-author">— <strong>${escapeHtml(author)}</strong></div>
  <div class="page-num">${pageNum}</div>
</body></html>`;
}

// --- Heuristic Content Splitting ---

function estimateHtmlHeight(html: string): number {
  // Count images
  const imgCount = (html.match(/<img\s/g) || []).length;

  // Count block-level elements for their padding
  const blockCount =
    (html.match(/<\/p>/g) || []).length +
    (html.match(/<\/h[1-6]>/g) || []).length +
    (html.match(/<\/blockquote>/g) || []).length +
    (html.match(/<\/ul>/g) || []).length +
    (html.match(/<\/ol>/g) || []).length +
    (html.match(/<\/pre>/g) || []).length;

  // Count code blocks (they're taller per line)
  const preCount = (html.match(/<\/pre>/g) || []).length;

  // Strip HTML tags to get text length
  const text = html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, 'x');
  const charCount = text.length;

  // Estimate lines from characters
  const textLines = Math.ceil(charCount / CHARS_PER_LINE);
  const textHeight = textLines * LINE_HEIGHT_PX;

  // Add image heights
  const imgHeight = imgCount * IMG_EST_HEIGHT;

  // Add block padding (between consecutive blocks)
  const blockPadding = blockCount > 1 ? (blockCount - 1) * BLOCK_PADDING : 0;

  // Code blocks use smaller font but more compact — already counted in charCount
  // Add a small bonus for pre blocks (background, padding)
  const preExtra = preCount * 48;

  return textHeight + imgHeight + blockPadding + preExtra;
}

function splitHtmlAtBlockBoundaries(html: string): string[] {
  const pattern = /(<\/(?:p|h[1-6]|blockquote|ul|ol|pre|div|table)>)\s*/gi;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    parts.push(html.slice(lastIndex, match.index + match[0].length));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < html.length) {
    parts.push(html.slice(lastIndex));
  }

  return parts.filter((p) => p.trim().length > 0);
}

function estimateContentPages(
  bodyHtml: string,
  availableHeight: number,
): string[] {
  const totalHeight = estimateHtmlHeight(bodyHtml);

  if (totalHeight <= availableHeight) {
    return [bodyHtml];
  }

  const blocks = splitHtmlAtBlockBoundaries(bodyHtml);
  if (blocks.length === 0) return [bodyHtml];

  const pages: string[] = [];
  let currentPage = '';
  let currentHeight = 0;
  const safeHeight = availableHeight * 0.85;

  for (const block of blocks) {
    const blockHeight = estimateHtmlHeight(block);

    if (currentHeight + blockHeight > safeHeight && currentPage.trim()) {
      pages.push(currentPage);
      currentPage = block;
      currentHeight = blockHeight;
    } else {
      currentPage += block;
      currentHeight += blockHeight;
    }
  }

  if (currentPage.trim()) {
    pages.push(currentPage);
  }

  return pages.length > 0 ? pages : [bodyHtml];
}

// --- Caption Generation ---

function generateCaption(
  title: string,
  body: string,
  author: string,
  fm: Frontmatter,
  topicTags: string,
): string {
  const truncatedTitle = title.length > 20 ? title.slice(0, 18) + '...' : title;

  const lines = body.split('\n').filter((l) => {
    const trimmed = l.trim();
    return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('![') && !trimmed.startsWith('---');
  });
  let description = lines.slice(0, 5).join(' ').slice(0, 300);
  if (!description) description = fm.description || '';

  const tags = topicTags
    ? topicTags
        .split(',')
        .map((t) => `#${t.trim()}`)
        .filter(Boolean)
    : [];

  return [
    truncatedTitle,
    '',
    description,
    '',
    tags.join(' '),
    '',
    `— ${author || '作者名'}`,
  ].join('\n');
}

// --- Main Render ---

interface RenderResult {
  images: string[];
  captionPath: string;
  title: string;
  totalPages: number;
}

async function render(
  markdownPath: string,
  outDir: string,
  theme: string,
  aspect: string,
  author: string,
  topicTags: string,
): Promise<RenderResult> {
  const size = ASPECT_SIZES[aspect] || ASPECT_SIZES[DEFAULT_ASPECT];
  const absMarkdown = path.resolve(markdownPath);
  const baseDir = path.dirname(absMarkdown);
  const content = fs.readFileSync(absMarkdown, 'utf-8');
  const { fm, body } = parseFrontmatter(content);
  const resolvedAuthor = author || fm.author || '作者名';

  const tokens = marked.lexer(body);
  const sections = splitByHeadings(tokens);
  const pages = buildPageSections(sections, fm, resolvedAuthor, topicTags);
  const css = loadCss(theme);

  fs.mkdirSync(outDir, { recursive: true });

  const images: string[] = [];
  let pageNum = 1;
  const tempFiles: string[] = [];

  try {
    for (const section of pages) {
      if (section.type === 'cover') {
        const html = resolveImagePaths(
          buildCoverHtml(section.title, section.bodyHtml, resolvedAuthor, css, pageNum),
          baseDir,
        );
        const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-cover.png`);
        const tmpHtml = path.join(os.tmpdir(), `xhs-cover-${Date.now()}.html`);
        fs.writeFileSync(tmpHtml, html);
        tempFiles.push(tmpHtml);
        await renderWithChrome(tmpHtml, imgPath, size.width, size.height);
        images.push(imgPath);
        pageNum++;
      } else if (section.type === 'ending') {
        const html = buildEndingHtml(section.tags || [], section.author || resolvedAuthor, css, pageNum);
        const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-ending.png`);
        const tmpHtml = path.join(os.tmpdir(), `xhs-ending-${Date.now()}.html`);
        fs.writeFileSync(tmpHtml, html);
        tempFiles.push(tmpHtml);
        await renderWithChrome(tmpHtml, imgPath, size.width, size.height);
        images.push(imgPath);
        pageNum++;
      } else {
        const rawHtml = resolveImagePaths(
          buildContentHtml(section.title, section.bodyHtml, css, pageNum),
          baseDir,
        );

        // Extract body content for splitting
        const bodyMatch = rawHtml.match(/<div class="body">([\s\S]*?)<\/div>\s*<div class="page-num">/);
        const fullBody = bodyMatch ? bodyMatch[1]! : section.bodyHtml;
        const titleHeight = section.title ? SECTION_TITLE_HEIGHT : 0;
        const availableHeight =
          size.height - CONTENT_TOP_PAD - CONTENT_BOTTOM_PAD - PAGE_NUM_HEIGHT - titleHeight;

        const chunks = estimateContentPages(fullBody, availableHeight);

        for (let i = 0; i < chunks.length; i++) {
          const chunkHtml = resolveImagePaths(
            buildContentHtml(i === 0 ? section.title : '', chunks[i]!, css, pageNum),
            baseDir,
          );
          const imgPath = path.join(
            outDir,
            `${String(pageNum).padStart(2, '0')}-content-${section.slug}.png`,
          );
          const tmpHtml = path.join(os.tmpdir(), `xhs-content-${Date.now()}-${i}.html`);
          fs.writeFileSync(tmpHtml, chunkHtml);
          tempFiles.push(tmpHtml);
          await renderWithChrome(tmpHtml, imgPath, size.width, size.height);
          images.push(imgPath);
          pageNum++;
        }
      }
    }
  } finally {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }

  const title = pages.find((p) => p.type === 'cover')?.title || fm.title || '未命名';
  const caption = generateCaption(title, body, resolvedAuthor, fm, topicTags);
  const captionPath = path.join(outDir, 'caption.md');
  fs.writeFileSync(captionPath, caption, 'utf-8');

  return { images, captionPath, title, totalPages: pageNum - 1 };
}

// --- CLI ---

function printUsage(): never {
  console.log(`Markdown → 小红书轮播图

Usage:
  bun md-to-xhs.ts <markdown-file> [options]

Options:
  --out <dir>       Output directory (default: <article>-xhs/)
  --theme <name>    Theme name (default: default)
  --aspect <ratio>  Aspect ratio: 3:4 | 9:16 | 1:1 | 4:3 (default: 3:4)
  --author <name>   Author name
  --tags <tags>     Comma-separated topic tags
  --help            Show this help

Environment:
  CHROME_PATH       Custom Chrome executable path

Output:
  <out>/01-cover.png
  <out>/02-content-<slug>.png
  <out>/NN-ending.png
  <out>/caption.md

Example:
  bun md-to-xhs.ts article.md --out ./xhs-images --author 作者名
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
  }

  let markdownPath: string | undefined;
  let outDir: string | undefined;
  let theme = 'default';
  let aspect = DEFAULT_ASPECT;
  let author = '';
  let tags = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--out' && args[i + 1]) {
      outDir = args[++i];
    } else if (arg === '--theme' && args[i + 1]) {
      theme = args[++i];
    } else if (arg === '--aspect' && args[i + 1]) {
      aspect = args[++i];
    } else if (arg === '--author' && args[i + 1]) {
      author = args[++i];
    } else if (arg === '--tags' && args[i + 1]) {
      tags = args[++i];
    } else if (!arg.startsWith('-')) {
      markdownPath = arg;
    }
  }

  if (!markdownPath) {
    console.error('Error: Markdown file path is required');
    process.exit(1);
  }

  if (!fs.existsSync(markdownPath)) {
    console.error(`Error: File not found: ${markdownPath}`);
    process.exit(1);
  }

  if (!outDir) {
    const base = path.basename(markdownPath, path.extname(markdownPath));
    outDir = path.join(path.dirname(path.resolve(markdownPath)), `${base}-xhs`);
  }

  console.log(`[md-to-xhs] Rendering: ${markdownPath}`);
  console.log(`[md-to-xhs] Theme: ${theme} · Aspect: ${aspect} · Output: ${outDir}`);

  const result = await render(markdownPath, outDir, theme, aspect, author, tags);

  console.log(`\n[md-to-xhs] Done! ${result.totalPages} pages generated:`);
  for (const img of result.images) {
    console.log(`  → ${path.basename(img)}`);
  }
  console.log(`  → caption.md`);
  console.log(`\nOutput JSON:`);
  console.log(JSON.stringify(result, null, 2));
}

await main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
