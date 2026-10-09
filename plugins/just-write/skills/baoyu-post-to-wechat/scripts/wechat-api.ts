import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from 'node:crypto';
import { operationResult, platformExitCode, PlatformCliError, type PlatformOperationResult } from '../../../lib/platform-result';
import { loadWechatExtendConfig, resolveAccount, loadCredentials } from "./wechat-extend-config.ts";
import { resolveWechatCoverPath } from "./wechat-cover.ts";
import { ensureTitleAgreement, readWechatMetadata } from './wechat-cli';
import { buildWechatBodyImageTag } from "./wechat-typography.ts";
import {
  type WechatUploadAsset,
  prepareWechatBodyImageUpload,
  needsWechatBodyImageProcessing,
  detectImageFormatFromBuffer,
} from "./wechat-image-processor.ts";

interface AccessTokenResponse {
  access_token?: string;
  errcode?: number;
  errmsg?: string;
}

interface UploadResponse {
  media_id: string;
  url: string;
  errcode?: number;
  errmsg?: string;
}

interface PublishResponse {
  media_id?: string;
  errcode?: number;
  errmsg?: string;
}

interface ImageInfo {
  placeholder: string;
  localPath: string;
  originalPath: string;
}

interface MarkdownRenderResult {
  title: string;
  author: string;
  summary: string;
  htmlPath: string;
  contentImages: ImageInfo[];
}

type ArticleType = "news" | "newspic";

export interface ArticleOptions {
  title: string;
  author?: string;
  digest?: string;
  content: string;
  thumbMediaId: string;
  articleType: ArticleType;
  imageMediaIds?: string[];
  needOpenComment?: number;
  onlyFansCanComment?: number;
}

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const UPLOAD_BODY_IMG_URL = "https://api.weixin.qq.com/cgi-bin/media/uploadimg";
const UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";
const DRAFT_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";

