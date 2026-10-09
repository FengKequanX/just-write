import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { operationResult } from '../../../lib/platform-result';
import { marked, type Token } from 'marked';
import { loadXhsConfig, validateXhsOptions, type XhsConfig } from './xhs-config';
import { inspectReadingHtml, normalizeReadingBreaks, preserveExplicitBreaks } from '../../../lib/reading-format';
import { IMAGE_LAYOUT_SCRIPT } from './image-layout';

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
const MAX_TOPIC_TAGS = 5;
export const MAX_CAROUSEL_IMAGES = 18;
// 复杂文章需要多次测量和拆分，分页的限时与单页截图分别设置。
const PAGINATION_TIMEOUT_MS = 90_000;
const CONTENT_TOP_PAD = 56;
const CONTENT_BOTTOM_PAD = 56;
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
      '--allow-file-access-from-files',
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
  timeoutMs = 30_000,
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
      '--allow-file-access-from-files',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=8000',
      `--window-size=${width},${height}`,
      '--dump-dom',
      fileUrl,
    ];

    const proc = spawn(chrome, args, { stdio: 'pipe' });
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Chrome DOM 测量超时（${timeoutMs / 1000} 秒）`));
    }, timeoutMs);

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

export function normalizeStrongAdjacency(markdown: string): string {
  return markdown.replace(
    /\*\*([^*\r\n]+?)\*\*(?=[\p{L}\p{N}])/gu,
    '**$1**<!-- -->',
  );
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

  const contentHtml = normalizeReadingHtml(normalizeReadingBreaks(contentHtmlParts.join('\n')));
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
<body class="cover${coverImage ? ' cover--with-image' : ' cover--text-only'}" style="${dims}">
  <div class="cover-content">
    <div class="cover-kicker"><span class="kicker-dot"></span><span>${escapeHtml(author)}</span></div>
    ${coverImage ? `<div class="cover-image" style="--cover-source-ratio:${escapeHtml(coverAspectRatio)}"><img class="cover-image-bg" src="${escapeHtml(coverImage)}" alt="" aria-hidden="true"><img class="cover-image-fg" src="${escapeHtml(coverImage)}" alt=""></div>` : ''}
    <div class="title-area">
      <div class="title">${escapeHtml(title)}</div>
      ${!coverImage && subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    <div class="cover-footer">
      <span>JUST WRITE</span>
      <span>共 ${String(totalPages).padStart(2, '0')} 页 · 右滑阅读</span>
    </div>
  </div>
  <script>
    (async () => {
      await document.fonts.ready;
      const root = document.body;
      const content = root.querySelector('.cover-content');
      if (!content) return;

      const values = {
        topPadding: 56,
        bottomPadding: 56,
        imageGap: 24,
        titleGap: 44,
        subtitleGap: 22,
        footerGap: 22,
        titleSize: parseFloat(getComputedStyle(root).getPropertyValue('--cover-title-size')) || 64,
        subtitleSize: 29,
      };
      const minimums = {
        topPadding: 44,
        bottomPadding: 44,
        imageGap: 20,
        titleGap: 32,
        subtitleGap: 12,
        footerGap: 14,
        titleSize: 46,
        subtitleSize: 22,
      };
      const gapKeys = ['topPadding', 'bottomPadding', 'imageGap', 'titleGap', 'subtitleGap', 'footerGap'];
      const fontKeys = ['titleSize', 'subtitleSize'];
      const cssNames = {
        topPadding: '--cover-top-padding',
        bottomPadding: '--cover-bottom-padding',
        imageGap: '--cover-image-gap',
        titleGap: '--cover-title-gap',
        subtitleGap: '--cover-subtitle-gap',
        footerGap: '--cover-footer-gap',
        titleSize: '--cover-title-size',
        subtitleSize: '--cover-subtitle-size',
      };
      const overflows = () => content.scrollHeight > content.clientHeight + 1;
      const reduce = (keys, amount) => {
        let changed = false;
        for (const key of keys) {
          if (values[key] <= minimums[key]) continue;
          values[key] = Math.max(minimums[key], values[key] - amount);
          root.style.setProperty(cssNames[key], values[key] + 'px');
          changed = true;
        }
        return changed;
      };

      let adjusted = false;
      while (overflows() && reduce(gapKeys, 2)) adjusted = true;
      while (overflows() && reduce(fontKeys, 1)) adjusted = true;
      root.dataset.coverFit = adjusted ? 'compact' : 'default';
      root.dataset.coverOverflow = overflows() ? 'true' : 'false';
    })();
  </script>
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
  const layoutClass = bodyHtml.includes('data-xhs-image-page')
    ? 'content--image-page'
    : `content--${layout}`;
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
): Promise<{ pages: string[]; metrics: ContentPageMetrics[] }> {
  const sourceHtml = resolveImagePaths(addImageDimensions(bodyHtml, baseDir), baseDir);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="content content--prose" style="${dims}">
  <div id="measure" class="body" style="width:${viewportWidth}px;flex:none;height:auto;display:flow-root;"></div>
  <script id="xhs-source" type="application/json">${jsonForScript(sourceHtml)}</script>
  <script>
    (async () => {
      const limit = ${viewportHeight};
      const imageViewportWidth = ${viewportWidth};
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
        const loadedImages = new Map();
        source.innerHTML = sourceHtml;
        const imageSources = Array.from(source.querySelectorAll('img'))
          .map((img) => img.currentSrc || img.src)
          .filter(Boolean);
        await Promise.all(imageSources.map((src) => new Promise((resolve, reject) => {
          const img = new Image();
          const timeout = setTimeout(() => reject(new Error('image load timed out: ' + src)), 6000);
          img.onload = () => { clearTimeout(timeout); loadedImages.set(src, img); resolve(undefined); };
          img.onerror = () => { clearTimeout(timeout); reject(new Error('image failed to load: ' + src)); };
          img.src = src;
          if (img.complete && img.naturalWidth > 0) {
            clearTimeout(timeout);
            loadedImages.set(src, img);
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
          if (tag === 'img' || element.querySelector('img')) return 'image';
          return 'other';
        };
        const blockFromNode = (node, forcedKind) => {
          const html = serializeNode(node);
          const element = node.nodeType === Node.ELEMENT_NODE ? node : null;
          return {
            html,
            kind: forcedKind || (element ? kindOfElement(element) : 'paragraph'),
            hasImage: !!(element && (element.matches('img') || element.querySelector('img'))),
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
            container.querySelectorAll('[data-xhs-decoration="true"]').forEach((node) => node.remove());
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
          const tops = [];
          const tolerance = parseFloat(getComputedStyle(measureEl).lineHeight) * 0.3;
          const walker = document.createTreeWalker(measureEl, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (!(walker.currentNode.nodeValue || '').trim()) continue;
            // 只统计文字行，不能把段落、列表容器的外框误算成另一行。
            range.selectNodeContents(walker.currentNode);
            for (const rect of Array.from(range.getClientRects())) {
              if (rect.width <= 0 || rect.height <= 0) continue;
              if (!tops.some((top) => Math.abs(top - rect.top) < tolerance)) tops.push(rect.top);
            }
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
          if (enforceWidows && totalLines < 4) return null;
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
            const headLines = enforceWidows ? lineCount(candidate.head) : 2;
            const tailLines = enforceWidows ? lineCount(candidate.tail) : 2;
            if (fits && headLines >= 2 && tailLines >= 2) {
              if (candidateLength > bestLength) {
                best = candidate;
                bestLength = candidateLength;
              }
              low = mid + 1;
            } else if (!fits || tailLines < 2) {
              high = mid - 1;
            } else low = mid + 1;
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
        const fitImageBlock = (block, prefix = '') => {
          const container = document.createElement('div');
          container.innerHTML = block.html;
          const images = Array.from(container.querySelectorAll('img'));
          if (images.length === 0) return null;
          let low = Math.ceil(Math.max(...images.map((img) => {
            const size = loadedImages.get(img.src);
            return size ? imageViewportWidth * 0.75 * size.naturalHeight / size.naturalWidth : limit;
          })));
          let high = Math.floor(limit);
          let best = null;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            images.forEach((img) => {
              img.style.maxHeight = mid + 'px';
              img.style.height = 'auto';
              const size = loadedImages.get(img.src);
              if (size) img.style.width = Math.min(imageViewportWidth, mid * size.naturalWidth / size.naturalHeight) + 'px';
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
        ${IMAGE_LAYOUT_SCRIPT}
        const prefixWithLines = (block, minimumLines) => {
          if (block.hasImage) return minimumImagePrefix(block);
          if (visibleLength(block.html) === 0) return block.html;
          if (lineCount(block.html) < 4) return block.html;
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
        const blocks = mergeImageCaptions(extractBlocks(source.innerHTML));
        const pages = [];
        let current = '';
        let pendingHeading = '';

        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          if (block.kind === 'heading') {
            // 连续父子标题视作一组，与后续正文一起决定是否换页。
            let headingEnd = i;
            let headings = block.html;
            while (blocks[headingEnd + 1]?.kind === 'heading') headings += blocks[++headingEnd].html;
            const next = blocks[headingEnd + 1];
            if (!next) throw new Error('heading has no following content');
            const imagePages = planImagePages(next, headings);
            if (imagePages) {
              if (current.trim()) pages.push(current);
              current = '';
              pages.push(...imagePages);
              pendingHeading = '';
              i = headingEnd + 1;
              continue;
            }
            const required = headings + prefixWithLines(next, 2);
            if (heightOf(required) > limit) throw new Error('heading and two following lines exceed one page');
            if (current.trim() && heightOf(current + required) > limit) {
              pages.push(current);
              current = '';
            }
            current += headings;
            pendingHeading = headings;
            i = headingEnd;
            continue;
          }

          const imagePages = planImagePages(block);
          if (imagePages) {
            if (current.trim()) pages.push(current);
            current = '';
            pages.push(...imagePages);
            continue;
          }

          if (heightOf(current + block.html) <= limit) {
            current += block.html;
            pendingHeading = '';
            continue;
          }

          if (current.trim()) {
            const split = block.hasImage ? splitImageToFit(current, block)
              : ['paragraph', 'list-item', 'blockquote', 'code', 'table'].includes(block.kind)
              ? block.kind === 'code'
                ? splitCodeToFit(current, block)
                : block.kind === 'table'
                  ? splitTableToFit(current, block)
                  : splitTextToFit(current, block, true)
              : null;
            if (split) {
              pendingHeading = '';
              if (split.tail) {
                pages.push(current + split.head);
                current = '';
                blocks[i] = blockFromHtml(split.tail, block.kind);
                i--;
              } else current += split.head;
              continue;
            }
            if (pendingHeading) {
              // 标题预估前缀可容纳，但正文不能安全拆分时，将整组标题带到下一页。
              const preceding = current.slice(0, -pendingHeading.length);
              if (!preceding.trim()) throw new Error('标题与后续内容无法安全放在同一页');
              pages.push(preceding);
              current = pendingHeading;
              i--;
              continue;
            }
            pages.push(current);
            current = '';
            i--;
            continue;
          }

          if (block.hasImage) {
            const split = splitImageToFit('', block);
            if (split) {
              if (split.tail) {
                pages.push(split.head);
                blocks[i] = blockFromHtml(split.tail, block.kind);
                i--;
              } else current = split.head;
              continue;
            }
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

        const metrics = pages.map((page, index) => {
          const height = heightOf(page);
          const pageBlocks = extractBlocks(page);
          if (height > limit + 0.5) {
            throw new Error('page ' + (index + 1) + ' overflows by ' + Math.ceil(height - limit) + 'px');
          }
          if (pageBlocks.length > 0 && pageBlocks[pageBlocks.length - 1].kind === 'heading') {
            throw new Error('page ' + (index + 1) + ' ends with an orphan heading');
          }
          const images = Array.from(measureEl.querySelectorAll('img')).map((img) => {
            const rect = img.getBoundingClientRect();
            const frame = img.closest('.xhs-image-frame');
            const dimensions = imageDimensions.get(Number(img.dataset.xhsSourceIndex));
            return {
              sourceIndex: Number(img.dataset.xhsSourceIndex),
              source: img.src,
              sourceWidth: dimensions.width,
              sourceHeight: dimensions.height,
              displayWidth: rect.width,
              displayHeight: frame ? frame.getBoundingClientRect().height : rect.height,
              mode: img.dataset.xhsImageMode || 'inline',
              sliceStart: Number(img.dataset.xhsSliceStart || 0),
              sliceEnd: Number(img.dataset.xhsSliceEnd || dimensions.height),
            };
          });
          return { height, occupancy: height / limit, blockKinds: pageBlocks.map((item) => item.kind), images };
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
        const expectedImageOrder = Array.from(source.querySelectorAll('img')).map((img) => Number(img.dataset.xhsSourceIndex));
        const actualImageOrder = metrics.flatMap((page) => page.images.map((img) => img.sourceIndex))
          .filter((index, position, list) => position === 0 || index !== list[position - 1]);
        if (JSON.stringify(expectedImageOrder) !== JSON.stringify(actualImageOrder)) {
          throw new Error('分页后的图片顺序或数量与原文不同');
        }
        for (const sourceIndex of expectedImageOrder) {
          const slices = metrics.flatMap((page) => page.images).filter((image) => image.sourceIndex === sourceIndex);
          let coveredUntil = 0;
          for (const slice of slices) {
            if (slice.sliceStart > coveredUntil + 0.5 || slice.sliceEnd <= slice.sliceStart) {
              throw new Error('图片 ' + sourceIndex + ' 分段不连续');
            }
            coveredUntil = Math.max(coveredUntil, slice.sliceEnd);
          }
          if (Math.abs(coveredUntil - imageDimensions.get(sourceIndex).height) > 0.5) {
            throw new Error('图片 ' + sourceIndex + ' 未完整覆盖原图');
          }
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
    const dom = await dumpDomWithChrome(html, size.width, size.height, PAGINATION_TIMEOUT_MS);
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
    return { pages, metrics: result.metrics };
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

export function generateCaption(
  title: string,
  author: string,
  fm: Frontmatter,
  topics: string[],
  captionBody?: string,
): string {
  const description = captionBody !== undefined ? captionBody : fm.description || fm.summary || '';
  const tagStr = topics.map((topic) => `#${topic}`).join(' ');

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

