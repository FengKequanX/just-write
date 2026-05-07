import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { marked } from 'marked';
import { chromium, type Page } from 'playwright';

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

// --- Utilities ---

function parseFrontmatter(text: string): { fm: Frontmatter; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { fm: {}, body: text };

  const fm: Frontmatter = {};
  for (const line of match[1]!.split('\n')) {
    const ci = line.indexOf(':');
    if (ci > 0) {
      const key = line.slice(0, ci).trim();
      const val = line.slice(ci + 1).trim().replace(/^['"]|['"]$/g, '');
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

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function resolveImagePaths(html: string, baseDir: string): string {
  return html.replace(
    /(<img\s[^>]*src=["'])(?!https?:|data:|file:)([^"']+)/g,
    (_, prefix, src) => {
      const absolute = path.resolve(baseDir, src);
      return `${prefix}${toFileUrl(absolute)}`;
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
    author: author || fm.author || '炙青',
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
  <div class="brand">炙青</div>
  <div class="title">${escapeHtml(title)}</div>
  <div class="divider"></div>
  ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
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

// --- Playwright Rendering ---

async function checkOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const body = document.body;
    return body.scrollHeight > body.clientHeight + 2;
  });
}

async function splitContentByHeight(
  page: Page,
  availableHeight: number,
): Promise<string[][]> {
  return page.evaluate((maxH: number) => {
    const bodyEl = document.querySelector('.body');
    if (!bodyEl) return [[]];

    const children = Array.from(bodyEl.children);
    if (children.length === 0) return [[]];

    const pages: string[][] = [];
    let currentPage: string[] = [];
    let currentHeight = 0;

    for (const child of children) {
      const rect = child.getBoundingClientRect();
      const style = window.getComputedStyle(child);
      const marginTop = parseFloat(style.marginTop) || 0;
      const marginBottom = parseFloat(style.marginBottom) || 0;
      const totalHeight = rect.height + marginTop + marginBottom;

      if (currentHeight + totalHeight > maxH && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        currentHeight = 0;
      }

      currentPage.push(child.outerHTML);
      currentHeight += totalHeight;
    }

    if (currentPage.length > 0) pages.push(currentPage);
    return pages;
  }, availableHeight);
}

async function renderPage(
  page: Page,
  html: string,
  outputPath: string,
): Promise<void> {
  const tempFile = path.join(os.tmpdir(), `xhs-render-${Date.now()}.html`);
  fs.writeFileSync(tempFile, html);
  await page.goto(toFileUrl(tempFile), { waitUntil: 'networkidle' });
  await page.screenshot({ path: outputPath, type: 'png' });

  try {
    fs.unlinkSync(tempFile);
  } catch {
    // ignore cleanup errors
  }
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
    `— ${author || '炙青'}`,
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
  const resolvedAuthor = author || fm.author || '炙青';

  const tokens = marked.lexer(body);
  const sections = splitByHeadings(tokens);
  const pages = buildPageSections(sections, fm, resolvedAuthor, topicTags);
  const css = loadCss(theme);

  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
  });

  const images: string[] = [];
  let pageNum = 1;

  try {
    for (const section of pages) {
      let html: string;

      if (section.type === 'cover') {
        html = buildCoverHtml(section.title, section.bodyHtml, resolvedAuthor, css, pageNum);
        html = resolveImagePaths(html, baseDir);

        const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-cover.png`);
        await renderPage(page, html, imgPath);
        images.push(imgPath);
        pageNum++;
      } else if (section.type === 'ending') {
        html = buildEndingHtml(section.tags || [], section.author || resolvedAuthor, css, pageNum);

        const imgPath = path.join(outDir, `${String(pageNum).padStart(2, '0')}-ending.png`);
        await renderPage(page, html, imgPath);
        images.push(imgPath);
        pageNum++;
      } else {
        html = buildContentHtml(section.title, section.bodyHtml, css, pageNum);
        html = resolveImagePaths(html, baseDir);

        const tempFile = path.join(os.tmpdir(), `xhs-measure-${Date.now()}.html`);
        fs.writeFileSync(tempFile, html);
        await page.goto(toFileUrl(tempFile), { waitUntil: 'networkidle' });

        const hasOverflow = await checkOverflow(page);

        if (!hasOverflow) {
          const imgPath = path.join(
            outDir,
            `${String(pageNum).padStart(2, '0')}-content-${section.slug}.png`,
          );
          await page.screenshot({ path: imgPath, type: 'png' });
          images.push(imgPath);
          pageNum++;
        } else {
          const titleHeight = section.title ? SECTION_TITLE_HEIGHT : 0;
          const availableHeight =
            size.height - CONTENT_TOP_PAD - CONTENT_BOTTOM_PAD - PAGE_NUM_HEIGHT - titleHeight;
          const chunks = await splitContentByHeight(page, availableHeight);

          for (let i = 0; i < chunks.length; i++) {
            const chunkHtml = buildContentHtml(
              i === 0 ? section.title : '',
              chunks[i]!.join('\n'),
              css,
              pageNum,
            );
            const resolved = resolveImagePaths(chunkHtml, baseDir);
            const imgPath = path.join(
              outDir,
              `${String(pageNum).padStart(2, '0')}-content-${section.slug}.png`,
            );
            await renderPage(page, resolved, imgPath);
            images.push(imgPath);
            pageNum++;
          }
        }

        try {
          fs.unlinkSync(tempFile);
        } catch {
          // ignore
        }
      }
    }
  } finally {
    await browser.close();
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

Output:
  <out>/01-cover.png
  <out>/02-content-<slug>.png
  <out>/NN-ending.png
  <out>/caption.md

Example:
  bun md-to-xhs.ts article.md --out ./xhs-images --author 炙青
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