async function fetchAccessToken(appId: string, appSecret: string): Promise<string> {
  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch access token: ${res.status}`);
  }
  const data = await res.json() as AccessTokenResponse;
  if (data.errcode) {
    if (data.errcode === 40164) {
      const ipMatch = data.errmsg?.match(/invalid ip\s+([\d.:]+)/i);
      const ip = ipMatch ? ipMatch[1] : "unknown";
      throw new PlatformCliError(
        `IP白名单错误: 当前IP (${ip}) 不在白名单中。\n` +
        `请在 mp.weixin.qq.com → 设置与开发 → 基本配置 → IP白名单 中添加该IP。`, 1
      );
    }
    throw new PlatformCliError(`获取令牌被拒绝 ${data.errcode}: ${data.errmsg}`, 1);
  }
  if (!data.access_token) {
    throw new Error("No access_token in response");
  }
  return data.access_token;
}

function toHttpsUrl(url: string | undefined): string {
  if (!url) return "";
  return url.startsWith("http://") ? url.replace(/^http:\/\//i, "https://") : url;
}

function htmlToPlainText(html: string): string {
  if (!html) return "";

  let text = html;

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(?:p|div|h[1-6]|li|tr|td|th)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");

  const entityMap: Record<string, string> = {
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&ldquo;": "“",
    "&rdquo;": "”",
    "&lsquo;": "‘",
    "&rsquo;": "’",
  };
  text = text.replace(/&(?:[a-zA-Z]+|#\d+);/g, (entity) => {
    if (entityMap[entity]) return entityMap[entity];
    const numMatch = entity.match(/&#(\d+);/);
    if (numMatch) return String.fromCharCode(Number.parseInt(numMatch[1]!, 10));
    return entity;
  });

  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.split("\n").map(line => line.trim()).join("\n");
  return text.trim();
}

async function loadUploadAsset(
  imagePath: string,
  baseDir?: string,
): Promise<WechatUploadAsset> {
  let fileBuffer: Buffer;
  let filename: string;
  let contentType: string;
  let fileSize = 0;
  let fileExt = "";

  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${imagePath}`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error(`Remote image is empty: ${imagePath}`);
    }
    fileBuffer = Buffer.from(buffer);
    fileSize = buffer.byteLength;
    const urlPath = imagePath.split("?")[0];
    filename = path.basename(urlPath) || "image.jpg";
    fileExt = path.extname(filename).toLowerCase();
    contentType = response.headers.get("content-type") || "image/jpeg";
  } else {
    const resolvedPath = path.isAbsolute(imagePath)
      ? imagePath
      : path.resolve(baseDir || process.cwd(), imagePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Image not found: ${resolvedPath}`);
    }
    const stats = fs.statSync(resolvedPath);
    if (stats.size === 0) {
      throw new Error(`Local image is empty: ${resolvedPath}`);
    }
    fileSize = stats.size;
    fileBuffer = fs.readFileSync(resolvedPath);
    filename = path.basename(resolvedPath);
    fileExt = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".tiff": "image/tiff",
      ".tif": "image/tiff",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };
    contentType = mimeTypes[fileExt] || "image/jpeg";
  }

  // Detect actual format from magic bytes to fix extension/content-type mismatches
  // (e.g. CDNs serving WebP for URLs with .png extension)
  const detected = detectImageFormatFromBuffer(fileBuffer);
  if (detected && detected.contentType !== contentType) {
    console.error(`[wechat-api] Format mismatch: ${filename} declared as ${contentType}, actual ${detected.contentType}`);
    contentType = detected.contentType;
    fileExt = detected.fileExt;
    filename = `${path.basename(filename, path.extname(filename))}${detected.fileExt}`;
  }

  return {
    buffer: fileBuffer,
    filename,
    contentType,
    fileExt,
    fileSize,
  };
}

async function uploadImage(
  imagePath: string,
  accessToken: string,
  baseDir?: string,
  uploadType: "body" | "material" = "body"
): Promise<UploadResponse> {
  const asset = await loadUploadAsset(imagePath, baseDir);
  let uploadAsset = asset;

  if (uploadType === "body" && needsWechatBodyImageProcessing(asset)) {
    const prepared = await prepareWechatBodyImageUpload(asset);
    uploadAsset = {
      ...asset,
      buffer: prepared.buffer,
      filename: prepared.filename,
      contentType: prepared.contentType,
      fileExt: path.extname(prepared.filename).toLowerCase(),
      fileSize: prepared.buffer.length,
    };
    const note = prepared.processingNotes.join(", ");
    console.error(`[wechat-api] Processed ${asset.filename} for body upload: ${note}`);
  }

  const result = await uploadToWechat(
    uploadAsset.buffer,
    uploadAsset.filename,
    uploadAsset.contentType,
    accessToken,
    uploadType,
  );

  // media/uploadimg 接口只返回 URL，material/add_material 返回 media_id
  if (uploadType === "body") {
    return {
      url: toHttpsUrl(result.url),
      media_id: "",
    } as UploadResponse;
  } else {
    result.url = toHttpsUrl(result.url);
    return result;
  }
}

// 实际的微信上传函数
async function uploadToWechat(
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
  accessToken: string,
  uploadType: "body" | "material"
): Promise<UploadResponse> {
  const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="media"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
    "",
  ].join("\r\n");
  const footer = `\r\n--${boundary}--\r\n`;

  const headerBuffer = Buffer.from(header, "utf-8");
  const footerBuffer = Buffer.from(footer, "utf-8");
  const body = Buffer.concat([headerBuffer, fileBuffer, footerBuffer]);

  const uploadUrl = uploadType === "body" ? UPLOAD_BODY_IMG_URL : UPLOAD_MATERIAL_URL;
  const url = `${uploadUrl}?type=image&access_token=${accessToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const data = await res.json() as UploadResponse;
  if (data.errcode && data.errcode !== 0) {
    throw new PlatformCliError(`图片上传被微信拒绝 ${data.errcode}: ${data.errmsg}`, 1);
  }

  return data;
}

export async function uploadImagesInHtml(
  html: string,
  accessToken: string,
  baseDir: string,
  contentImages: ImageInfo[] = [],
  articleType: ArticleType = "news",
  collectNewsCoverFallback: boolean = false,
  dependencies: { upload?: typeof uploadImage } = {},
): Promise<{ html: string; firstCoverMediaId: string; imageMediaIds: string[] }> {
  const upload = dependencies.upload ?? uploadImage;
  const imgRegex = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  const matches = [...html.matchAll(imgRegex)];

  if (matches.length === 0 && contentImages.length === 0) {
    return { html, firstCoverMediaId: "", imageMediaIds: [] };
  }

  let firstCoverMediaId = "";
  let updatedHtml = html;
  const imageMediaIds: string[] = [];
  const uploadedBySource = new Map<string, UploadResponse>();

  for (const match of matches) {
    const [fullTag, src] = match;
    if (!src) continue;

    if (src.startsWith("https://mmbiz.qpic.cn")) {
      if (articleType === 'newspic' || collectNewsCoverFallback && !firstCoverMediaId) {
        const material = await upload(src, accessToken, baseDir, 'material');
        if (typeof material.media_id !== 'string' || !material.media_id.trim()) throw new Error('图片素材上传未返回有效 ID');
        if (articleType === 'newspic') imageMediaIds.push(material.media_id);
        if (collectNewsCoverFallback && !firstCoverMediaId) firstCoverMediaId = material.media_id;
      }
      continue;
    }

    const localPathMatch = fullTag.match(/data-local-path=["']([^"']+)["']/);
    const imagePath = localPathMatch ? localPathMatch[1]! : src;

    console.error(`[wechat-api] Uploading body image: ${imagePath}`);
    try {
      let resp = uploadedBySource.get(imagePath);
      if (!resp) {
        // 正文图片使用 media/uploadimg 接口获取 URL
        resp = await upload(imagePath, accessToken, baseDir, "body");
        uploadedBySource.set(imagePath, resp);
      }
      if (typeof resp.url !== 'string' || !resp.url.trim()) throw new Error('正文图片上传未返回有效 URL');
      const newTag = fullTag
        .replace(/\ssrc=["'][^"']+["']/, ` src="${resp.url}"`)
        .replace(/\sdata-local-path=["'][^"']+["']/, "");
      updatedHtml = updatedHtml.replace(fullTag, newTag);
      const shouldUploadMaterial = articleType === "newspic" || (collectNewsCoverFallback && !firstCoverMediaId);
      if (shouldUploadMaterial) {
        let materialResp = uploadedBySource.get(`${imagePath}:material`);
        if (!materialResp) {
          materialResp = await upload(imagePath, accessToken, baseDir, "material");
          uploadedBySource.set(`${imagePath}:material`, materialResp);
        }
        if (typeof materialResp.media_id !== 'string' || !materialResp.media_id.trim()) throw new Error('图片素材上传未返回有效 ID');
        if (articleType === "newspic" && materialResp.media_id) {
          imageMediaIds.push(materialResp.media_id);
        }
        if (collectNewsCoverFallback && !firstCoverMediaId && materialResp.media_id) {
          firstCoverMediaId = materialResp.media_id;
        }
      }
    } catch (err) {
      console.error('[wechat-api] 正文图片上传未完成，停止创建草稿');
      throw err;
    }
  }

  for (const image of contentImages) {
    if (!updatedHtml.includes(image.placeholder)) continue;

    const imagePath = image.localPath || image.originalPath;
    console.error(`[wechat-api] Uploading body image: ${imagePath}`);

    try {
      let resp = uploadedBySource.get(imagePath);
      if (!resp) {
        // 正文图片使用 media/uploadimg 接口获取 URL
        resp = await upload(imagePath, accessToken, baseDir, "body");
        uploadedBySource.set(imagePath, resp);
      }
      if (typeof resp.url !== 'string' || !resp.url.trim()) throw new Error('正文图片上传未返回有效 URL');

      const replacementTag = buildWechatBodyImageTag(resp.url);
      updatedHtml = replaceAllPlaceholders(updatedHtml, image.placeholder, replacementTag);
      const shouldUploadMaterial = articleType === "newspic" || (collectNewsCoverFallback && !firstCoverMediaId);
      if (shouldUploadMaterial) {
        let materialResp = uploadedBySource.get(`${imagePath}:material`);
        if (!materialResp) {
          materialResp = await upload(imagePath, accessToken, baseDir, "material");
          uploadedBySource.set(`${imagePath}:material`, materialResp);
        }
        if (typeof materialResp.media_id !== 'string' || !materialResp.media_id.trim()) throw new Error('图片素材上传未返回有效 ID');
        if (articleType === "newspic" && materialResp.media_id) {
          imageMediaIds.push(materialResp.media_id);
        }
        if (collectNewsCoverFallback && !firstCoverMediaId && materialResp.media_id) {
          firstCoverMediaId = materialResp.media_id;
        }
      }
    } catch (err) {
      console.error('[wechat-api] 正文占位图片上传未完成，停止创建草稿');
      throw err;
    }
  }

  return { html: updatedHtml, firstCoverMediaId, imageMediaIds };
}

export function buildDraftArticle(options: ArticleOptions): Record<string, unknown> {
  let article: Record<string, unknown>;

  const noc = options.needOpenComment ?? 1;
  const ofcc = options.onlyFansCanComment ?? 0;

  if (options.articleType === "newspic") {
    if (!options.imageMediaIds || options.imageMediaIds.length === 0) {
      throw new Error("newspic requires at least one image");
    }
    const plainContent = htmlToPlainText(options.content);
    article = {
      article_type: "newspic",
      title: options.title,
      content: plainContent,
      need_open_comment: noc,
      only_fans_can_comment: ofcc,
      image_info: {
        image_list: options.imageMediaIds.map(id => ({ image_media_id: id })),
      },
    };
    if (options.author) article.author = options.author;
  } else {
    article = {
      article_type: "news",
      title: options.title,
      content: options.content,
      thumb_media_id: options.thumbMediaId,
      need_open_comment: noc,
      only_fans_can_comment: ofcc,
    };
    if (options.author) article.author = options.author;
    if (options.digest) article.digest = options.digest;
  }

  return article;
}

function bodyImageIdentities(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => {
    const value = match[1]!.replace(/&amp;/g, '&');
    try {
      const url = new URL(value);
      // 微信 CDN 的排印参数不改变图片身份；其他查询参数可能是图片 ID，不能一概删除。
      if (url.hostname === 'mmbiz.qpic.cn') for (const key of ['wx_fmt', 'from', 'wxfrom', 'wx_lazy', 'tp']) url.searchParams.delete(key);
      url.searchParams.sort();
      return `${url.host}${url.pathname}${url.search}`;
    } catch { return value; }
  });
}

export function compareDraftArticle(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  const text = (value: unknown) => htmlToPlainText(String(value ?? '')).replace(/\s+/g, ' ').trim();
  if (actual.title !== expected.title || text(actual.content) !== text(expected.content)) return false;
  if (expected.digest && actual.digest !== expected.digest) return false;
  if (expected.author && actual.author !== expected.author) return false;
  if (actual.article_type && actual.article_type !== expected.article_type) return false;
  if (expected.thumb_media_id && actual.thumb_media_id !== expected.thumb_media_id) return false;
  if (expected.image_info) {
    const ids = (value: unknown) => ((value as { image_list?: { image_media_id?: string }[] } | undefined)?.image_list ?? []).map(image => image.image_media_id);
    if (JSON.stringify(ids(actual.image_info)) !== JSON.stringify(ids(expected.image_info))) return false;
  }
  return JSON.stringify(bodyImageIdentities(String(actual.content ?? ''))) === JSON.stringify(bodyImageIdentities(String(expected.content ?? '')));
}

/** draft/add 至多调用一次；拿到 ID 后，即使读回失败也保留已保存事实。 */
export async function saveDraftWithVerification(
  options: ArticleOptions, accessToken: string,
  dependencies: { request?: typeof fetch; account?: string } = {},
): Promise<PlatformOperationResult> {
  const request = dependencies.request ?? fetch;
  const article = buildDraftArticle(options);
  const details = { account: dependencies.account, inputDigest: createHash('sha256').update(JSON.stringify(article)).digest('hex'),
    inputSummary: { title: options.title, articleType: options.articleType, contentLength: options.content.length } };
  let data: PublishResponse;
  try {
    const response = await request(`${DRAFT_URL}?access_token=${accessToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articles: [article] }) });
    if (!response.ok) return operationResult('wechat', 'save_draft', 'outcome_unknown', { ...details, verification: 'unverified', message: `草稿提交 HTTP ${response.status}，请先核对草稿箱` });
    data = await response.json() as PublishResponse;
  } catch {
    return operationResult('wechat', 'save_draft', 'outcome_unknown', { ...details, verification: 'unverified', message: '草稿提交连接或响应异常，请先核对草稿箱，勿重复创建' });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return operationResult('wechat', 'save_draft', 'outcome_unknown', { ...details, verification: 'unverified', message: '草稿响应格式无法确认，请先核对草稿箱' });
  if (data.errcode) return operationResult('wechat', 'save_draft', 'failed', { ...details, message: `微信拒绝草稿：${data.errcode} ${data.errmsg ?? ''}` });
  if (typeof data.media_id !== 'string' || !data.media_id.trim()) return operationResult('wechat', 'save_draft', 'outcome_unknown', { ...details, verification: 'unverified', message: '未收到有效草稿 ID，请先核对草稿箱' });
  const saved = operationResult('wechat', 'save_draft', 'draft_saved', { ...details, receipt: { kind: 'api', id: data.media_id }, verification: 'unverified' });
  try {
    const response = await request(`https://api.weixin.qq.com/cgi-bin/draft/get?access_token=${accessToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_id: data.media_id }),
    });
    if (!response.ok) return { ...saved, message: `草稿已保存；读回 HTTP ${response.status}，请核对已有 ID` };
    const readback = await response.json() as { errcode?: number; news_item?: Record<string, unknown>[] };
    if (readback.errcode || !readback.news_item?.[0]) return { ...saved, message: '草稿已保存；读回无有效文章，请核对已有 ID' };
    return { ...saved, verification: compareDraftArticle(article, readback.news_item[0]) ? 'verified' : 'mismatch',
      message: compareDraftArticle(article, readback.news_item[0]) ? '草稿已保存，标题、正文及图片身份读回一致' : '草稿已保存，但读回内容不一致；请核对已有 ID' };
  } catch { return { ...saved, message: '草稿已保存；读回失败，请核对已有 ID，勿重复创建' }; }
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  const lines = match[1]!.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2]! };
}

