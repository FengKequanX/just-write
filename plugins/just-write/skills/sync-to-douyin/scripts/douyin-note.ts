import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { loadDouyinConfig } from './douyin-config';

export interface Options {
  dir?: string;
  account?: string;
  caption?: string;
  sau: string;
  title?: string;
  note?: string;
  tags?: string;
  bgm?: string;
  draft: boolean;
  dryRun: boolean;
}

export interface CaptionParts {
  title: string;
  note: string;
  tags: string[];
}

export interface DouyinPayload extends CaptionParts {}

const MAX_TITLE_LENGTH = 20;
const MAX_NOTE_LENGTH = 1000;
const MAX_TAGS = 5;

function printUsage(): never {
  console.log(`Sync a generated carousel folder to Douyin through social-auto-upload.

Usage:
  bun douyin-note.ts <article-dir>/xhs [--account <account-name>] [options]

Options:
  --account <name>  account name (or default_account from EXTEND.md)
  --caption <path>  Douyin caption file (default: ../douyin/douyin-caption.md)
  --sau <path>      custom sau executable path (default: SAU_BIN or sau)
  --title <title>   override title parsed from douyin-caption.md (max 20 characters)
  --note <text>     override note body parsed from douyin-caption.md
  --tags <a,b>      override tags parsed from douyin-caption.md (max 5)
  --bgm <name>      optional Douyin BGM name
  --draft           open a headed, prefilled editor for manual completion
  --dry-run         validate and show the upload command without publishing
  --help            show this help
`);
  process.exit(0);
}

