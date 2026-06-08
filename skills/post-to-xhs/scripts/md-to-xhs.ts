import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { marked, type Token } from 'marked';

// --- Types ---

interface AspectSize { width: number; height: number }

type ContentLayout = 'prose' | 'image-focus' | 'stats' | 'pull-quote' | 'list-highlight' | 'code';

interface PageSection {
  type: 'cover' | 'content' | 'ending';
  title: string;
  bodyHtml: string;
  rawTokens: Token[];
  layout: ContentLayout;
  slug: string;
  coverImage?: string;
  coverAspectRatio?: string;
  tags?: string[];
  author?: string;
}

interface MarkdownSection {
  heading?: { depth: number; text: string };
  tokens: Token[];
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
const CONTENT_TOP_PAD = 78;
const CONTENT_BOTTOM_PAD = 104;
const PAGE_NUM_HEIGHT = 0;
const imageSizeCache = new Map<string, { width: number; height: number } | null>();

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
    if (pf) candidates.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (pf86) candidates.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error(
    'Chrome/Edge not found. Set CHROME_PATH env var or install Google Chrome.\n' +
    'Download: https://www.google.com/chrome/',
  );
}

// --- Chrome Rendering ---

function renderWithChrome(
  html: string,
  outputPath: string,
  width: number,
  height: number,
): Promise<void> {
  const chrome = findChrome();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpHtml = path.join(os.tmpdir(), `xhs-render-${id}.html`);
  const tmpPng = path.join(os.tmpdir(), `xhs-render-${id}.png`);
  const fileUrl = pathToFileURL(tmpHtml).href;

  fs.writeFileSync(tmpHtml, html);

  return new Promise<void>((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--run-all-compositor-stages-before-draw',
      `--window-size=${width},${height}`,
      `--screenshot=${tmpPng}`,
      fileUrl,
    ];

    const proc = spawn(chrome, args, { stdio: 'pipe' });
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Chrome screenshot timed out`));
    }, 30_000);

    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !fs.existsSync(tmpPng)) {
        reject(new Error(`Chrome exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        fs.copyFileSync(tmpPng, outputPath);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        try { fs.unlinkSync(tmpHtml); } catch { /* */ }
        try { fs.unlinkSync(tmpPng); } catch { /* */ }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function dumpDomWithChrome(
  html: string,
  width: number,
  height: number,
): Promise<string> {
  const chrome = findChrome();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpHtml = path.join(os.tmpdir(), `xhs-measure-${id}.html`);
  const fileUrl = pathToFileURL(tmpHtml).href;

  fs.writeFileSync(tmpHtml, html);

  return new Promise<string>((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=8000',
      `--window-size=${width},${height}`,
      '--dump-dom',
      fileUrl,
    ];

    const proc = spawn(chrome, args, { stdio: 'pipe' });
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Chrome DOM dump timed out'));
    }, 30_000);

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      try { fs.unlinkSync(tmpHtml); } catch { /* */ }
      if (code !== 0) {
        reject(new Error(`Chrome exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(stdout);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      try { fs.unlinkSync(tmpHtml); } catch { /* */ }
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

function addImageDimensions(html: string, baseDir: string): string {
  return html.replace(/<img\b([^>]*?)src=["']([^"']+)["']([^>]*)>/gi, (tag, before, src, after) => {
    if (/\swidth=["']?\d/i.test(tag) && /\sheight=["']?\d/i.test(tag)) return tag;

    const filePath = resolveLocalImagePath(src, baseDir);
    const size = filePath && fs.existsSync(filePath) ? readImageSize(filePath) : null;
    if (!size) return tag;

    return `<img${before}src="${src}"${after} width="${size.width}" height="${size.height}">`;
  });
}

function resolveCoverImage(fm: Frontmatter, baseDir: string): string {
  const candidates = [
    fm.coverImage,
    fm.cover,
    fm.image,
    'cover.png',
    path.join('imgs', 'cover.png'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (/^(https?:|data:|file:)/.test(candidate)) return candidate;
    const absolute = path.resolve(baseDir, candidate);
    if (fs.existsSync(absolute)) return pathToFileURL(absolute).href;
  }

  return '';
}

function resolveLocalImagePath(src: string, baseDir: string): string | null {
  if (/^https?:|^data:/i.test(src)) return null;
  try {
    if (/^file:/i.test(src)) return fileURLToPath(src);
  } catch {
    return null;
  }
  return path.resolve(baseDir, src);
}

function readImageSize(filePath: string): { width: number; height: number } | null {
  if (imageSizeCache.has(filePath)) return imageSizeCache.get(filePath)!;

  let size: { width: number; height: number } | null = null;
  try {
    const buffer = fs.readFileSync(filePath);

    if (
      buffer.length >= 24 &&
      buffer[0] === 0x89 &&
      buffer.toString('ascii', 1, 4) === 'PNG'
    ) {
      size = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    } else if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      size = readWebpSize(buffer);
    } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      size = readJpegSize(buffer);
    }
  } catch {
    size = null;
  }

  imageSizeCache.set(filePath, size);
  return size;
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1]!;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;

    if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 ||
      marker === 0xc3 || marker === 0xc5 || marker === 0xc6 ||
      marker === 0xc7 || marker === 0xc9 || marker === 0xca ||
      marker === 0xcb || marker === 0xcd || marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }
  return null;
}

function readWebpSize(buffer: Buffer): { width: number; height: number } | null {
  const chunk = buffer.toString('ascii', 12, 16);

  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }

  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >> 14) & 0x3fff);
    return { width, height };
  }

  if (chunk === 'VP8 ') {
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (start > 0 && start + 7 < buffer.length) {
      const width = buffer.readUInt16LE(start + 3) & 0x3fff;
      const height = buffer.readUInt16LE(start + 5) & 0x3fff;
      return { width, height };
    }
  }

  return null;
}

function coverImageAspectRatio(src: string, baseDir: string): string {
  const filePath = resolveLocalImagePath(src, baseDir);
  const size = filePath && fs.existsSync(filePath) ? readImageSize(filePath) : null;
  if (!size || size.width <= 0 || size.height <= 0) return '4 / 3';

  return `${size.width} / ${size.height}`;
}

// --- Content Analysis ---

function analyzeContent(tokens: Token[]): ContentLayout {
  let hasImage = false;
  let hasBlockquote = false;
  let hasCode = false;
  let boldWithNumbers = 0;
  let colonBoldList = 0;
  let textLength = 0;

  for (const token of tokens) {
    if (token.type === 'image') hasImage = true;
    if (token.type === 'code') hasCode = true;
    if (token.type === 'blockquote') hasBlockquote = true;

    if (token.type === 'paragraph' && 'text' in token) {
      textLength += token.text.length;
      // Detect bold numbers: **95%**, **$10B**, **3.6K→8.6K**, **650亿**
      const numMatches = token.text.match(/\*\*[\d$￥€][\d.万化百KMB$￥€%→\s]+\*\*/g);
      if (numMatches) boldWithNumbers += numMatches.length;
      // Detect **term**: description patterns
      const colonMatches = token.text.match(/\*\*[^*]+\*\*[：:]/g);
      if (colonMatches) colonBoldList += colonMatches.length;
    }

    if (token.type === 'list' && 'items' in token) {
      for (const item of (token as { items: { text: string }[] }).items || []) {
        textLength += item.text.length;
        const numMatches = item.text.match(/\*\*[\d$￥€][\d.万化百KMB$￥€%→\s]+\*\*/g);
        if (numMatches) boldWithNumbers += numMatches.length;
        const colonMatches = item.text.match(/\*\*[^*]+\*\*[：:]/g);
        if (colonMatches) colonBoldList += colonMatches.length;
      }
    }
  }

  // Priority order
  if (hasCode) return 'code';
  if (hasImage && textLength < 200) return 'image-focus';
  if (boldWithNumbers >= 2) return 'stats';
  if (hasBlockquote && textLength < 300) return 'pull-quote';
  if (colonBoldList >= 2) return 'list-highlight';
  return 'prose';
}

function extractStats(tokens: Token[]): { value: string; label: string }[] {
  const stats: { value: string; label: string }[] = [];

  for (const token of tokens) {
    if (stats.length >= 3) break;
    if (token.type === 'paragraph' && 'text' in token) {
      const matches = [...token.text.matchAll(/\*\*([^*]+)\*\*[：:\s]*([^*]{1,40}?)(?=[。，；,;]|$)/g)];
      for (const m of matches) {
        if (stats.length < 3 && /[\d$￥€%]/.test(m[1]!)) {
          stats.push({ value: m[1]!, label: m[2]!.trim() });
        }
      }
    }
    if (token.type === 'list' && 'items' in token) {
      for (const item of (token as { items: { text: string }[] }).items || []) {
        if (stats.length >= 3) break;
        const m = item.text.match(/\*\*([^*]+)\*\*[：:\s]*([^*]{1,40}?)(?=[。，；,;]|$)/);
        if (m && /[\d$￥€%]/.test(m[1]!)) {
          stats.push({ value: m[1]!, label: m[2]!.trim() });
        }
      }
    }
  }

  return stats;
}

function extractQuote(tokens: Token[]): { text: string; attribution?: string } | null {
  for (const token of tokens) {
    if (token.type === 'blockquote' && 'text' in token) {
      const quoteText = token.text.trim();
      if (quoteText.length > 10) {
        return { text: quoteText };
      }
    }
  }
  return null;
}

function extractImage(tokens: Token[]): string | null {
  for (const token of tokens) {
    if (token.type === 'image' && 'href' in token) {
      return token.href;
    }
  }
  return null;
}

// --- Markdown Parsing ---

function splitByHeadings(tokens: Token[]): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { tokens: [] };

  for (const token of tokens) {
    if (token.type === 'heading' && (token.depth === 1 || token.depth === 2)) {
      if (current.tokens.length > 0 || current.heading) {
        sections.push(current);
      }
      current = { heading: { depth: token.depth, text: token.text }, tokens: [] };
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
  baseDir: string,
): PageSection[] {
  const pages: PageSection[] = [];
  let mainTitle = fm.title || '';

  const h1 = sections.find((s) => s.heading?.depth === 1);
  if (h1) {
    mainTitle = mainTitle || h1.heading!.text;
  }
  if (!mainTitle) mainTitle = '未命名文章';

  const coverImage = resolveCoverImage(fm, baseDir);

  pages.push({
    type: 'cover',
    title: mainTitle,
    bodyHtml: '',
    rawTokens: [],
    layout: 'prose',
    slug: 'cover',
    coverImage,
    coverAspectRatio: coverImage ? coverImageAspectRatio(coverImage, baseDir) : '4 / 3',
  });

  const contentHtmlParts: string[] = [];
  const contentTokens: Token[] = [];

  for (const section of sections) {
    if (section.heading?.depth === 2) {
      contentHtmlParts.push(`<h2 class="inline-section-title">${escapeHtml(section.heading.text)}</h2>`);
    }

    const sectionHtml = marked.parse(section.tokens.map((t) => t.raw).join('')) as string;
    if (sectionHtml.trim()) contentHtmlParts.push(sectionHtml);
    contentTokens.push(...section.tokens);
  }

  const contentHtml = contentHtmlParts.join('\n');
  if (contentHtml.trim()) {
    pages.push({
      type: 'content',
      title: '',
      bodyHtml: contentHtml,
      rawTokens: contentTokens,
      layout: 'prose',
      slug: 'content',
    });
  }

  const tags = topicTags
    ? topicTags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  pages.push({
    type: 'ending',
    title: '',
    bodyHtml: '',
    rawTokens: [],
    layout: 'prose',
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

function pageNumHtml(current: number, total: number): string {
  void current;
  void total;
  return '';
}

function buildCoverHtml(
  title: string,
  coverImage: string,
  coverAspectRatio: string,
  author: string,
  css: string,
  pageNum: number,
  totalPages: number,
  dims: string,
  _pageHeight: number,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="cover" style="${dims}">
  <div class="cover-content">
    ${coverImage ? `<div class="cover-image" style="--cover-source-ratio:${escapeHtml(coverAspectRatio)}"><img class="cover-image-bg" src="${escapeHtml(coverImage)}" alt="" aria-hidden="true"><img class="cover-image-fg" src="${escapeHtml(coverImage)}" alt=""></div>` : ''}
    <div class="title-area">
      <div class="title">${escapeHtml(title)}</div>
      <div class="divider"></div>
    </div>
    <div class="author">${escapeHtml(author)}</div>
  </div>
  ${pageNumHtml(pageNum, totalPages)}
</body></html>`;
}

function buildContentHtml(
  sectionTitle: string,
  bodyHtml: string,
  layout: ContentLayout,
  rawTokens: Token[],
  css: string,
  pageNum: number,
  totalPages: number,
  dims: string,
): string {
  const layoutClass = `content--${layout}`;
  const titleHtml = sectionTitle
    ? `<div class="section-title">${escapeHtml(sectionTitle)}</div>`
    : '';

  let bodyContent: string;
  const proseBody = `<div class="body">${bodyHtml}</div>`;

  switch (layout) {
    case 'image-focus': {
      const imgSrc = extractImage(rawTokens);
      if (imgSrc) {
        const nonImgTokens = rawTokens.filter((t) => t.type !== 'image');
        const caption = nonImgTokens.length > 0
          ? marked.parse(nonImgTokens.map((t) => t.raw).join('')) as string
          : '';
        bodyContent = `<div class="image-hero"><img src="${escapeHtml(imgSrc)}" alt=""></div>` +
          (caption ? `<div class="image-caption">${caption}</div>` : '');
      } else {
        bodyContent = proseBody;
      }
      break;
    }

    case 'stats': {
      const stats = extractStats(rawTokens);
      if (stats.length >= 2) {
        const statCards = stats.map((s) =>
          `<div class="stat-card"><div class="stat-value">${escapeHtml(s.value)}</div><div class="stat-label">${escapeHtml(s.label)}</div></div>`,
        ).join('\n    ');
        // Remaining non-stat text
        const nonStatHtml = bodyHtml
          .replace(/\*\*[^*]+\*\*[：:\s]*[^*]{1,40}?(?=[。，；,;]|<|$)/g, '')
          .replace(/<p>\s*<\/p>/g, '')
          .trim();
        bodyContent = `<div class="stats-grid">\n    ${statCards}\n  </div>` +
          (nonStatHtml ? `\n  <div class="stat-context">${nonStatHtml}</div>` : '');
      } else {
        bodyContent = proseBody;
      }
      break;
    }

    case 'pull-quote': {
      const quote = extractQuote(rawTokens);
      if (quote) {
        const nonQuoteTokens = rawTokens.filter((t) => t.type !== 'blockquote');
        const context = nonQuoteTokens.length > 0
          ? marked.parse(nonQuoteTokens.map((t) => t.raw).join('')) as string
          : '';
        bodyContent = `<div class="pull-quote">` +
          `<div class="quote-mark">“</div>` +
          `<div class="quote-text">${escapeHtml(quote.text)}</div>` +
          (quote.attribution ? `<div class="quote-attribution">${escapeHtml(quote.attribution)}</div>` : '') +
          `</div>` +
          (context ? `\n  <div class="body">${context}</div>` : '');
      } else {
        bodyContent = proseBody;
      }
      break;
    }

    case 'list-highlight': {
      // Extract **key**: value pairs and render as highlight items
      const listItems: { key: string; value: string }[] = [];
      for (const token of rawTokens) {
        if (token.type === 'list' && 'items' in token) {
          for (const item of (token as { items: { text: string }[] }).items || []) {
            const m = item.text.match(/\*\*([^*]+)\*\*[：:]\s*(.*)/);
            if (m) listItems.push({ key: m[1]!, value: m[2]! });
          }
        }
      }

      if (listItems.length >= 2) {
        const itemsHtml = listItems.map((item) =>
          `<div class="highlight-item"><div class="highlight-key">${escapeHtml(item.key)}</div><div class="highlight-value">${escapeHtml(item.value)}</div></div>`,
        ).join('\n    ');
        bodyContent = `<div class="highlight-list">\n    ${itemsHtml}\n  </div>`;
      } else {
        bodyContent = proseBody;
      }
      break;
    }

    case 'code':
    default:
      bodyContent = proseBody;
      break;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="content ${layoutClass}" style="${dims}">
  <div class="content-accent-line"></div>
  ${titleHtml}
  ${bodyContent}
  ${pageNumHtml(pageNum, totalPages)}
</body></html>`;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

async function measureContentPagesWithChrome(
  bodyHtml: string,
  css: string,
  dims: string,
  size: AspectSize,
  viewportHeight: number,
  viewportWidth: number,
  baseDir: string,
): Promise<string[]> {
  const blocks = splitHtmlAtBlockBoundaries(resolveImagePaths(addImageDimensions(bodyHtml, baseDir), baseDir));
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="content content--prose" style="${dims}">
  <div id="measure" class="body" style="width:${viewportWidth}px;"></div>
  <script id="xhs-blocks" type="application/json">${jsonForScript(blocks)}</script>
  <script>
    (() => {
      const limit = ${viewportHeight};
      const measureEl = document.getElementById('measure');
      const blocks = JSON.parse(document.getElementById('xhs-blocks').textContent || '[]');
      const hasImage = (html) => /<img\\b/i.test(html);
      const isHeading = (html) => /^\\s*<h[1-6]\\b/i.test(html);
      const visibleText = (html) => html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, 'x');
      const visibleLength = (html) => visibleText(html).length;

      const heightOf = (html) => {
        measureEl.innerHTML = html;
        return measureEl.getBoundingClientRect().height;
      };

      const chooseVisibleSplitPoint = (html, maxChars) => {
        const text = visibleText(html);
        let splitAt = Math.min(maxChars, text.length);
        if (splitAt <= 0 || splitAt >= text.length) return splitAt;
        const lowerBound = Math.max(1, splitAt - 30);
        for (let i = splitAt; i >= lowerBound; i--) {
          if (/[，。！？；：、,.!?;:\\s]/.test(text[i - 1] || '')) return i;
        }
        const isAsciiWord = (ch) => !!ch && /[A-Za-z0-9]/.test(ch);
        while (splitAt > lowerBound && isAsciiWord(text[splitAt - 1]) && isAsciiWord(text[splitAt])) splitAt--;
        return splitAt;
      };

      const splitInlineHtmlAtVisibleChars = (html, maxChars) => {
        const splitChars = chooseVisibleSplitPoint(html, maxChars);
        if (splitChars <= 0 || visibleLength(html) <= splitChars) return null;
        const tokens = html.match(/<[^>]+>|&[^;]+;|./gsu) || [];
        const openTags = [];
        let head = '';
        let tail = '';
        let visibleCount = 0;
        let isTail = false;
        const closeOpenTags = () => openTags.slice().reverse().map((tag) => '</' + tag.name + '>').join('');
        const reopenTags = () => openTags.map((tag) => tag.html).join('');

        for (const token of tokens) {
          if (token.startsWith('<')) {
            if (isTail) {
              tail += token;
              continue;
            }
            head += token;
            const tagName = (token.match(/^<\\/?\\s*([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase();
            const isClosing = /^<\\//.test(token);
            const isSelfClosing = /\\/>$/.test(token) || /^(?:br|hr|img|input|meta|link)$/i.test(tagName || '');
            if (tagName && isClosing) {
              const idx = openTags.map((tag) => tag.name).lastIndexOf(tagName);
              if (idx >= 0) openTags.splice(idx, 1);
            } else if (tagName && !isSelfClosing) {
              openTags.push({ name: tagName, html: token });
            }
            continue;
          }
          if (!isTail && visibleCount >= splitChars) {
            head += closeOpenTags();
            tail += reopenTags();
            isTail = true;
          }
          if (isTail) tail += token;
          else {
            head += token;
            visibleCount += 1;
          }
        }
        if (!tail.trim()) return null;
        return { head, tail };
      };

      const splitParagraphBlock = (html, maxChars) => {
        if (maxChars <= 0 || hasImage(html)) return null;
        const match = html.match(/^(\\s*<p\\b[^>]*>)([\\s\\S]*?)(<\\/p>\\s*)$/i);
        if (!match) return null;
        const split = splitInlineHtmlAtVisibleChars(match[2] || '', maxChars);
        if (!split) return null;
        return {
          head: (match[1] || '<p>') + split.head + (match[3] || '</p>'),
          tail: (match[1] || '<p>') + split.tail + (match[3] || '</p>'),
        };
      };

      const splitBlockToFit = (current, block) => {
        const total = visibleLength(block);
        let low = 1;
        let high = total - 1;
        let best = null;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const candidate = splitParagraphBlock(block, mid);
          if (!candidate) break;
          const h = heightOf(current + candidate.head);
          if (h <= limit) {
            best = candidate;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        return best;
      };

      const pages = [];
      let current = '';

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i] || '';
        if (!block.trim()) continue;

        if (isHeading(block) && current.trim() && blocks[i + 1]) {
          const withHeadingAndNext = heightOf(current + block + blocks[i + 1]);
          if (withHeadingAndNext > limit) {
            pages.push(current);
            current = '';
          }
        }

        const candidateHeight = heightOf(current + block);
        if (candidateHeight <= limit) {
          current += block;
          continue;
        }

        if (!hasImage(block)) {
          const split = splitBlockToFit(current, block);
          if (split) {
            if ((current + split.head).trim()) pages.push(current + split.head);
            current = '';
            blocks[i] = split.tail;
            i--;
            continue;
          }
        }

        if (current.trim()) {
          pages.push(current);
          current = '';
          i--;
        } else {
          pages.push(block);
        }
      }

      if (current.trim()) pages.push(current);
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ pages: pages.length ? pages : [''] }))));
      const pre = document.createElement('pre');
      pre.id = 'xhs-measure-result';
      pre.textContent = encoded;
      document.body.replaceChildren(pre);
    })();
  </script>
</body></html>`;

  const dom = await dumpDomWithChrome(html, size.width, size.height);
  const match = dom.match(/<pre id="xhs-measure-result">([^<]+)<\/pre>/);
  if (!match) return [bodyHtml];

  try {
    const result = JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8'));
    const pages = Array.isArray(result.pages)
      ? result.pages.filter((p: unknown) => typeof p === 'string' && p.trim())
      : [];
    return pages.length > 0 ? pages : [bodyHtml];
  } catch {
    return [bodyHtml];
  }
}

function buildEndingHtml(
  tags: string[],
  author: string,
  css: string,
  pageNum: number,
  totalPages: number,
  dims: string,
): string {
  const tagHtml = tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="ending" style="${dims}">
  <div style="flex:1"></div>
  <div class="ending-content">
    <div class="cta">感谢阅读</div>
    <div class="cta-sub">关注我，获取更多精彩内容</div>
    <div class="divider"></div>
    <div class="tags">
      ${tagHtml}
    </div>
    <div class="end-author">— <strong>${escapeHtml(author)}</strong></div>
  </div>
  <div style="flex:1"></div>
  ${pageNumHtml(pageNum, totalPages)}
</body></html>`;
}

// --- Content Block Splitting ---

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
  return parts
    .filter((p) => p.trim().length > 0)
    .flatMap(splitListBlock);
}

function splitListBlock(html: string): string[] {
  const match = html.match(/^\s*<(ul|ol)([^>]*)>([\s\S]*)<\/\1>\s*$/i);
  if (!match) return [html];

  const [, tag, attrs = '', inner = ''] = match;
  const items = inner.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi);
  if (!items || items.length <= 1) return [html];

  return items.map((item) => `<${tag}${attrs}>${item}</${tag}>`);
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

  const description = fm.description || fm.summary || '';

  const userTags = topicTags
    ? topicTags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  const contentTags = extractContentTags(body);
  const allTags = [...new Set([...userTags, ...contentTags])];
  const tagStr = allTags.map((t) => `#${t}`).join(' ');

  return [
    truncatedTitle,
    '',
    description,
    '',
    tagStr,
    '',
    `— ${author || '作者名'}`,
  ].join('\n');
}

function extractContentTags(body: string): string[] {
  const tags: string[] = [];
  const text = body.toLowerCase();

  const keywords: Record<string, string> = {
    'altman': 'Altman',
    'amodei': 'Amodei',
    'openai': 'OpenAI',
    'anthropic': 'Anthropic',
    'cursor': 'Cursor',
    'ai': 'AI',
    '裁员': '裁员',
    '就业': '就业',
    '代码': '编程',
    '开发者': '开发者',
    '融资': '融资',
    '焦虑': '焦虑',
  };

  for (const [kw, tag] of Object.entries(keywords)) {
    if (text.includes(kw)) tags.push(tag);
  }

  return tags.slice(0, 6);
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
  const pages = buildPageSections(sections, fm, resolvedAuthor, topicTags, baseDir);
  const css = loadCss(theme);
  const contentWidth = size.width - 164;
  const availableHeight = size.height - CONTENT_TOP_PAD - CONTENT_BOTTOM_PAD - PAGE_NUM_HEIGHT;
  const dimensionCss = `body{height:${size.height}px;width:${size.width}px;min-height:${size.height}px;}`;
  const dims = `height:${size.height}px;width:${size.width}px;min-height:${size.height}px;`;

  fs.mkdirSync(outDir, { recursive: true });

  // Phase 1: Calculate total pages
  interface PlannedPage {
    section: PageSection;
    chunkIndex: number;
    totalChunks: number;
    bodyHtml: string;
  }
  const planned: PlannedPage[] = [];

  for (const section of pages) {
    if (section.type === 'cover' || section.type === 'ending') {
      planned.push({ section, chunkIndex: 0, totalChunks: 1, bodyHtml: section.bodyHtml });
    } else {
      const chunks = await measureContentPagesWithChrome(
        section.bodyHtml,
        css + dimensionCss,
        dims,
        size,
        availableHeight,
        contentWidth,
        baseDir,
      );
      for (let i = 0; i < chunks.length; i++) {
        planned.push({ section, chunkIndex: i, totalChunks: chunks.length, bodyHtml: chunks[i]! });
      }
    }
  }

  const totalPages = planned.length;

  // Phase 2: Render with known totalPages
  const images: string[] = [];

  for (let idx = 0; idx < planned.length; idx++) {
    const { section, chunkIndex, bodyHtml } = planned[idx]!;
    const pageNum = idx + 1;
    let html: string;

    if (section.type === 'cover') {
      html = buildCoverHtml(
        section.title,
        section.coverImage || '',
        section.coverAspectRatio || '4 / 3',
        resolvedAuthor,
        css + dimensionCss,
        pageNum,
        totalPages,
        dims,
        size.height,
      );
      html = resolveImagePaths(html, baseDir);
      const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-cover.png`);
      await renderWithChrome(html, imgPath, size.width, size.height);
      images.push(imgPath);
    } else if (section.type === 'ending') {
      html = buildEndingHtml(section.tags || [], section.author || resolvedAuthor, css + dimensionCss, pageNum, totalPages, dims);
      const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-ending.png`);
      await renderWithChrome(html, imgPath, size.width, size.height);
      images.push(imgPath);
    } else {
      const showTitle = chunkIndex === 0 ? section.title : '';
      html = buildContentHtml(
        showTitle,
        bodyHtml,
        section.layout,
        section.rawTokens,
        css + dimensionCss,
        pageNum,
        totalPages,
        dims,
      );
      html = resolveImagePaths(html, baseDir);
      const suffix = chunkIndex === 0 ? section.slug : `${section.slug}-${chunkIndex + 1}`;
      const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-content-${suffix}.png`);
      await renderWithChrome(html, imgPath, size.width, size.height);
      images.push(imgPath);
    }
  }

  const title = pages.find((p) => p.type === 'cover')?.title || fm.title || '未命名';
  const caption = generateCaption(title, body, resolvedAuthor, fm, topicTags);
  const captionPath = path.join(outDir, 'caption.md');
  fs.writeFileSync(captionPath, caption, 'utf-8');

  return { images, captionPath, title, totalPages };
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