function parseTopicTags(topicTags: string): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];

  for (const rawTag of topicTags.split(',')) {
    const topic = rawTag.trim().replace(/^#+/, '').replace(/\s+/g, '');
    const key = topic.toLocaleLowerCase();
    if (!topic || seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length === MAX_TOPIC_TAGS) break;
  }

  return topics;
}

export function resolveCaptionTopics(
  title: string,
  body: string,
  fm: Frontmatter,
  topicTags: string,
): string[] {
  const articleTopics = parseTopicTags(topicTags);
  if (articleTopics.length > 0) return articleTopics;

  const searchableContent = [title, fm.description || fm.summary || '', body].join('\n');
  return extractContentTags(searchableContent);
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

  return tags.slice(0, MAX_TOPIC_TAGS);
}

// --- Main Render ---

export interface ImagePageMetrics {
  sourceIndex: number;
  source: string;
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number;
  displayHeight: number;
  mode: 'inline' | 'page' | 'split';
  sliceStart: number;
  sliceEnd: number;
}

export interface ContentPageMetrics {
  height: number;
  occupancy: number;
  blockKinds: string[];
  images: ImagePageMetrics[];
}

export interface CarouselReport {
  title: string;
  aspect: string;
  width: number;
  height: number;
  contentWidth: number;
  availableHeight: number;
  maxImages: number;
  typography: 'standard' | 'compact';
  textPreserved: boolean;
  imageOrderPreserved: boolean;
  warnings: string[];
  pages: Array<{ file: string; type: PageSection['type']; metrics?: ContentPageMetrics; layoutChecked: boolean }>;
}