export function parseArgs(args: string[]): Options {
  const options: Options = { sau: findDefaultSau(), draft: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') printUsage();
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--draft') options.draft = true;
    else if (arg === '--account' && args[i + 1]) options.account = args[++i];
    else if (arg === '--caption' && args[i + 1]) options.caption = args[++i];
    else if (arg === '--sau' && args[i + 1]) options.sau = args[++i]!;
    else if (arg === '--title' && args[i + 1]) options.title = args[++i];
    else if (arg === '--note' && args[i + 1]) options.note = args[++i];
    else if (arg === '--tags' && args[i + 1]) options.tags = args[++i];
    else if (arg === '--bgm' && args[i + 1]) options.bgm = args[++i];
    else if (!arg.startsWith('-') && !options.dir) options.dir = arg;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

function findDefaultSau(): string {
  if (process.env.SAU_BIN) return process.env.SAU_BIN;
  const relativeSau = process.platform === 'win32'
    ? path.join('.baoyu-skills', 'social-auto-upload', '.venv', 'Scripts', 'sau.exe')
    : path.join('.baoyu-skills', 'social-auto-upload', '.venv', 'bin', 'sau');
  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, relativeSau);
    if (fs.existsSync(candidate)) return candidate;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return 'sau';
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function readImages(dir: string): string[] {
  return fs.readdirSync(dir)
    .filter((name) => /^\d{2,}-.*\.png$/i.test(name))
    .sort(naturalCompare)
    .map((name) => path.join(dir, name));
}

export function parseCaption(captionPath: string): CaptionParts {
  const raw = fs.readFileSync(captionPath, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim());
  if (firstNonEmptyIndex < 0) throw new Error(`douyin-caption.md is empty: ${captionPath}`);
  const title = lines[firstNonEmptyIndex]!.trim();
  const bodyLines = lines.slice(firstNonEmptyIndex + 1);
  const hashtags = new Set<string>();
  let publishingAdviceIndex = -1;
  for (let i = bodyLines.length - 1; i >= 0; i--) {
    const trimmed = bodyLines[i]!.trim();
    if (!trimmed) continue;
    if (/^[\-—–]\s*\S+/u.test(trimmed)) publishingAdviceIndex = i;
    break;
  }
  for (const match of raw.matchAll(/(^|\s)#([^\s#]+)/gu)) {
    const tag = match[2]?.trim().replace(/[，,。.!！？；;：:]+$/u, '');
    if (tag) hashtags.add(tag);
  }
  const note = bodyLines
    .map((line) => line.trimEnd())
    .filter((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^(#[^\s#]+)(\s+#[^\s#]+)*$/u.test(trimmed)) return false;
      return index !== publishingAdviceIndex;
    })
    .join('\n')
    .trim();
  return { title, note, tags: [...hashtags] };
}

export function splitTags(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[,，]/u).map((tag) => tag.trim().replace(/^#/u, '')).filter(Boolean);
}

export function validateDouyinPayload(payload: DouyinPayload): void {
  if (payload.title.length > MAX_TITLE_LENGTH) {
    throw new Error(`Douyin title exceeds ${MAX_TITLE_LENGTH} characters: ${payload.title.length}`);
  }
  if (payload.note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Douyin note exceeds ${MAX_NOTE_LENGTH} characters: ${payload.note.length}`);
  }
  if (payload.tags.length > MAX_TAGS) {
    throw new Error(`Douyin supports at most ${MAX_TAGS} topics: received ${payload.tags.length}`);
  }
  const invalidTag = payload.tags.find((tag) => /\s/u.test(tag));
  if (invalidTag) throw new Error(`Douyin topic must not contain spaces: ${invalidTag}`);
}

export function createTempNoteFile(note: string): string {
  const file = path.join(os.tmpdir(), `douyin-note-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(file, note, 'utf8');
  return file;
}

export function buildSauArgs(
  options: Options,
  images: string[],
  payload: DouyinPayload,
  noteFile: string,
): string[] {
  const args = [
    'douyin', 'upload-note', '--account', options.account!, '--images', ...images,
    '--title', payload.title, '--notef', noteFile,
  ];
  if (payload.tags.length) args.push('--tags', payload.tags.join(','));
  if (options.bgm) args.push('--bgm', options.bgm);
  if (options.draft) args.push('--draft', '--headed');
  return args;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dir) throw new Error('xhs output directory is required');
  const loadedConfig = loadDouyinConfig();
  options.account ||= loadedConfig.config.default_account;
  if (!options.account) throw new Error('--account is required or set default_account in sync-to-douyin/EXTEND.md');

  const outDir = path.resolve(options.dir);
  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    throw new Error(`Directory not found: ${outDir}`);
  }
  const captionPath = options.caption
    ? path.resolve(options.caption)
    : path.resolve(outDir, '..', 'douyin', 'douyin-caption.md');
  if (!fs.existsSync(captionPath)) {
    throw new Error(`Douyin caption not found: ${captionPath}. Create douyin/douyin-caption.md before uploading.`);
  }
  const images = readImages(outDir);
  if (!images.length) throw new Error(`No numbered PNG images found in ${outDir}`);

  const caption = parseCaption(captionPath);
  const overrideTags = splitTags(options.tags);
  const payload: DouyinPayload = {
    title: options.title || caption.title,
    note: options.note || caption.note || options.title || caption.title,
    tags: [...new Set(overrideTags.length ? overrideTags : caption.tags)],
  };
  validateDouyinPayload(payload);

  const noteFile = createTempNoteFile(payload.note);
  const sauArgs = buildSauArgs(options, images, payload, noteFile);
  const summary = {
    account: options.account,
    imageCount: images.length,
    title: payload.title,
    titleLength: payload.title.length,
    noteLength: payload.note.length,
    tags: payload.tags,
    tagCount: payload.tags.length,
    captionPath,
    configSource: loadedConfig.source,
    mode: options.draft ? 'manual-handoff' : 'publish',
    dryRun: options.dryRun,
  };

  try {
    console.log('[sync-to-douyin] Resolved payload:');
    console.log(JSON.stringify(summary, null, 2));
    if (options.dryRun) {
      console.log('\n[sync-to-douyin] Dry run command (temporary note file is removed after validation):');
      console.log([options.sau, ...sauArgs].map(shellQuote).join(' '));
      return;
    }
    const code = await run(options.sau, sauArgs, process.cwd());
    if (code !== 0) {
      throw new Error(`sau exited with code ${code}. Try: sau douyin check --account ${options.account}`);
    }
  } finally {
    fs.rmSync(noteFile, { force: true });
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(`[sync-to-douyin] Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
