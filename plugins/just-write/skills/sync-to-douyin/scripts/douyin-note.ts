import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { loadDouyinConfig } from './douyin-config';
import { operationResult, platformExitCode, type PlatformOperationResult } from '../../../lib/platform-result';

export interface Options {
  dir?: string; account?: string; caption?: string; sau: string; title?: string;
  note?: string; tags?: string; bgm?: string; draft: boolean; dryRun: boolean; publish: boolean; json: boolean;
}
export interface CaptionParts { title: string; note: string; tags: string[]; publishingAdvice?: string; warnings?: string[] }
export interface DouyinPayload { title: string; note: string; tags: string[] }
const MAX_TITLE_LENGTH = 20;
const MAX_NOTE_LENGTH = 1000;
const MAX_TAGS = 5;

function printUsage(): void {
  console.log(`将本地轮播素材校验、交接或上传到抖音。
用法：bun douyin-note.ts <article-dir>/xhs [选项]
默认只校验，不启动上传器，也不要求账号。
  --account <name>  目标账号（或 EXTEND.md 的 default_account）
  --caption <path>  独立文案，默认 ../douyin/douyin-caption.md
  --sau <path>      上传器程序（默认 SAU_BIN 或 sau）
  --title <title>   标题，最多 20 字符
  --note <text>     正文，最多 1000 字符
  --tags <a,b>      话题，最多 5 个
  --bgm <name>      音乐名称
  --draft          打开预填编辑器，交由用户完成
  --publish        明确调用上传器；仍需已有用户授权
  --dry-run        校验模式的兼容别名
  --json           以 JSON 输出结果，日志写入 stderr
  --help           帮助
--draft、--publish、--dry-run 互斥。`);
}

export function parseArgs(args: string[]): Options {
  const options: Options = { sau: findDefaultSau(), draft: false, dryRun: true, publish: false, json: false };
  const modes = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (['--dry-run', '--draft', '--publish'].includes(arg)) {
      modes.add(arg);
      options.draft = arg === '--draft'; options.publish = arg === '--publish'; options.dryRun = arg === '--dry-run';
    } else if (arg === '--json') options.json = true;
    else if (['--account', '--caption', '--sau', '--title', '--note', '--tags', '--bgm'].includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`参数缺少值：${arg}`);
      (options as unknown as Record<string, string>)[arg.slice(2)] = value;
    } else if (!arg.startsWith('-') && !options.dir) options.dir = arg;
    else throw new Error(`未知参数：${arg}`);
  }
  if (modes.size > 1) throw new Error('--draft、--publish、--dry-run 互斥');
  return options;
}

function findDefaultSau(): string {
  if (process.env.SAU_BIN) return process.env.SAU_BIN;
  const relative = process.platform === 'win32'
    ? path.join('.baoyu-skills', 'social-auto-upload', '.venv', 'Scripts', 'sau.exe')
    : path.join('.baoyu-skills', 'social-auto-upload', '.venv', 'bin', 'sau');
  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, relative);
    if (fs.existsSync(candidate)) return candidate;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return 'sau';
}