export class CarouselLimitError extends Error {
  constructor(public readonly neededImages: number, public readonly pageMetrics: ContentPageMetrics[]) {
    super(`完整内容需要 ${neededImages} 张，超过 ${MAX_CAROUSEL_IMAGES} 张上限。请拆分为多篇或精简内容；未生成超限轮播，也未删除原文。`);
    this.name = 'CarouselLimitError';
  }
}

async function validatePageWithChrome(html: string, size: AspectSize): Promise<void> {
  const instrumented = html.replace('</body>', `<script>
  (async()=>{
    try {
      await document.fonts.ready;
      // 无头 DOM 导出中 PNG 的 decode() 可能一直等待；布局只需加载后的自然尺寸。
      await Promise.all(Array.from(document.images).map(img=>new Promise((resolve,reject)=>{
        const done=()=>img.naturalWidth>0?resolve():reject(new Error('图片加载失败：'+img.src));
        if(img.complete)done();else{img.addEventListener('load',done,{once:true});img.addEventListener('error',()=>reject(new Error('图片加载失败：'+img.src)),{once:true});}
      })));
      const root=document.body;
      const outside=[];
      root.querySelectorAll('.body,p,h2,h3,blockquote,table,pre,.xhs-image-frame,.cover-content,.cover-image,.cover-image-fg,.cover-footer,.ending-content,.ending-meta,.ending-footer,.title,.subtitle').forEach(el=>{
        const rect=el.getBoundingClientRect();
        if(rect.width===0||rect.height===0)return;
        // 封面图有意延伸到画布边缘；容器和图片仍逐一检查画布边界。
        const checkInnerWidth=!el.matches('.cover-content,.cover-image');
        if(rect.left < -1 || rect.right > root.clientWidth+1 || rect.top < -1 || rect.bottom > root.clientHeight+1 || (checkInnerWidth && el.scrollWidth > el.clientWidth+2)) outside.push(el.className||el.tagName);
      });
      if(root.dataset.coverOverflow==='true')outside.push('封面文字');
      const pre=document.createElement('pre');pre.id='xhs-layout-result';pre.textContent=btoa(unescape(encodeURIComponent(JSON.stringify({outside}))));root.append(pre);
    }catch(error){const pre=document.createElement('pre');pre.id='xhs-layout-result';pre.textContent=btoa(unescape(encodeURIComponent(JSON.stringify({error:String(error)}))));document.body.append(pre);}
  })();
  </script></body>`);
  let match: RegExpMatchArray | null = null;
  for (let attempt = 0; attempt < 2 && !match; attempt++) {
    const dom = await dumpDomWithChrome(instrumented, size.width, size.height);
    match = dom.match(/<pre id="xhs-layout-result">([^<]+)<\/pre>/);
  }
  if (!match) throw new Error('渲染后布局检查没有返回结果');
  const result = JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8'));
  if (result.error || result.outside?.length) throw new Error(`渲染后发现溢出或图片加载失败：${result.error || result.outside.join('、')}`);
}

