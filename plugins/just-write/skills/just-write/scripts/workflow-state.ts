import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const WORKFLOW_SCHEMA_VERSION = 1 as const;

export type WorkflowMode =
  | 'full'
  | 'polish'
  | 'format'
  | 'wechat_publish'
  | 'xhs_materials'
  | 'douyin_sync';

export type WorkflowStage =
  | 'topic'
  | 'draft'
  | 'polish'
  | 'format'
  | 'assets'
  | 'publish'
  | 'complete';

export type PlatformStatus =
  | 'not_started'
  | 'ready'
  | 'generated'
  | 'dry_run'
  | 'published'
  | 'failed';

export interface WorkflowState {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  mode: WorkflowMode;
  currentStage: WorkflowStage;
  completedStages: WorkflowStage[];
  titles: {
    article: { value: string; locked: boolean };
    douyin?: { value: string; locked: boolean };
  };
  artifacts: {
    draft?: string;
    formatted?: string;
    imagesDir: string;
    xhsDir: string;
    douyinCaption: string;
  };
  platforms: {
    wechat: PlatformStatus;
    xhs: PlatformStatus;
    douyin: PlatformStatus;
  };
  updatedAt: string;
}

const MODES = new Set<WorkflowMode>([
  'full', 'polish', 'format', 'wechat_publish', 'xhs_materials', 'douyin_sync',
]);
const STAGES = new Set<WorkflowStage>([
  'topic', 'draft', 'polish', 'format', 'assets', 'publish', 'complete',
]);
const PLATFORM_STATUSES = new Set<PlatformStatus>([
  'not_started', 'ready', 'generated', 'dry_run', 'published', 'failed',
]);

function statePath(articleDir: string): string {
  return path.join(path.resolve(articleDir), '.just-write', 'workflow.json');
}

function toRelative(articleDir: string, filePath: string): string {
  return path.relative(path.resolve(articleDir), path.resolve(filePath)).replace(/\\/g, '/');
}

function extractTitles(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const titles: string[] = [];
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter) {
    const titleLine = frontmatter[1]!.match(/^title\s*:\s*(.+?)\s*$/m);
    if (titleLine) {
      const value = titleLine[1]!.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2').trim();
      if (value) titles.push(value);
    }
  }
  const h1 = content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (h1) titles.push(h1);
  return [...new Set(titles)];
}

function assertSingleFile(files: string[], label: string): string | undefined {
  if (files.length > 1) {
    throw new Error(`Multiple ${label} candidates found: ${files.map((file) => path.basename(file)).join(', ')}`);
  }
  return files[0];
}