export function readImages(dir: string): string[] {
  return fs.readdirSync(dir).filter(name => /^\d{2,}-.*\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map(name => path.join(dir, name));
}

export function parseCaption(captionPath: string): CaptionParts {
  let raw = fs.readFileSync(captionPath, 'utf8').replace(/\r\n/g, '\n');
  let publishingAdvice: string | undefined;
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (frontmatter) {
    const metadata = parseYaml(frontmatter[1]!) as unknown;
    if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) throw new Error('抖音 frontmatter 必须是映射');
    const advice = (metadata as Record<string, unknown> | null)?.publishingAdvice;
    if (advice !== undefined && typeof advice !== 'string') throw new Error('publishingAdvice 必须是字符串');
    publishingAdvice = advice as string | undefined;
    raw = raw.slice(frontmatter[0].length);
  }
  const lines = raw.split('\n');
  const first = lines.findIndex(line => line.trim());
  if (first < 0) throw new Error(`抖音文案为空：${captionPath}`);
  const title = lines[first]!.trim();
  const body = lines.slice(first + 1);
  const tags = new Set<string>();
  const warnings: string[] = [];
  const last = body.findLastIndex(line => line.trim());
  if (last >= 0 && /^(?:[—–-]\s*)?发布建议\s*[：:]/u.test(body[last]!.trim())) {
    publishingAdvice ??= body[last]!.trim().replace(/^(?:[—–-]\s*)?发布建议\s*[：:]\s*/u, '');
    body.splice(last, 1);
    warnings.push('旧发布建议末行已分离；请迁移至 frontmatter.publishingAdvice');
  }
  const note = body.filter(line => {
    const trimmed = line.trim();
    if (!/^(#[^\s#]+)(\s+#[^\s#]+)*$/u.test(trimmed)) return true;
    for (const value of trimmed.split(/\s+/)) tags.add(value.slice(1));
    return false;
  }).map(line => line.trimEnd()).join('\n').trim();
  return { title, note, tags: [...tags], ...(publishingAdvice !== undefined ? { publishingAdvice } : {}), ...(warnings.length ? { warnings } : {}) };
}

export function splitTags(value: string | undefined): string[] {
  return value ? value.split(/[,，]/u).map(tag => tag.trim().replace(/^#/u, '')).filter(Boolean) : [];
}
export function validateDouyinPayload(payload: DouyinPayload): void {
  if (!payload.title.trim()) throw new Error('抖音标题不能为空');
  if (payload.title.length > MAX_TITLE_LENGTH) throw new Error(`抖音标题超出 ${MAX_TITLE_LENGTH} 字符：${payload.title.length}`);
  if (payload.note.length > MAX_NOTE_LENGTH) throw new Error(`抖音正文超出 ${MAX_NOTE_LENGTH} 字符：${payload.note.length}`);
  if (payload.tags.length > MAX_TAGS) throw new Error(`抖音话题最多 ${MAX_TAGS} 个：收到 ${payload.tags.length} 个`);
  const invalid = payload.tags.find(tag => /\s/u.test(tag));
  if (invalid) throw new Error(`抖音话题不能包含空格：${invalid}`);
}
export function createTempNoteFile(note: string): string {
  const file = path.join(os.tmpdir(), `douyin-note-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(file, note, 'utf8'); return file;
}
export function buildSauArgs(options: Options, images: string[], payload: DouyinPayload, noteFile: string): string[] {
  const args = ['douyin', 'upload-note', '--account', options.account!, '--images', ...images, '--title', payload.title, '--notef', noteFile];
  if (payload.tags.length) args.push('--tags', payload.tags.join(','));
  if (options.bgm) args.push('--bgm', options.bgm);
  if (options.draft) args.push('--draft', '--headed');
  return args;
}
export interface UploadRunResult { code: number; receipt?: { id?: string; url?: string; message?: string } }
export interface DouyinDependencies {
  loadConfig?: typeof loadDouyinConfig;
  run?: (command: string, args: string[], cwd: string) => Promise<UploadRunResult>;
}
function run(command: string, args: string[], cwd: string): Promise<UploadRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'inherit', 'inherit'], shell: false });
    child.on('error', reject); child.on('close', code => resolve({ code: code ?? 1 }));
  });
}

export async function executeDouyin(options: Options, dependencies: DouyinDependencies = {}): Promise<PlatformOperationResult> {
  if (!options.dir) throw new Error('需要 xhs 素材目录');
  const loaded = (dependencies.loadConfig ?? loadDouyinConfig)();
  options = { ...options, account: options.account ?? (loaded.config.default_account || undefined) };
  if (!options.dryRun && !options.account) throw new Error('交接或上传需要 --account 或 default_account');
  const outDir = path.resolve(options.dir!);
  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) throw new Error(`目录不存在：${outDir}`);
  const captionPath = options.caption ? path.resolve(options.caption) : path.resolve(outDir, '..', 'douyin', 'douyin-caption.md');
  const caption = parseCaption(captionPath);
  for (const warning of caption.warnings ?? []) console.error(`[sync-to-douyin] ${warning}`);
  const images = readImages(outDir);
  if (!images.length) throw new Error(`没有编号 PNG：${outDir}`);
  const payload: DouyinPayload = { title: options.title ?? caption.title, note: options.note ?? caption.note,
    tags: [...new Set(options.tags !== undefined ? splitTags(options.tags) : caption.tags)] };
  validateDouyinPayload(payload);
  const digest = createHash('sha256').update(JSON.stringify(payload));
  for (const image of images) digest.update(path.basename(image)).update(fs.readFileSync(image));
  const details = { account: options.account, inputDigest: digest.digest('hex'), inputSummary: {
    imageCount: images.length, title: payload.title, titleLength: payload.title.length, noteLength: payload.note.length,
    tags: payload.tags, captionPath, configSource: loaded.source,
  } };
  if (options.dryRun) return operationResult('douyin', 'validate', 'dry_run', details);
  const noteFile = createTempNoteFile(payload.note);
  try {
    let response: UploadRunResult;
    try {
      response = await (dependencies.run ?? run)(options.sau, buildSauArgs(options, images, payload, noteFile), process.cwd());
    } catch (error) {
      // 启动失败可以确定未执行；运行中的异常不能证明平台未收到提交。
      if (['ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException)?.code || '')) throw error;
      return operationResult('douyin', options.draft ? 'prefill' : 'publish', 'outcome_unknown', {
        ...details, verification: 'unverified', message: '上传器调用中断，无法判断提交结果；先核对平台，勿重复提交',
      });
    }
    if (response.code !== 0) return operationResult('douyin', options.draft ? 'prefill' : 'publish', 'outcome_unknown', {
      ...details, verification: 'unverified', message: `上传器退出 ${response.code}；先核对平台结果，不要直接重复提交`,
    });
    if (options.draft) return operationResult('douyin', 'prefill', 'manual_handoff', details);
    if (response.receipt?.id || response.receipt?.url) return operationResult('douyin', 'publish', 'published', {
      ...details, verification: 'verified', receipt: { kind: 'uploader', ...response.receipt },
    });
    return operationResult('douyin', 'publish', 'outcome_unknown', { ...details, verification: 'unverified',
      message: '上传器执行结束，但没有公开发布回执；先核对平台结果' });
  } finally { fs.rmSync(noteFile, { force: true }); }
}

export async function runCli(args: string[], dependencies: DouyinDependencies = {}): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { printUsage(); return 0; }
  try {
    const options = parseArgs(args);
    // JSON 模式下，子进程日志也写入 stderr。
    if (options.json && !dependencies.run) dependencies = { ...dependencies, run: (command, argv, cwd) => new Promise((resolve, reject) => {
      const child = spawn(command, argv, { cwd, stdio: ['inherit', process.stderr, process.stderr], shell: false });
      child.on('error', reject); child.on('close', code => resolve({ code: code ?? 1 }));
    }) };
    const result = await executeDouyin(options, dependencies);
    console.log(JSON.stringify(result, null, 2)); return platformExitCode(result);
  } catch (error) { console.error(`[sync-to-douyin] ${error instanceof Error ? error.message : String(error)}`); return 2; }
}
if (import.meta.main) process.exitCode = await runCli(process.argv.slice(2));