export interface RenderResult {
  images: string[];
  captionPath: string;
  title: string;
  topics: string[];
  totalPages: number;
  previewPath?: string;
  reportPath?: string;
}

function buildPreviewHtml(report: CarouselReport): string {
  const pages = report.pages.map((page, index) => `<figure><a href="${escapeHtml(page.file)}" target="_blank"><img src="${escapeHtml(page.file)}" alt="第 ${index + 1} 页" loading="lazy"></a><figcaption>${index + 1} / ${report.pages.length}</figcaption></figure>`).join('\n');
  const warnings = report.warnings.length ? `<details><summary>需要检查的阅读问题（${report.warnings.length}）</summary><ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></details>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.title)} · 轮播预览</title><style>
  *{box-sizing:border-box}body{margin:0;padding:24px;background:#f2efe9;color:#17171b;font:16px/1.6 system-ui,sans-serif}h1{font-size:22px;margin:0 0 12px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 20px}button{font:inherit;padding:6px 12px;border:1px solid #bdb7af;border-radius:6px;background:#fff;color:#17171b;cursor:pointer}button[aria-pressed=true]{background:#17171b;color:#fff}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr));gap:24px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{margin-top:6px;text-align:center;color:#4b5563}main.phone{display:flex;flex-direction:column;align-items:center}main.phone figure{width:min(var(--phone-width),100%)}details{margin:12px 0}a:focus-visible,button:focus-visible{outline:3px solid #2563eb;outline-offset:3px}
  </style></head><body><h1>${escapeHtml(report.title)}</h1><nav aria-label="预览尺寸"><button data-width="0" aria-pressed="true">整组总览</button><button data-width="360" aria-pressed="false">手机 360px</button><button data-width="390" aria-pressed="false">手机 390px</button><button data-width="430" aria-pressed="false">手机 430px</button></nav>${warnings}<main>${pages}</main><script>
  const main=document.querySelector('main');document.querySelectorAll('button[data-width]').forEach(button=>button.addEventListener('click',()=>{const width=Number(button.dataset.width);main.classList.toggle('phone',width>0);main.style.setProperty('--phone-width',width+'px');document.querySelectorAll('button[data-width]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));}));
  </script></body></html>`;
}