export function bootstrapWorkflowState(articleDir: string, mode: WorkflowMode): WorkflowState {
  if (!MODES.has(mode)) throw new Error(`Unknown workflow mode: ${mode}`);
  const root = path.resolve(articleDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Article directory not found: ${root}`);
  }

  const markdownFiles = fs.readdirSync(root)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => path.join(root, name));
  const formatted = assertSingleFile(
    markdownFiles.filter((file) => /-formatted\.md$/i.test(file)),
    'formatted markdown',
  );
  const draft = assertSingleFile(
    markdownFiles.filter((file) => !/-(?:formatted|analysis)\.md$/i.test(file)),
    'draft markdown',
  );

  const explicitTitles = [...new Set([
    ...(formatted ? extractTitles(formatted) : []),
    ...(draft ? extractTitles(draft) : []),
  ])];
  if (explicitTitles.length > 1) {
    throw new Error(`Conflicting article titles found: ${explicitTitles.join(' | ')}`);
  }
  const articleTitle = explicitTitles[0] || path.basename(root);
  const currentStage: WorkflowStage = formatted ? 'assets' : draft ? 'polish' : 'topic';
  const completedStages: WorkflowStage[] = formatted
    ? ['topic', 'draft', 'polish', 'format']
    : draft ? ['topic', 'draft'] : [];

  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    mode,
    currentStage,
    completedStages,
    titles: { article: { value: articleTitle, locked: Boolean(formatted && explicitTitles[0]) } },
    artifacts: {
      ...(draft ? { draft: toRelative(root, draft) } : {}),
      ...(formatted ? { formatted: toRelative(root, formatted) } : {}),
      imagesDir: 'imgs',
      xhsDir: 'xhs',
      douyinCaption: 'douyin/douyin-caption.md',
    },
    platforms: {
      wechat: formatted ? 'ready' : 'not_started',
      xhs: fs.existsSync(path.join(root, 'xhs', 'caption.md')) ? 'generated' : 'not_started',
      douyin: 'not_started',
    },
    updatedAt: new Date().toISOString(),
  };
}

export function validateWorkflowState(value: unknown): WorkflowState {
  if (!value || typeof value !== 'object') throw new Error('Workflow state must be an object');
  const state = value as WorkflowState;
  if (state.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    throw new Error(`Unsupported workflow schema version: ${String(state.schemaVersion)}`);
  }
  if (!MODES.has(state.mode)) throw new Error(`Invalid workflow mode: ${String(state.mode)}`);
  if (!STAGES.has(state.currentStage)) throw new Error(`Invalid workflow stage: ${String(state.currentStage)}`);
  if (!Array.isArray(state.completedStages) || state.completedStages.some((item) => !STAGES.has(item))) {
    throw new Error('Invalid completedStages');
  }
  for (const platform of ['wechat', 'xhs', 'douyin'] as const) {
    if (!PLATFORM_STATUSES.has(state.platforms?.[platform])) {
      throw new Error(`Invalid ${platform} platform status`);
    }
  }
  if (!state.titles?.article || typeof state.titles.article.value !== 'string') {
    throw new Error('Missing article title state');
  }
  return state;
}

export function saveWorkflowState(articleDir: string, state: WorkflowState): string {
  validateWorkflowState(state);
  const target = statePath(articleDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  state.updatedAt = next.updatedAt;
  return target;
}

export function loadWorkflowState(articleDir: string): WorkflowState | null {
  const target = statePath(articleDir);
  if (!fs.existsSync(target)) return null;
  return validateWorkflowState(JSON.parse(fs.readFileSync(target, 'utf8')));
}

export function loadOrBootstrapWorkflowState(articleDir: string, mode: WorkflowMode): WorkflowState {
  const existing = loadWorkflowState(articleDir);
  return existing ? { ...existing, mode } : bootstrapWorkflowState(articleDir, mode);
}

export function advanceWorkflow(
  state: WorkflowState,
  currentStage: WorkflowStage,
  completedStage?: WorkflowStage,
): WorkflowState {
  if (!STAGES.has(currentStage)) throw new Error(`Unknown workflow stage: ${currentStage}`);
  const completedStages = completedStage && !state.completedStages.includes(completedStage)
    ? [...state.completedStages, completedStage]
    : [...state.completedStages];
  return { ...state, currentStage, completedStages };
}

export function setPlatformStatus(
  state: WorkflowState,
  platform: keyof WorkflowState['platforms'],
  status: PlatformStatus,
): WorkflowState {
  if (!PLATFORM_STATUSES.has(status)) throw new Error(`Unknown platform status: ${status}`);
  return { ...state, platforms: { ...state.platforms, [platform]: status } };
}

export function setWorkflowTitle(
  state: WorkflowState,
  kind: 'article' | 'douyin',
  value: string,
  locked: boolean,
): WorkflowState {
  const title = value.trim();
  if (!title) throw new Error('Title must not be empty');
  return { ...state, titles: { ...state.titles, [kind]: { value: title, locked } } };
}

export function setWorkflowArtifact(
  state: WorkflowState,
  name: keyof WorkflowState['artifacts'],
  relativePath: string,
): WorkflowState {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error('Artifact path must be relative to the article directory');
  }
  return { ...state, artifacts: { ...state.artifacts, [name]: normalized } };
}

export function findMissingArtifacts(articleDir: string, state: WorkflowState): string[] {
  const required = Object.entries(state.artifacts)
    .filter(([key, value]) => Boolean(value) && (key === 'draft' || key === 'formatted'))
    .map(([, value]) => String(value));
  return required.filter((relative) => !fs.existsSync(path.join(articleDir, relative)));
}

function usage(): never {
  console.log(`Workflow state manager

Usage:
  bun workflow-state.ts init <article-dir> --mode <mode>
  bun workflow-state.ts show <article-dir>
  bun workflow-state.ts advance <article-dir> --stage <stage> [--complete <stage>]
  bun workflow-state.ts platform <article-dir> --name <wechat|xhs|douyin> --status <status>
  bun workflow-state.ts title <article-dir> --kind <article|douyin> --value <title> [--lock]
  bun workflow-state.ts artifact <article-dir> --name <name> --path <relative-path>
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const [command, articleDir, ...args] = process.argv.slice(2);
  if (!command || !articleDir || command === '--help') usage();
  const arg = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  if (command === 'init') {
    const mode = arg('--mode') as WorkflowMode | undefined;
    if (!mode) throw new Error('--mode is required');
    const state = loadOrBootstrapWorkflowState(articleDir, mode);
    saveWorkflowState(articleDir, state);
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  const state = loadWorkflowState(articleDir);
  if (!state) throw new Error(`Workflow state not found: ${statePath(articleDir)}`);
  if (command === 'show') {
    const missing = findMissingArtifacts(articleDir, state);
    console.log(JSON.stringify({ ...state, missingArtifacts: missing }, null, 2));
    return;
  }
  if (command === 'advance') {
    const stage = arg('--stage') as WorkflowStage | undefined;
    if (!stage) throw new Error('--stage is required');
    const next = advanceWorkflow(state, stage, arg('--complete') as WorkflowStage | undefined);
    saveWorkflowState(articleDir, next);
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  if (command === 'platform') {
    const name = arg('--name') as keyof WorkflowState['platforms'] | undefined;
    const status = arg('--status') as PlatformStatus | undefined;
    if (!name || !['wechat', 'xhs', 'douyin'].includes(name)) throw new Error('--name is invalid');
    if (!status) throw new Error('--status is required');
    const next = setPlatformStatus(state, name, status);
    saveWorkflowState(articleDir, next);
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  if (command === 'title') {
    const kind = arg('--kind') as 'article' | 'douyin' | undefined;
    const value = arg('--value');
    if (!kind || !['article', 'douyin'].includes(kind)) throw new Error('--kind is invalid');
    if (!value) throw new Error('--value is required');
    const next = setWorkflowTitle(state, kind, value, args.includes('--lock'));
    saveWorkflowState(articleDir, next);
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  if (command === 'artifact') {
    const name = arg('--name') as keyof WorkflowState['artifacts'] | undefined;
    const value = arg('--path');
    const names = ['draft', 'formatted', 'imagesDir', 'xhsDir', 'douyinCaption'];
    if (!name || !names.includes(name)) throw new Error('--name is invalid');
    if (!value) throw new Error('--path is required');
    const next = setWorkflowArtifact(state, name, value);
    saveWorkflowState(articleDir, next);
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
