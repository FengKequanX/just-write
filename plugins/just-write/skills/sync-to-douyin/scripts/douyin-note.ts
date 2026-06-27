import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

interface Options {
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

interface CaptionParts {
  title: string;
  note: string;
  tags: string[];
}

const MAX_TITLE_LENGTH = 20;
const MAX_NOTE_LENGTH = 1000;
const MAX_TAGS = 5;

function printUsage(): never {
  console.log(`Sync a generated carousel folder to Douyin through social-auto-upload.

Usage:
  bun douyin-note.ts <xhs-output-dir> --account <account-name> [options]

Options:
  --account <name>  social-auto-upload account name
  --caption <path>  Douyin caption file (default: ../douyin/douyin-caption.md)
  --sau <path>      custom sau executable path (default: SAU_BIN or sau)
  --title <title>   override title parsed from douyin-caption.md (max 20 characters)
  --note <text>     override note body parsed from douyin-caption.md
  --tags <a,b>      override tags parsed from douyin-caption.md (max 5)
  --bgm <name>      optional Douyin BGM name
  --draft           open a prefilled Douyin editor and keep it open for manual completion
  --dry-run         show the upload command without publishing
  --help            show this help
`);
  process.exit(0);
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    sau: findDefaultSau(),
    draft: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') printUsage();
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--draft') {
      options.draft = true;
    } else if (arg === '--account' && args[i + 1]) {
      options.account = args[++i];
    } else if (arg === '--caption' && args[i + 1]) {
      options.caption = args[++i];
    } else if (arg === '--sau' && args[i + 1]) {
      options.sau = args[++i]!;
    } else if (arg === '--title' && args[i + 1]) {
      options.title = args[++i];
    } else if (arg === '--note' && args[i + 1]) {
      options.note = args[++i];
    } else if (arg === '--tags' && args[i + 1]) {
      options.tags = args[++i];
    } else if (arg === '--bgm' && args[i + 1]) {
      options.bgm = args[++i];
    } else if (!arg.startsWith('-') && !options.dir) {
      options.dir = arg;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
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

function readImages(dir: string): string[] {
  return fs.readdirSync(dir)
    .filter((name) => /\.png$/i.test(name))
    .sort(naturalCompare)
    .map((name) => path.join(dir, name));
}

function parseCaption(captionPath: string): CaptionParts {
  const raw = fs.readFileSync(captionPath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIndex < 0) {
    throw new Error(`caption.md is empty: ${captionPath}`);
  }

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
      if (index === publishingAdviceIndex) return false;
      return true;
    })
    .join('\n')
    .trim();

  return { title, note, tags: [...hashtags] };
}

function splitTags(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[,，]/u).map((tag) => tag.trim().replace(/^#/u, '')).filter(Boolean);
}

function createTempNoteFile(note: string): string {
  const file = path.join(os.tmpdir(), `douyin-note-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(file, note, 'utf-8');
  return file;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dir) throw new Error('xhs output directory is required');
  if (!options.account) throw new Error('--account is required');

  const outDir = path.resolve(options.dir);
  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    throw new Error(`Directory not found: ${outDir}`);
  }

  const captionPath = options.caption
    ? path.resolve(options.caption)
    : path.resolve(outDir, '..', 'douyin', 'douyin-caption.md');
  if (!fs.existsSync(captionPath)) {
    throw new Error(
      `Douyin caption not found: ${captionPath}. Create douyin/douyin-caption.md before uploading.`,
    );
  }

  const images = readImages(outDir);
  if (images.length === 0) {
    throw new Error(`No PNG images found in ${outDir}`);
  }

  const caption = parseCaption(captionPath);
  const title = options.title || caption.title;
  const note = options.note || caption.note || title;
  const tags = splitTags(options.tags);
  const resolvedTags = [...new Set(tags.length > 0 ? tags : caption.tags)];

  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`Douyin title exceeds ${MAX_TITLE_LENGTH} characters: ${title.length}`);
  }
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Douyin note exceeds ${MAX_NOTE_LENGTH} characters: ${note.length}`);
  }
  if (resolvedTags.length > MAX_TAGS) {
    throw new Error(`Douyin supports at most ${MAX_TAGS} topics: received ${resolvedTags.length}`);
  }
  const tagWithWhitespace = resolvedTags.find((tag) => /\s/u.test(tag));
  if (tagWithWhitespace) {
    throw new Error(`Douyin topic must not contain spaces: ${tagWithWhitespace}`);
  }

  const noteFile = createTempNoteFile(note);

  const sauArgs = [
    'douyin',
    'upload-note',
    '--account',
    options.account,
    '--images',
    ...images,
    '--title',
    title,
    '--notef',
    noteFile,
  ];

  if (resolvedTags.length > 0) sauArgs.push('--tags', resolvedTags.join(','));
  if (options.bgm) sauArgs.push('--bgm', options.bgm);
  if (options.draft) sauArgs.push('--draft', '--headed');

  const summary = {
    account: options.account,
    imageCount: images.length,
    title,
    titleLength: title.length,
    noteLength: note.length,
    tags: resolvedTags,
    tagCount: resolvedTags.length,
    captionPath,
    noteFile,
    mode: options.draft ? 'manual-handoff' : 'publish',
    dryRun: options.dryRun,
  };

  console.log('[sync-to-douyin] Resolved payload:');
  console.log(JSON.stringify(summary, null, 2));

  if (options.dryRun) {
    console.log('\n[sync-to-douyin] Dry run command:');
    console.log([options.sau, ...sauArgs].map(shellQuote).join(' '));
    return;
  }

  const code = await run(options.sau, sauArgs, process.cwd());
  if (code !== 0) {
    throw new Error(`sau exited with code ${code}. Try: sau douyin check --account ${options.account}`);
  }
}

await main().catch((error: unknown) => {
  console.error(`[sync-to-douyin] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