function renderMarkdownWithPlaceholders(
  markdownPath: string,
  theme: string = "default",
  color?: string,
  citeStatus: boolean = true,
  title?: string,
): MarkdownRenderResult {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const mdToWechatScript = path.join(__dirname, "md-to-wechat.ts");
  const baseDir = path.dirname(markdownPath);

  const args = [mdToWechatScript, markdownPath];
  if (title) args.push("--title", title);
  if (theme) args.push("--theme", theme);
  if (color) args.push("--color", color);
  if (!citeStatus) args.push("--no-cite");

  console.error(`[wechat-api] Rendering markdown with placeholders via md-to-wechat: ${theme}${color ? `, color: ${color}` : ""}, citeStatus: ${citeStatus}`);
  const runtime = process.versions.bun ? process.execPath : 'bun';
  const result = spawnSync(runtime, args, {
    stdio: ["inherit", "pipe", "pipe"],
    cwd: baseDir,
  });

  if (result.error) {
    throw new Error(
      `Markdown 渲染失败：无法运行已安装的 Bun。\n` +
      `Details: ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "";
    if (stderr.includes("ENOENT") || stderr.includes("not found") || stderr.includes("command not found")) {
      throw new Error(
        `Markdown render failed: bun 不可用。请安装 bun: npm install -g bun\n` +
        `Details: ${stderr}`
      );
    }
    throw new Error(`Markdown placeholder render failed: ${stderr}`);
  }

  const stdout = result.stdout?.toString() || "";
  return JSON.parse(stdout) as MarkdownRenderResult;
}

function replaceAllPlaceholders(html: string, placeholder: string, replacement: string): string {
  const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(escapedPlaceholder + "(?!\\d)", "g"), replacement);
}

function extractHtmlContent(htmlPath: string): string {
  const html = fs.readFileSync(htmlPath, "utf-8");
  const match = html.match(/<div id="output">([\s\S]*?)<\/div>\s*<\/body>/);
  if (match) {
    return match[1]!.trim();
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1]!.trim() : html;
}

function printUsage(): never {
  console.log(`微信草稿 API 专用入口（兼容默认保存草稿）。
用法：bun wechat-api.ts <markdown.md|article.html> [选项]
  --type <news|newspic>  文章类型，默认 news
  --title <text>        平台标题，最多 64 字符
  --author <name>       作者，最多 16 字符
  --summary <text>      摘要，最多 120 字符，超限报错
  --theme <name>        主题；CLI > frontmatter > 账号/全局配置 > default
  --color <name|hex>    主色；使用相同配置优先级
  --cover <path|url>    微信独立封面
  --account <alias>     明确选择目标账号
  --no-cite             关闭普通外链的文末引用
  --save-draft          显式声明保存草稿
  --dry-run             离线解析与预览，不读取凭证
  --json                JSON 输出（保留旧字段并追加 result）
  --help                帮助
--save-draft 与 --dry-run 互斥。
保存后读回核对；读回异常保留草稿 ID，不能重复创建来核验。
退出码：0 成功；1 平台拒绝；2 参数/运行错误；3 保存结果或验证待核验。`);
  process.exit(0);
}
export interface CliArgs {
  filePath: string;
  isHtml: boolean;
  articleType: ArticleType;
  title?: string;
  author?: string;
  summary?: string;
  theme?: string;
  color?: string;
  cover?: string;
  account?: string;
  citeStatus: boolean;
  dryRun: boolean;
  saveDraft: boolean;
  json: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printUsage();
  }

  const args: CliArgs = {
    filePath: "",
    isHtml: false,
    articleType: "news",
    citeStatus: true,
    dryRun: false,
    saveDraft: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (['--type', '--title', '--author', '--summary', '--theme', '--color', '--cover', '--account'].includes(arg) &&
      (argv[i + 1] === undefined || argv[i + 1]!.startsWith('--'))) throw new Error(`参数缺少值：${arg}`);
    if (arg === "--type" && argv[i + 1]) {
      const t = argv[++i]!.toLowerCase();
      if (t === "news" || t === "newspic") {
        args.articleType = t;
      } else throw new Error(`无效文章类型：${t}`);
    } else if (arg === "--title" && argv[i + 1]) {
      args.title = argv[++i];
    } else if (arg === "--author" && argv[i + 1]) {
      args.author = argv[++i];
    } else if (arg === "--summary" && argv[i + 1]) {
      args.summary = argv[++i];
    } else if (arg === "--theme" && argv[i + 1]) {
      args.theme = argv[++i]!;
    } else if (arg === "--color" && argv[i + 1]) {
      args.color = argv[++i];
    } else if (arg === "--cover" && argv[i + 1]) {
      args.cover = argv[++i];
    } else if (arg === "--account" && argv[i + 1]) {
      args.account = argv[++i];
    } else if (arg === "--cite") {
      args.citeStatus = true;
    } else if (arg === "--no-cite") {
      args.citeStatus = false;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === '--save-draft') args.saveDraft = true;
    else if (arg === '--json') args.json = true;
    else if (!arg.startsWith("-") && !args.filePath) {
      args.filePath = arg;
    } else throw new Error(`未知参数或参数缺少值：${arg}`);
  }

  if (!args.filePath) {
    throw new Error('需要正文文件路径');
  }
  if (args.dryRun && args.saveDraft) throw new Error('--dry-run 与 --save-draft 互斥');

  args.isHtml = args.filePath.toLowerCase().endsWith(".html");

  return args;
}

function extractHtmlTitle(html: string): string {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1]!;
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1]!.replace(/<[^>]+>/g, "").trim();
  return "";
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const extConfig = loadWechatExtendConfig();
  const resolved = resolveAccount(extConfig, args.account, { offline: args.dryRun });

  const filePath = path.resolve(args.filePath);
  ensureTitleAgreement(readWechatMetadata(args.isHtml ? filePath.replace(/\.html$/i, '.md') : filePath), args.title);
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在：${filePath}`);
  }

  const baseDir = path.dirname(filePath);
  let title = args.title || "";
  let author = args.author || "";
  let digest = args.summary || "";
  let htmlPath: string;
  let htmlContent: string;
  let frontmatter: Record<string, string> = {};
  let contentImages: ImageInfo[] = [];

  if (args.isHtml) {
    htmlPath = filePath;
    htmlContent = extractHtmlContent(htmlPath);
    const mdPath = filePath.replace(/\.html$/i, ".md");
    if (fs.existsSync(mdPath)) {
      const mdContent = fs.readFileSync(mdPath, "utf-8");
      const parsed = parseFrontmatter(mdContent);
      frontmatter = parsed.frontmatter;
      if (!title && frontmatter.title) title = frontmatter.title;
      if (!author) author = frontmatter.author || "";
      if (!digest) digest = frontmatter.digest || frontmatter.summary || frontmatter.description || "";
    }
    if (!title) {
      title = extractHtmlTitle(fs.readFileSync(htmlPath, "utf-8"));
    }
    console.error(`[wechat-api] Using HTML file: ${htmlPath}`);
  } else {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(content);
    frontmatter = parsed.frontmatter;
    const body = parsed.body;

    args.theme = args.theme ?? frontmatter.theme ?? resolved.default_theme ?? 'default';
    args.color = args.color ?? frontmatter.color ?? resolved.default_color;

    title = title || frontmatter.title || "";
    if (!title) {
      const h1Match = body.match(/^#\s+(.+)$/m);
      if (h1Match) title = h1Match[1]!;
    }
    if (!author) author = frontmatter.author || "";
    if (!digest) digest = frontmatter.digest || frontmatter.summary || frontmatter.description || "";

    console.error(`[wechat-api] Theme: ${args.theme}${args.color ? `, color: ${args.color}` : ""}, citeStatus: ${args.citeStatus}`);
    const rendered = renderMarkdownWithPlaceholders(filePath, args.theme, args.color, args.citeStatus, args.title);
    htmlPath = rendered.htmlPath;
    contentImages = rendered.contentImages;
    if (!title) title = rendered.title;
    if (!author) author = rendered.author;
    if (!digest) digest = rendered.summary;
    console.error(`[wechat-api] HTML generated: ${htmlPath}`);
    console.error(`[wechat-api] Placeholder images: ${contentImages.length}`);
    htmlContent = extractHtmlContent(htmlPath);
  }

  if (!title) {
    throw new Error('没有标题，请通过 --title、frontmatter 或 H1 提供');
  }
  if (title.length > 64) throw new Error(`标题超出 64 字符：${title.length}`);

  if (digest && digest.length > 120) {
    throw new Error(`摘要超出 120 字符：${digest.length}；请调整摘要，不自动截断`);
  }

  console.error(`[wechat-api] Title: ${title}`);
  if (author) console.error(`[wechat-api] Author: ${author}`);
  if (digest) console.error(`[wechat-api] Digest: ${digest.slice(0, 50)}...`);
  console.error(`[wechat-api] Type: ${args.articleType}`);

  if (resolved.name) console.error(`[wechat-api] Account: ${resolved.name} (${resolved.alias})`);

  if (!author && resolved.default_author) author = resolved.default_author;
  if (author.length > 16) throw new Error(`作者名超出 16 字符：${author.length}`);
  for (const key of ['need_open_comment', 'only_fans_can_comment']) {
    if (frontmatter[key] !== undefined && !/^[01]$/.test(frontmatter[key]!)) throw new Error(`${key} 必须为 0 或 1`);
  }

  const rawCoverPath = args.cover ||
    frontmatter.coverImage ||
    frontmatter.featureImage ||
    frontmatter.cover ||
    frontmatter.image;
  const explicitCoverPath = rawCoverPath && !path.isAbsolute(rawCoverPath) && args.cover
    ? path.resolve(process.cwd(), rawCoverPath)
    : rawCoverPath;
  const coverPath = resolveWechatCoverPath(explicitCoverPath, baseDir);

  if (args.dryRun) {
    console.log(JSON.stringify({
      articleType: args.articleType,
      title,
      author: author || undefined,
      digest: digest || undefined,
      htmlPath,
      contentLength: htmlContent.length,
      placeholderImageCount: contentImages.length || undefined,
      coverPath,
      account: resolved.alias || undefined,
      accountSource: resolved.source,
      result: operationResult('wechat', 'validate', 'dry_run', { account: resolved.alias ?? resolved.source }),
    }, null, 2));
    return 0;
  }

  const creds = loadCredentials(resolved);
  for (const skippedSource of creds.skippedSources) {
    console.error(`[wechat-api] Skipped incomplete credential source: ${skippedSource}`);
  }
  console.error(`[wechat-api] Credentials source: ${creds.source}`);
  console.error("[wechat-api] Fetching access token...");
  const accessToken = await fetchAccessToken(creds.appId, creds.appSecret);

  const needNewsCoverFallback = args.articleType === "news" && !coverPath;

  console.error("[wechat-api] Uploading body images...");
  const { html: processedHtml, firstCoverMediaId, imageMediaIds } = await uploadImagesInHtml(
    htmlContent,
    accessToken,
    baseDir,
    contentImages,
    args.articleType,
    needNewsCoverFallback,
  );
  htmlContent = processedHtml;

  let thumbMediaId = "";

  if (coverPath) {
    console.error(`[wechat-api] Uploading cover: ${coverPath}`);
    // 封面图片使用 material/add_material 接口
    const coverResp = await uploadImage(coverPath, accessToken, baseDir, "material");
    thumbMediaId = coverResp.media_id;
    console.error(`[wechat-api] Cover uploaded successfully, media_id: ${thumbMediaId}`);
  } else if (firstCoverMediaId && args.articleType === "news") {
    // news 类型没有封面时，使用第一张正文图的 media_id 作为封面（兜底逻辑）
    thumbMediaId = firstCoverMediaId;
    console.error(`[wechat-api] Using first body image as cover (fallback), media_id: ${thumbMediaId}`);
  }

  if (args.articleType === "news" && !thumbMediaId) {
    throw new Error('需要封面：请通过 --cover、frontmatter 或正文图片提供');
  }

  if (args.articleType === "newspic" && imageMediaIds.length === 0) {
    throw new Error('newspic 需要至少一张正文图片');
  }

  console.error("[wechat-api] Publishing to draft...");
  const result = await saveDraftWithVerification({
    title,
    author: author || undefined,
    digest: digest || undefined,
    content: htmlContent,
    thumbMediaId,
    articleType: args.articleType,
    imageMediaIds: args.articleType === "newspic" ? imageMediaIds : undefined,
    needOpenComment: frontmatter.need_open_comment !== undefined ? Number(frontmatter.need_open_comment) : resolved.need_open_comment,
    onlyFansCanComment: frontmatter.only_fans_can_comment !== undefined ? Number(frontmatter.only_fans_can_comment) : resolved.only_fans_can_comment,
  }, accessToken, { account: resolved.alias ?? resolved.source });

  console.log(JSON.stringify({
    success: result.status === 'draft_saved',
    media_id: result.receipt?.id,
    title,
    articleType: args.articleType,
    result,
  }, null, 2));

  console.error(`[wechat-api] ${result.message ?? result.status}`);
  return platformExitCode(result);
}

if (import.meta.main) await main().then(code => { process.exitCode = code; }).catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = err instanceof PlatformCliError ? err.exitCode : 2;
});
