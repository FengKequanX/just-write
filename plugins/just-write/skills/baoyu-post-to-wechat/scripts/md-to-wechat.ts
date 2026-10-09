import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { inspectReadingHtml, normalizeReadingBreaks, preserveExplicitBreaks } from "../../../lib/reading-format.ts";

import {
  extractSummaryFromBody,
  extractTitleFromMarkdown,
  parseFrontmatter,
  renderMarkdownDocument,
  replaceMarkdownImagesWithPlaceholders,
  resolveColorToken,
  resolveContentImages,
  serializeFrontmatter,
  stripWrappingQuotes,
} from "baoyu-md";
import {
  applyWechatEditorialTypography,
  normalizeReferenceMarkdown,
  XHS_DEFAULT_ACCENT,
} from "./wechat-typography.ts";

interface ImageInfo {
  placeholder: string;
  localPath: string;
  originalPath: string;
}

interface ParsedResult {
  title: string;
  author: string;
  summary: string;
  htmlPath: string;
  contentImages: ImageInfo[];
  readingWarnings: string[];
}

export async function convertMarkdown(
  markdownPath: string,
  options?: { title?: string; theme?: string; color?: string; citeStatus?: boolean },
): Promise<ParsedResult> {
  const baseDir = path.dirname(markdownPath);
  const content = fs.readFileSync(markdownPath, "utf-8");
  const citeStatus = options?.citeStatus ?? true;

  const { frontmatter, body } = parseFrontmatter(content);

  let title = stripWrappingQuotes(options?.title ?? "")
    || stripWrappingQuotes(frontmatter.title ?? "")
    || extractTitleFromMarkdown(body);
  if (!title) {
    title = path.basename(markdownPath, path.extname(markdownPath));
  }

  const author = stripWrappingQuotes(frontmatter.author ?? "");
  let summary = stripWrappingQuotes(frontmatter.description ?? "")
    || stripWrappingQuotes(frontmatter.summary ?? "");
  if (!summary) {
    summary = extractSummaryFromBody(body, 120);
  }

  const normalizedBody = preserveExplicitBreaks(normalizeReferenceMarkdown(body));
  const { images, markdown: rewrittenBody } = replaceMarkdownImagesWithPlaceholders(
    normalizedBody,
    "WECHATIMGPH_",
  );
  const rewrittenMarkdown = `${serializeFrontmatter(frontmatter)}${rewrittenBody}`;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-article-images-"));
  const htmlPath = path.join(tempDir, "temp-article.html");

  console.error(
    `[md-to-wechat] Rendering markdown with theme: ${options?.theme ?? "default"}${options?.color ? `, color: ${options.color}` : ""}, citeStatus: ${citeStatus}`,
  );

  const theme = options?.theme ?? "default";
  const configuredColor = resolveColorToken(options?.color);
  const rendered = await renderMarkdownDocument(rewrittenMarkdown, {
    citeStatus,
    defaultTitle: title,
    // 上游 keepTitle:false 会删掉任意首个标题；仅正文以一级文章标题开头时去重。
    keepTitle: !/^\s*#(?!#)\s/.test(body),
    primaryColor: theme === "default" ? configuredColor ?? XHS_DEFAULT_ACCENT : configuredColor,
    theme: options?.theme,
  });
  const normalizedHtml = normalizeReadingBreaks(rendered.html);
  const html = theme === "default"
    ? applyWechatEditorialTypography(normalizedHtml, rendered.style.primaryColor)
    : normalizedHtml;
  fs.writeFileSync(htmlPath, html, "utf-8");

  const contentImages = await resolveContentImages(images, baseDir, tempDir, "md-to-wechat");

  return {
    title,
    author,
    summary,
    htmlPath,
    contentImages,
    readingWarnings: inspectReadingHtml(html),
  };
}

function printUsage(): never {
  console.log(`Convert Markdown to WeChat-ready HTML with image placeholders

Usage:
  npx -y bun md-to-wechat.ts <markdown_file> [options]

Options:
  --title <title>     Override title
  --theme <name>      Theme name (default, grace, simple, modern)
  --color <name|hex>  Primary color (blue, green, vermilion, etc. or hex)
  --no-cite           Disable bottom citations for ordinary external links
  --help              Show this help

Output JSON format:
{
  "title": "Article Title",
  "htmlPath": "/tmp/wechat-article-images/temp-article.html",
  "contentImages": [
    {
      "placeholder": "WECHATIMGPH_1",
      "localPath": "/tmp/wechat-image/img.png",
      "originalPath": "imgs/image.png"
    }
  ]
}

Example:
  npx -y bun md-to-wechat.ts article.md
  npx -y bun md-to-wechat.ts article.md --theme grace
  npx -y bun md-to-wechat.ts article.md --theme modern --color blue
  npx -y bun md-to-wechat.ts article.md --no-cite
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
  }

  let markdownPath: string | undefined;
  let title: string | undefined;
  let theme: string | undefined;
  let color: string | undefined;
  let citeStatus = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (['--title', '--theme', '--color'].includes(arg) && (args[i + 1] === undefined || args[i + 1]!.startsWith('--'))) throw new Error(`参数缺少值：${arg}`);
    if (arg === "--title" && args[i + 1]) {
      title = args[++i];
    } else if (arg === "--theme" && args[i + 1]) {
      theme = args[++i];
    } else if (arg === "--color" && args[i + 1]) {
      color = args[++i];
    } else if (arg === "--cite") {
      citeStatus = true;
    } else if (arg === "--no-cite") {
      citeStatus = false;
    } else if (!arg.startsWith("-") && !markdownPath) {
      markdownPath = arg;
    } else throw new Error(`未知参数：${arg}`);
  }

  if (!markdownPath) {
    console.error("Error: Markdown file path is required");
    process.exit(2);
  }

  if (!fs.existsSync(markdownPath)) {
    console.error(`Error: File not found: ${markdownPath}`);
    process.exit(2);
  }

  const result = await convertMarkdown(markdownPath, { title, theme, color, citeStatus });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  });
}
