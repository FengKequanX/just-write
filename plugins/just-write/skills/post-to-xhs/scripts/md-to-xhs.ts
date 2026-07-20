import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { marked, type Token } from 'marked';
import { loadXhsConfig, validateXhsOptions, type XhsConfig } from './xhs-config';

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
  subtitle?: string;
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
const CONTENT_TOP_PAD = 70;
const CONTENT_BOTTOM_PAD = 88;
const PAGE_NUM_HEIGHT = 0;
const CONTENT_SIDE_PAD = 70;
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
      '--virtual-time-budget=8000',
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

function normalizeReadingHtml(html: string): string {
  let protectedDepth = 0;
  let doubleQuoteOpen = false;
  let singleQuoteOpen = false;
  let prevChar = '';

  const curlyDouble = () => {
    const out = doubleQuoteOpen ? '”' : '“';
    doubleQuoteOpen = !doubleQuoteOpen;
    return out;
  };
  const curlySingle = () => {
    // Apostrophes inside Latin words (don't, it's) are never opening quotes.
    if (/[A-Za-z]/.test(prevChar)) return '’';
    const out = singleQuoteOpen ? '’' : '‘';
    singleQuoteOpen = !singleQuoteOpen;
    return out;
  };

  return html.replace(/<[^>]+>|&[^;]+;|[^<&]+/g, (token) => {
    if (token.startsWith('<')) {
      const tagName = token.match(/^<\/?\s*([a-zA-Z0-9-]+)/)?.[1]?.toLowerCase();
      if (tagName && /^(pre|code|kbd|samp)$/i.test(tagName)) {
        if (/^<\//.test(token)) protectedDepth = Math.max(0, protectedDepth - 1);
        else if (!/\/>$/.test(token)) protectedDepth++;
      }
      return token;
    }

    if (protectedDepth > 0) return token;

    if (token.startsWith('&')) {
      if (token === '&quot;') { const out = curlyDouble(); prevChar = out; return out; }
      if (token === '&#39;') { const out = curlySingle(); prevChar = out; return out; }
      prevChar = '';
      return token;
    }

    let text = '';
    for (const ch of token) {
      if (ch === '"') text += curlyDouble();
      else if (ch === "'") text += curlySingle();
      else text += ch;
      prevChar = text[text.length - 1] || '';
    }

    const cjk = String.raw`[\p{Script=Han}\u3040-\u30ff\uff00-\uffef]`;
    const latin = String.raw`[A-Za-z0-9][A-Za-z0-9.+#/@_-]*`;
    const fixedGap = '&#8239;';

    return text
      .replace(new RegExp(`(${cjk})\\s+(${latin})`, 'gu'), `$1${fixedGap}$2`)
      .replace(new RegExp(`(${latin})\\s+(${cjk})`, 'gu'), `$1${fixedGap}$2`)
      .replace(/([0-9])\s+([年月日亿万%])/g, `$1${fixedGap}$2`)
      .replace(/([年月日亿万%])\s+([0-9])/g, `$1${fixedGap}$2`);
  });
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

export function resolveCoverImage(fm: Frontmatter, baseDir: string): string {
  const candidates = [
    fm.xhsCoverImage,
    path.join('imgs', 'cover-xhs.png'),
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
    subtitle: fm.description || fm.summary || '',
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

  const contentHtml = normalizeReadingHtml(contentHtmlParts.join('\n'));
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
  return `<div class="page-num">${String(current).padStart(2, '0')}<span class="page-total"> / ${String(total).padStart(2, '0')}</span></div>`;
}

export function buildCoverHtml(
  title: string,
  coverImage: string,
  coverAspectRatio: string,
  author: string,
  css: string,
  pageNum: number,
  totalPages: number,
  dims: string,
  _pageHeight: number,
  subtitle = '',
): string {
  void pageNum;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="cover${coverImage ? '' : ' cover--text-only'}" style="${dims}">
  <div class="cover-content">
    <div class="cover-kicker"><span class="kicker-dot"></span><span>${escapeHtml(author)}</span></div>
    ${coverImage ? `<div class="cover-image" style="--cover-source-ratio:${escapeHtml(coverAspectRatio)}"><img class="cover-image-bg" src="${escapeHtml(coverImage)}" alt="" aria-hidden="true"><img class="cover-image-fg" src="${escapeHtml(coverImage)}" alt=""></div>` : ''}
    <div class="title-area">
      <div class="title">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    <div class="cover-footer">
      <span>JUST WRITE</span>
      <span>共 ${String(totalPages).padStart(2, '0')} 页 · 右滑阅读</span>
    </div>
  </div>
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
  articleKicker = '',
): string {
  const layoutClass = `content--${layout}`;
  const kicker = articleKicker.length > 22 ? `${articleKicker.slice(0, 21)}…` : articleKicker;
  const kickerHtml = kicker ? `<div class="page-kicker">${escapeHtml(kicker)}</div>` : '';
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
  ${kickerHtml}
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
  const sourceHtml = resolveImagePaths(addImageDimensions(bodyHtml, baseDir), baseDir);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="content content--prose" style="${dims}">
  <div id="measure" class="body" style="width:${viewportWidth}px;"></div>
  <script id="xhs-source" type="application/json">${jsonForScript(sourceHtml)}</script>
  <script>
    (async () => {
      const limit = ${viewportHeight};
      const measureEl = document.getElementById('measure');
      const sourceHtml = JSON.parse(document.getElementById('xhs-source').textContent || '""');
      const finish = (value) => {
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(value))));
        const pre = document.createElement('pre');
        pre.id = 'xhs-measure-result';
        pre.textContent = encoded;
        document.body.replaceChildren(pre);
      };

      try {
        await document.fonts.ready;

        const source = document.createElement('div');
        source.innerHTML = sourceHtml;
        const imageSources = Array.from(source.querySelectorAll('img'))
          .map((img) => img.currentSrc || img.src)
          .filter(Boolean);
        await Promise.all(imageSources.map((src) => new Promise((resolve, reject) => {
          const img = new Image();
          const timeout = setTimeout(() => reject(new Error('image load timed out: ' + src)), 6000);
          img.onload = () => { clearTimeout(timeout); resolve(undefined); };
          img.onerror = () => { clearTimeout(timeout); reject(new Error('image failed to load: ' + src)); };
          img.src = src;
          if (img.complete && img.naturalWidth > 0) {
            clearTimeout(timeout);
            resolve(undefined);
          }
        })));

        const serializeNode = (node) => {
          const holder = document.createElement('div');
          holder.appendChild(node.cloneNode(true));
          return holder.innerHTML;
        };
        const kindOfElement = (element) => {
          const tag = element.tagName.toLowerCase();
          if (/^h[1-6]$/.test(tag)) return 'heading';
          if (tag === 'p') return element.querySelector('img') ? 'image' : 'paragraph';
          if (tag === 'blockquote') return 'blockquote';
          if (tag === 'pre') return 'code';
          if (tag === 'table') return 'table';
          if (element.querySelector('img')) return 'image';
          return 'other';
        };
        const blockFromNode = (node, forcedKind) => {
          const html = serializeNode(node);
          const element = node.nodeType === Node.ELEMENT_NODE ? node : null;
          return {
            html,
            kind: forcedKind || (element ? kindOfElement(element) : 'paragraph'),
            hasImage: !!(element && element.querySelector('img')),
          };
        };
        const extractBlocks = (html) => {
          const container = document.createElement('div');
          container.innerHTML = html;
          const result = [];
          for (const node of Array.from(container.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
              if (node.textContent && node.textContent.trim()) {
                const paragraph = document.createElement('p');
                paragraph.textContent = node.textContent;
                result.push(blockFromNode(paragraph, 'paragraph'));
              }
              continue;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const element = node;
            const tag = element.tagName.toLowerCase();
            if (tag === 'ul' || tag === 'ol') {
              const items = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'li');
              if (items.length > 0) {
                const start = tag === 'ol' ? Number(element.getAttribute('start') || '1') : 1;
                items.forEach((item, index) => {
                  const wrapper = element.cloneNode(false);
                  if (tag === 'ol') wrapper.setAttribute('start', String(start + index));
                  wrapper.appendChild(item.cloneNode(true));
                  result.push(blockFromNode(wrapper, 'list-item'));
                });
                continue;
              }
            }
            if (tag === 'blockquote') {
              const children = Array.from(element.childNodes).filter((child) =>
                child.nodeType !== Node.TEXT_NODE || !!(child.textContent && child.textContent.trim()));
              if (children.length > 1) {
                for (const child of children) {
                  if (child.nodeType === Node.ELEMENT_NODE && ['ul', 'ol'].includes(child.tagName.toLowerCase())) {
                    const list = child;
                    const items = Array.from(list.children).filter((item) => item.tagName.toLowerCase() === 'li');
                    const start = list.tagName.toLowerCase() === 'ol' ? Number(list.getAttribute('start') || '1') : 1;
                    items.forEach((item, index) => {
                      const quoteWrapper = element.cloneNode(false);
                      const listWrapper = list.cloneNode(false);
                      if (list.tagName.toLowerCase() === 'ol') listWrapper.setAttribute('start', String(start + index));
                      listWrapper.appendChild(item.cloneNode(true));
                      quoteWrapper.appendChild(listWrapper);
                      result.push(blockFromNode(quoteWrapper, 'blockquote'));
                    });
                    continue;
                  }
                  const wrapper = element.cloneNode(false);
                  wrapper.appendChild(child.cloneNode(true));
                  result.push(blockFromNode(wrapper, 'blockquote'));
                }
                continue;
              }
            }
            result.push(blockFromNode(element));
          }
          return result;
        };
        const blockFromHtml = (html, kind) => {
          const container = document.createElement('div');
          container.innerHTML = html;
          const element = container.firstElementChild;
          return {
            html,
            kind: kind || (element ? kindOfElement(element) : 'other'),
            hasImage: !!(element && element.querySelector('img')),
          };
        };
        const visibleText = (html, stripRepeatedHeaders = false) => {
          const container = document.createElement('div');
          container.innerHTML = html;
          if (stripRepeatedHeaders) {
            container.querySelectorAll('[data-xhs-repeated-header="true"]').forEach((node) => node.remove());
          }
          return (container.textContent || '').replace(/\\s+/g, ' ').trim();
        };
        const visibleLength = (html) => {
          const container = document.createElement('div');
          container.innerHTML = html;
          return (container.textContent || '').length;
        };
        const heightOf = (html) => {
          measureEl.innerHTML = html;
          return measureEl.getBoundingClientRect().height;
        };
        const lineCount = (html) => {
          measureEl.innerHTML = html;
          const range = document.createRange();
          range.selectNodeContents(measureEl);
          const tops = [];
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (!tops.some((top) => Math.abs(top - rect.top) < 1)) tops.push(rect.top);
          }
          return tops.length;
        };
        const fragmentHtml = (fragment) => {
          const holder = document.createElement('div');
          holder.appendChild(fragment);
          return holder.innerHTML;
        };
        const chooseSplitPoint = (html, maxChars) => {
          const text = (() => {
            const container = document.createElement('div');
            container.innerHTML = html;
            return container.textContent || '';
          })();
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
        const splitAtVisibleChars = (html, requestedChars, adjustToBoundary = true) => {
          const host = document.createElement('div');
          host.innerHTML = html;
          const total = (host.textContent || '').length;
          const splitChars = adjustToBoundary ? chooseSplitPoint(html, requestedChars) : requestedChars;
          if (splitChars <= 0 || splitChars >= total) return null;
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
          let remaining = splitChars;
          let target = null;
          let offset = 0;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const length = (node.nodeValue || '').length;
            if (remaining <= length) {
              target = node;
              offset = remaining;
              break;
            }
            remaining -= length;
          }
          if (!target) return null;
          const headRange = document.createRange();
          headRange.setStart(host, 0);
          headRange.setEnd(target, offset);
          const tailRange = document.createRange();
          tailRange.setStart(target, offset);
          tailRange.setEnd(host, host.childNodes.length);
          const head = fragmentHtml(headRange.cloneContents());
          const tail = fragmentHtml(tailRange.cloneContents());
          if (!visibleText(head) || !visibleText(tail)) return null;
          return { head, tail };
        };
        const splitTextToFit = (current, block, enforceWidows = true) => {
          const total = visibleLength(block.html);
          const totalLines = lineCount(block.html);
          let low = 1;
          let high = total - 1;
          let best = null;
          let bestLength = 0;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const candidate = splitAtVisibleChars(block.html, mid, true);
            if (!candidate) {
              high = mid - 1;
              continue;
            }
            const candidateLength = visibleLength(candidate.head);
            const fits = heightOf(current + candidate.head) <= limit;
            const respectsWidows = !enforceWidows || totalLines < 4 ||
              (lineCount(candidate.head) >= 2 && lineCount(candidate.tail) >= 2);
            if (fits && respectsWidows) {
              if (candidateLength > bestLength) {
                best = candidate;
                bestLength = candidateLength;
              }
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }
          return best;
        };
        const splitCodeToFit = (current, block) => {
          const container = document.createElement('div');
          container.innerHTML = block.html;
          const text = container.textContent || '';
          const lineEnds = [];
          for (let i = 0; i < text.length; i++) {
            if (text[i] === '\\n') lineEnds.push(i + 1);
          }
          let best = null;
          for (const end of lineEnds) {
            const candidate = splitAtVisibleChars(block.html, end, false);
            if (!candidate || heightOf(current + candidate.head) > limit) break;
            best = candidate;
          }
          return best || splitTextToFit(current, block, false);
        };
        const splitTableToFit = (current, block) => {
          const container = document.createElement('div');
          container.innerHTML = block.html;
          const table = container.querySelector('table');
          if (!table) return null;
          const rows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
          if (rows.length < 2) return null;
          const wasRepeated = !!(table.tHead && table.tHead.hasAttribute('data-xhs-repeated-header'));
          const buildTable = (selectedRows, repeatedHeader, includeFooter) => {
            const clone = table.cloneNode(true);
            const bodies = Array.from(clone.tBodies);
            let targetBody = bodies[0];
            if (!targetBody) {
              targetBody = document.createElement('tbody');
              clone.appendChild(targetBody);
            }
            targetBody.replaceChildren(...selectedRows.map((row) => row.cloneNode(true)));
            bodies.slice(1).forEach((body) => body.remove());
            if (!includeFooter && clone.tFoot) clone.tFoot.remove();
            if (repeatedHeader && clone.tHead) clone.tHead.setAttribute('data-xhs-repeated-header', 'true');
            return serializeNode(clone);
          };
          let best = null;
          for (let count = 1; count < rows.length; count++) {
            const head = buildTable(rows.slice(0, count), wasRepeated, false);
            if (heightOf(current + head) > limit) break;
            const tail = buildTable(rows.slice(count), true, true);
            best = { head, tail };
          }
          return best;
        };
        const fitImageBlock = (block, prefix = '', minImagePx = 32) => {
          const container = document.createElement('div');
          container.innerHTML = block.html;
          const images = Array.from(container.querySelectorAll('img'));
          if (images.length === 0) return null;
          let low = minImagePx;
          let high = Math.min(480, limit);
          let best = null;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            images.forEach((img) => {
              img.style.maxHeight = mid + 'px';
              img.style.height = 'auto';
            });
            const candidate = container.innerHTML;
            if (heightOf(prefix + candidate) <= limit) {
              best = candidate;
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }
          return best;
        };
        const isCaptionBlock = (block) => {
          if (block.hasImage || block.kind !== 'paragraph') return false;
          const container = document.createElement('div');
          container.innerHTML = block.html;
          const paragraph = container.firstElementChild;
          if (!paragraph || paragraph.tagName.toLowerCase() !== 'p') return false;
          const em = paragraph.querySelector(':scope > em');
          if (!em) return false;
          const total = (paragraph.textContent || '').trim().length;
          const inside = (em.textContent || '').trim().length;
          return total > 0 && total <= 160 && inside / total >= 0.8;
        };
        const mergeImageCaptions = (list) => {
          const merged = [];
          for (const item of list) {
            const prev = merged[merged.length - 1];
            if (prev && prev.hasImage && isCaptionBlock(item)) {
              prev.html += item.html;
              continue;
            }
            merged.push(item);
          }
          return merged;
        };
        const prefixWithLines = (block, minimumLines) => {
          if (block.hasImage || visibleLength(block.html) === 0) return block.html;
          const total = visibleLength(block.html);
          let low = 1;
          let high = total - 1;
          let best = block.html;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const candidate = splitAtVisibleChars(block.html, mid, false);
            if (!candidate) break;
            if (lineCount(candidate.head) >= minimumLines) {
              best = candidate.head;
              high = mid - 1;
            } else {
              low = mid + 1;
            }
          }
          return best;
        };
        const pageIsValid = (html) => {
          if (!html.trim() || heightOf(html) > limit + 0.5) return false;
          const pageBlocks = extractBlocks(html);
          return pageBlocks.length > 0 && pageBlocks[pageBlocks.length - 1].kind !== 'heading';
        };

        const blocks = mergeImageCaptions(extractBlocks(sourceHtml));
        const pages = [];
        let current = '';

        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          if (block.kind === 'heading') {
            const next = blocks[i + 1];
            if (!next) throw new Error('heading has no following content');
            const required = block.html + prefixWithLines(next, 2);
            if (heightOf(required) > limit) throw new Error('heading and two following lines exceed one page');
            if (current.trim() && heightOf(current + required) > limit) {
              pages.push(current);
              current = '';
            }
          }

          if (heightOf(current + block.html) <= limit) {
            current += block.html;
            continue;
          }

          if (current.trim()) {
            const split = !block.hasImage && ['paragraph', 'list-item', 'blockquote', 'code', 'table'].includes(block.kind)
              ? block.kind === 'code'
                ? splitCodeToFit(current, block)
                : block.kind === 'table'
                  ? splitTableToFit(current, block)
                  : splitTextToFit(current, block, true)
              : null;
            if (split) {
              pages.push(current + split.head);
              current = '';
              blocks[i] = blockFromHtml(split.tail, block.kind);
              i--;
              continue;
            }
            if (block.hasImage) {
              const squeezed = fitImageBlock(block, current, 260);
              if (squeezed) {
                current += squeezed;
                continue;
              }
            }
            pages.push(current);
            current = '';
            i--;
            continue;
          }

          if (block.hasImage) {
            const fitted = fitImageBlock(block);
            if (fitted) {
              current = fitted;
              continue;
            }
          }

          const split = !block.hasImage && ['paragraph', 'list-item', 'blockquote', 'code', 'table'].includes(block.kind)
            ? block.kind === 'code'
              ? splitCodeToFit('', block)
              : block.kind === 'table'
                ? splitTableToFit('', block)
                : splitTextToFit('', block, true)
            : null;
          if (split) {
            pages.push(split.head);
            blocks[i] = blockFromHtml(split.tail, block.kind);
            i--;
            continue;
          }

          const measured = Math.ceil(heightOf(block.html));
          throw new Error('cannot safely split ' + block.kind + ' block (' + measured + 'px > ' + limit + 'px)');
        }

        if (current.trim()) pages.push(current);
        if (pages.length === 0) pages.push('');

        if (pages.length >= 2) {
          const lastIndex = pages.length - 1;
          const originalLastHeight = heightOf(pages[lastIndex]);
          if (originalLastHeight / limit < 0.45) {
            const combined = extractBlocks(pages[lastIndex - 1] + pages[lastIndex]);
            let best = null;
            for (let splitAt = 1; splitAt < combined.length; splitAt++) {
              const left = combined.slice(0, splitAt).map((item) => item.html).join('');
              const right = combined.slice(splitAt).map((item) => item.html).join('');
              if (!pageIsValid(left) || !pageIsValid(right)) continue;
              const leftHeight = heightOf(left);
              const rightHeight = heightOf(right);
              if (leftHeight / limit < 0.45 || rightHeight <= originalLastHeight) continue;
              const score = Math.abs(leftHeight - rightHeight);
              if (!best || score < best.score) best = { left, right, score };
            }
            if (best) {
              pages[lastIndex - 1] = best.left;
              pages[lastIndex] = best.right;
            }
          }
        }

        const metrics = pages.map((page, index) => {
          const height = heightOf(page);
          const pageBlocks = extractBlocks(page);
          if (height > limit + 0.5) {
            throw new Error('page ' + (index + 1) + ' overflows by ' + Math.ceil(height - limit) + 'px');
          }
          if (pageBlocks.length > 0 && pageBlocks[pageBlocks.length - 1].kind === 'heading') {
            throw new Error('page ' + (index + 1) + ' ends with an orphan heading');
          }
          return { height, blockKinds: pageBlocks.map((item) => item.kind) };
        });
        const comparableText = (html, stripRepeatedHeaders = false) =>
          visibleText(html, stripRepeatedHeaders).replace(/\\s+/g, '');
        const sourceText = comparableText(sourceHtml);
        const pagedText = pages.map((page) => comparableText(page, true)).join('');
        if (sourceText !== pagedText) {
          let mismatch = 0;
          while (mismatch < sourceText.length && sourceText[mismatch] === pagedText[mismatch]) mismatch++;
          throw new Error('paginated text differs from source content at character ' + mismatch +
            ' (source ' + sourceText.length + ', pages ' + pagedText.length + ')');
        }
        finish({ pages, metrics });
      } catch (error) {
        finish({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  </script>
</body></html>`;

  // Headless Chrome occasionally dumps the DOM before the measurement script
  // finishes on a cold start; one retry absorbs that flakiness.
  let match: RegExpMatchArray | null = null;
  for (let attempt = 0; attempt < 2 && !match; attempt++) {
    const dom = await dumpDomWithChrome(html, size.width, size.height);
    match = dom.match(/<pre id="xhs-measure-result">([^<]+)<\/pre>/);
  }
  if (!match) throw new Error('[md-to-xhs] Pagination failed: Chrome returned no measurement result');

  try {
    const result = JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8'));
    if (typeof result.error === 'string' && result.error) {
      throw new Error(`[md-to-xhs] Pagination failed: ${result.error}`);
    }
    const pages = Array.isArray(result.pages)
      ? result.pages.filter((p: unknown) => typeof p === 'string' && p.trim())
      : [];
    if (pages.length === 0) throw new Error('[md-to-xhs] Pagination failed: Chrome returned no content pages');
    return pages;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[md-to-xhs] Pagination failed:')) throw error;
    throw new Error(`[md-to-xhs] Pagination failed: invalid Chrome result (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function buildEndingHtml(
  tags: string[],
  author: string,
  css: string,
  pageNum: number,
  totalPages: number,
  dims: string,
): string {
  const tagHtml = tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('\n    ');
  const tagsSection = tagHtml
    ? `<div class="ending-topics">
      <div class="ending-meta-label">TOPICS</div>
      <div class="tags">
        ${tagHtml}
      </div>
    </div>`
    : '';

  const authorName = author && author !== '作者名' ? author : '';
  const followText = authorName ? `关注${escapeHtml(authorName)}，期待下次见。` : '感谢阅读，期待下次见。';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="ending" style="${dims}">
  <div class="ending-content">
    <div class="ending-kicker">
      <span>THE END</span>
      <span class="ending-kicker-line"></span>
      <span>感谢看到这里</span>
    </div>
    <div class="cta">
      <span>感谢</span>
      <span class="cta-accent">阅读。</span>
    </div>
    <div class="cta-sub">${followText}</div>
    <div class="ending-rule"></div>
    <div class="ending-meta${tagHtml ? '' : ' ending-meta--author-only'}">
      ${tagsSection}
      <div class="end-author">
        <span class="ending-meta-label">WRITTEN BY</span>
        <strong>${escapeHtml(author)}</strong>
      </div>
    </div>
  </div>
  <div class="ending-footer">
    <span>JUST WRITE</span>
    <span>${String(pageNum).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}</span>
  </div>
</body></html>`;
}

// --- Caption Generation ---

function generateCaption(
  title: string,
  body: string,
  author: string,
  fm: Frontmatter,
  topicTags: string,
): string {
  const description = fm.description || fm.summary || '';

  const userTags = topicTags
    ? topicTags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  const contentTags = extractContentTags(body);
  const allTags = [...new Set([...userTags, ...contentTags])];
  const tagStr = allTags.map((t) => `#${t}`).join(' ');

  return [
    title,
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

export interface RenderResult {
  images: string[];
  captionPath: string;
  title: string;
  totalPages: number;
}

export async function render(
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
  const contentWidth = size.width - CONTENT_SIDE_PAD * 2;
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
  const mainTitle = pages.find((p) => p.type === 'cover')?.title || '';

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
        section.subtitle || '',
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
        mainTitle,
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

const GENERATED_XHS_FILE = /^(?:\d{2,}-.*\.png|caption\.md)$/i;

export function commitGeneratedOutput(
  result: RenderResult,
  stagingDir: string,
  outputDir: string,
): RenderResult {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of fs.readdirSync(outputDir)) {
    if (GENERATED_XHS_FILE.test(name)) fs.unlinkSync(path.join(outputDir, name));
  }
  const moved: string[] = [];
  for (const source of [...result.images, result.captionPath]) {
    const target = path.join(outputDir, path.basename(source));
    fs.renameSync(source, target);
    if (target.toLowerCase().endsWith('.png')) moved.push(target);
  }
  return {
    ...result,
    images: moved,
    captionPath: path.join(outputDir, 'caption.md'),
  };
}

// --- CLI ---

function printUsage(): never {
  console.log(`Markdown → 小红书轮播图

Usage:
  bun md-to-xhs.ts <markdown-file> [options]

Options:
  --out <dir>       Output directory (default: <article-dir>/xhs/)
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

export interface XhsCliOptions {
  markdownPath?: string;
  outDir?: string;
  theme: string;
  aspect: string;
  author: string;
  tags: string;
}

export function parseXhsArgs(args: string[], defaults: XhsConfig): XhsCliOptions {
  const options: XhsCliOptions = {
    theme: defaults.default_theme,
    aspect: defaults.default_aspect,
    author: defaults.default_author,
    tags: defaults.default_topic_tags,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--out' && args[i + 1]) options.outDir = args[++i];
    else if (arg === '--theme' && args[i + 1]) options.theme = args[++i]!;
    else if (arg === '--aspect' && args[i + 1]) options.aspect = args[++i]!;
    else if (arg === '--author' && args[i + 1]) options.author = args[++i]!;
    else if (arg === '--tags' && args[i + 1]) options.tags = args[++i]!;
    else if (!arg.startsWith('-') && !options.markdownPath) options.markdownPath = arg;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
  }

  const loadedConfig = loadXhsConfig();
  const options = parseXhsArgs(args, loadedConfig.config);
  let { markdownPath, outDir } = options;

  if (!markdownPath) {
    console.error('Error: Markdown file path is required');
    process.exit(1);
  }

  if (!fs.existsSync(markdownPath)) {
    console.error(`Error: File not found: ${markdownPath}`);
    process.exit(1);
  }

  if (!outDir) {
    outDir = path.join(path.dirname(path.resolve(markdownPath)), 'xhs');
  }

  const themesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
  validateXhsOptions(options.theme, options.aspect, themesDir);

  console.log(`[md-to-xhs] Rendering: ${markdownPath}`);
  console.log(`[md-to-xhs] Config: ${loadedConfig.source}`);
  console.log(`[md-to-xhs] Theme: ${options.theme} · Aspect: ${options.aspect} · Output: ${outDir}`);

  const stagingDir = `${path.resolve(outDir)}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  let result: RenderResult;
  try {
    const staged = await render(
      markdownPath,
      stagingDir,
      options.theme,
      options.aspect,
      options.author,
      options.tags,
    );
    result = commitGeneratedOutput(staged, stagingDir, path.resolve(outDir));
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  console.log(`\n[md-to-xhs] Done! ${result.totalPages} pages generated:`);
  for (const img of result.images) {
    console.log(`  → ${path.basename(img)}`);
  }
  console.log(`  → caption.md`);
  console.log(`\nOutput JSON:`);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