export async function render(
  markdownPath: string,
  outDir: string,
  theme: string,
  aspect: string,
  author: string,
  topicTags: string,
  captionBody?: string,
): Promise<RenderResult> {
  const size = ASPECT_SIZES[aspect] || ASPECT_SIZES[DEFAULT_ASPECT];
  const absMarkdown = path.resolve(markdownPath);
  const baseDir = path.dirname(absMarkdown);
  const content = fs.readFileSync(absMarkdown, 'utf-8');
  const { fm, body } = parseFrontmatter(content);
  const resolvedAuthor = author || fm.author || '作者名';

  const tokens = marked.lexer(preserveExplicitBreaks(normalizeStrongAdjacency(body)), { breaks: false });
  const sections = splitByHeadings(tokens);
  const pages = buildPageSections(sections, fm, resolvedAuthor, baseDir);
  const title = pages.find((p) => p.type === 'cover')?.title || fm.title || '未命名';
  const topics = resolveCaptionTopics(title, body, fm, topicTags);
  const endingPage = pages.find((page) => page.type === 'ending');
  if (endingPage) endingPage.tags = topics;
  const baseCss = loadCss(theme);
  let css = baseCss;
  let typography: CarouselReport['typography'] = 'standard';
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
    metrics?: ContentPageMetrics;
  }
  const planned: PlannedPage[] = [];

  // 默认字号为 42px；只允许一次有界压紧，最小 40px，不无限缩字凑页数。
  const profiles = theme === 'default'
    ? [baseCss, baseCss + '\n.content .body { font-size:40px; line-height:1.4; }\n.content .body p { margin-bottom:12px; }\n.content .body h2.inline-section-title { font-size:48px; }']
    : [baseCss];
  for (let pass = 0; pass < profiles.length; pass++) {
    css = profiles[pass]!;
    typography = pass === 0 ? 'standard' : 'compact';
    planned.length = 0;
    for (const section of pages) {
      if (section.type === 'cover' || section.type === 'ending') {
        planned.push({ section, chunkIndex: 0, totalChunks: 1, bodyHtml: section.bodyHtml });
      } else {
        const measured = await measureContentPagesWithChrome(
          section.bodyHtml, css + dimensionCss, dims, size, availableHeight, contentWidth, baseDir,
        );
        for (let i = 0; i < measured.pages.length; i++) {
          planned.push({ section, chunkIndex: i, totalChunks: measured.pages.length, bodyHtml: measured.pages[i]!, metrics: measured.metrics[i] });
        }
      }
    }
    if (planned.length <= MAX_CAROUSEL_IMAGES) break;
  }

  const totalPages = planned.length;
  if (totalPages > MAX_CAROUSEL_IMAGES) {
    throw new CarouselLimitError(totalPages, planned.flatMap(page => page.metrics ? [page.metrics] : []));
  }
  const mainTitle = pages.find((p) => p.type === 'cover')?.title || '';

  // Phase 2: Render with known totalPages
  const images: string[] = [];

  for (let idx = 0; idx < planned.length; idx++) {
    const { section, chunkIndex, bodyHtml, metrics } = planned[idx]!;
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
      await validatePageWithChrome(html, size);
      await renderWithChrome(html, imgPath, size.width, size.height);
      images.push(imgPath);
    } else if (section.type === 'ending') {
      html = buildEndingHtml(section.tags || [], section.author || resolvedAuthor, css + dimensionCss, pageNum, totalPages, dims);
      const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-ending.png`);
      await validatePageWithChrome(html, size);
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
      await validatePageWithChrome(html, size);
      await renderWithChrome(html, imgPath, size.width, size.height);
      images.push(imgPath);
    }
  }

  const caption = generateCaption(title, resolvedAuthor, fm, topics, captionBody);
  const captionPath = path.join(outDir, 'caption.md');
  fs.writeFileSync(captionPath, caption, 'utf-8');
  const warnings = inspectReadingHtml(pages.filter((page) => page.type === 'content').map((page) => page.bodyHtml).join('\n'));
  const imageMetrics = planned.flatMap((page) => page.metrics?.images || []);
  for (const metric of imageMetrics) {
    if (metric.displayWidth < contentWidth * 0.7) warnings.push(`图片 ${metric.sourceIndex} 显示偏窄，请在手机预览检查文字大小。`);
    if (metric.sourceWidth < metric.displayWidth * 0.8) warnings.push(`图片 ${metric.sourceIndex} 原始分辨率偏低，放大不能补回细节。`);
  }
  for (const file of images) {
    const actual = readImageSize(file);
    if (!actual || actual.width !== size.width || actual.height !== size.height) throw new Error(`渲染尺寸不正确：${file}`);
  }
  const report: CarouselReport = {
    title, aspect, width: size.width, height: size.height, contentWidth, availableHeight,
    maxImages: MAX_CAROUSEL_IMAGES, typography,
    textPreserved: true, imageOrderPreserved: true, warnings: [...new Set(warnings)],
    pages: planned.map((page, index) => ({ file: path.basename(images[index]!), type: page.section.type, metrics: page.metrics, layoutChecked: true })),
  };
  const reportPath = path.join(outDir, 'render-report.json');
  const previewPath = path.join(outDir, 'preview.html');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(previewPath, buildPreviewHtml(report), 'utf8');
  return { images, captionPath, title, topics, totalPages, reportPath, previewPath };
}

const GENERATED_XHS_FILE = /^(?:\d{2,}-.*\.png|caption\.md|preview\.html|render-report\.json)$/i;

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
  for (const source of [...result.images, result.captionPath, result.previewPath, result.reportPath].filter((file): file is string => Boolean(file))) {
    const target = path.join(outputDir, path.basename(source));
    fs.renameSync(source, target);
    if (target.toLowerCase().endsWith('.png')) moved.push(target);
  }
  return {
    ...result,
    images: moved,
    captionPath: path.join(outputDir, 'caption.md'),
    previewPath: result.previewPath ? path.join(outputDir, 'preview.html') : undefined,
    reportPath: result.reportPath ? path.join(outputDir, 'render-report.json') : undefined,
  };
}

// --- CLI ---

function printUsage(): never {
  console.log(`Markdown → 小红书轮播图

用法：
  bun md-to-xhs.ts <markdown-file> [options]

参数：
  --out <dir>       输出目录（默认：<article-dir>/xhs/）
  --theme <name>    主题（默认：default）
  --aspect <ratio>  比例：3:4 | 9:16 | 1:1 | 4:3（默认：3:4）
  --author <name>   作者名
  --tags <tags>     本篇准确话题，至多五个，用逗号分隔；不要求凑满
  --caption-body-file <path> 独立 UTF-8 配文正文；显式空文件优先于摘要
  --json           仅输出结构结果，日志写 stderr，可供工作流登记
  --help           显示帮助

环境变量：
  CHROME_PATH      Chrome 可执行文件路径

输出：
  <out>/01-cover.png
  <out>/02-content-<slug>.png
  <out>/caption.md
  <out>/preview.html          整组总览及 360/390/430px 手机预览
  <out>/render-report.json    文字、图片顺序、分段覆盖与布局检查

示例：
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
  captionBodyFile?: string;
  json?: boolean;
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
    if (['--out', '--theme', '--aspect', '--author', '--tags', '--caption-body-file'].includes(arg) &&
      (args[i + 1] === undefined || args[i + 1]!.startsWith('--'))) throw new Error(`参数缺少值：${arg}`);
    if (arg === '--json') options.json = true;
    else if (arg === '--out' && args[i + 1]) options.outDir = args[++i];
    else if (arg === '--theme' && args[i + 1]) options.theme = args[++i]!;
    else if (arg === '--aspect' && args[i + 1]) options.aspect = args[++i]!;
    else if (arg === '--author' && args[i + 1]) options.author = args[++i]!;
    else if (arg === '--tags' && args[i + 1]) options.tags = args[++i]!;
    else if (arg === '--caption-body-file' && args[i + 1]) options.captionBodyFile = args[++i]!;
    else if (!arg.startsWith('-') && !options.markdownPath) options.markdownPath = arg;
    else throw new Error(`未知或不完整参数：${arg}`);
  }
  return options;
}

export async function main(args = process.argv.slice(2), dependencies: { loadConfig?: typeof loadXhsConfig; render?: typeof render } = {}): Promise<number> {
  try {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      printUsage();
    }

    const loadedConfig = (dependencies.loadConfig ?? loadXhsConfig)();
    const options = parseXhsArgs(args, loadedConfig.config);
    let { markdownPath, outDir } = options;

    if (!markdownPath) {
      throw new Error('需要 Markdown 文件路径');
    }

    if (!fs.existsSync(markdownPath)) {
      throw new Error(`文件不存在：${markdownPath}`);
    }

    if (!outDir) {
      outDir = path.join(path.dirname(path.resolve(markdownPath)), 'xhs');
    }

    const themesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
    validateXhsOptions(options.theme, options.aspect, themesDir);

    const log = console.error;
    log(`[md-to-xhs] 渲染：${markdownPath}`);
    log(`[md-to-xhs] 配置：${loadedConfig.source}`);
    log(`[md-to-xhs] 主题：${options.theme} · 比例：${options.aspect} · 目录：${outDir}`);

    const stagingDir = `${path.resolve(outDir)}.tmp-${process.pid}-${Date.now()}`;
    const captionBody = options.captionBodyFile !== undefined ? fs.readFileSync(path.resolve(options.captionBodyFile), 'utf8') : undefined;
    fs.rmSync(stagingDir, { recursive: true, force: true });
    let result: RenderResult;
    try {
      const staged = await (dependencies.render ?? render)(
        markdownPath,
        stagingDir,
        options.theme,
        options.aspect,
        options.author,
        options.tags,
        captionBody,
      );
      result = commitGeneratedOutput(staged, stagingDir, path.resolve(outDir));
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }

    log(`\n[md-to-xhs] 已生成 ${result.totalPages} 张图片：`);
    for (const img of result.images) {
      log(`  → ${path.basename(img)}`);
    }
    log(`  → caption.md`);
    log(`  → preview.html`);
    log(`  → render-report.json`);
    const report = JSON.parse(fs.readFileSync(result.reportPath!, 'utf8')) as CarouselReport;
    for (const warning of report.warnings) console.warn(`[阅读检查] ${warning}`);
    const sourceDigest = createHash('sha256').update(fs.readFileSync(markdownPath)).digest('hex');
    const inputDigest = createHash('sha256').update(JSON.stringify({ sourceDigest, captionBody, theme: options.theme, aspect: options.aspect, author: options.author, tags: options.tags })).digest('hex');
    const outcome = operationResult('xhs', 'generate', 'generated', { inputDigest,
      inputSummary: { markdownSha256: sourceDigest, imageCount: result.totalPages, title: result.title, captionPath: result.captionPath },
      message: '本地文件生成完成；实际视觉检查由技能交付流程核对',
    });
    console.log(JSON.stringify({ ...result, result: outcome }, null, 2));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[md-to-xhs] ' + message);
    if (args.includes('--json')) console.log(JSON.stringify({ result: operationResult('xhs', 'generate', 'failed', { message }) }));
    return error instanceof CarouselLimitError ? 1 : 2;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
