import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePlatformResult, type PlatformName, type PlatformOperationResult } from '../../../lib/platform-result';

export const WORKFLOW_SCHEMA_VERSION = 2 as const;
export type WorkflowMode = 'full' | 'polish' | 'format' | 'wechat_publish' | 'xhs_materials' | 'douyin_sync';
export type WorkflowStage = 'topic' | 'draft' | 'polish' | 'format' | 'assets' | 'publish' | 'complete';
export type PlatformStatus = 'not_started' | 'ready' | 'generated' | 'dry_run' | 'manual_handoff' | 'draft_saved' | 'published' | 'outcome_unknown' | 'failed';
export interface TitleState {
  value: string; locked: boolean;
  confirmation?: { source: 'user_instruction' | 'user_confirmation' | 'legacy_unverified'; value: string; at?: string };
}
export interface ArtifactEvidence {
  origin: 'imported' | 'generated'; recordedAt: string;
  files: Record<string, string>; inputs: Record<string, string>;
  titleInputs?: Partial<Record<'article' | 'douyin', string>>;
}
export interface WorkflowState {
  schemaVersion: 2; mode: WorkflowMode; currentStage: WorkflowStage; completedStages: WorkflowStage[];
  titles: { article: TitleState; douyin?: TitleState };
  artifacts: { draft?: string; formatted?: string; imagesDir: string; wechatCover?: string; xhsCover?: string; xhsDir: string; douyinCaption: string };
  artifactEvidence?: Partial<Record<keyof WorkflowState['artifacts'], ArtifactEvidence>>;
  platforms: Record<PlatformName, { status: PlatformStatus; lastResult?: PlatformOperationResult }>;
  legacy?: { schemaVersion: 1; completedStages: WorkflowStage[]; platforms: Record<string, string>; migratedAt: string };
  updatedAt: string;
}
export interface Diagnostic { kind: 'missing' | 'changed' | 'unverified'; path: string; message: string }
const MODES = ['full', 'polish', 'format', 'wechat_publish', 'xhs_materials', 'douyin_sync'];
const STAGES = ['topic', 'draft', 'polish', 'format', 'assets', 'publish', 'complete'];
const NAMES = ['draft', 'formatted', 'imagesDir', 'wechatCover', 'xhsCover', 'xhsDir', 'douyinCaption'];
const STATUS: Record<PlatformName, string[]> = {
  wechat: ['not_started', 'ready', 'manual_handoff', 'draft_saved', 'outcome_unknown', 'failed'],
  xhs: ['not_started', 'ready', 'generated', 'failed'],
  douyin: ['not_started', 'ready', 'dry_run', 'manual_handoff', 'published', 'outcome_unknown', 'failed'],
};
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function checkFields(value: object, allowed: string[]): void { for (const key of Object.keys(value)) assert(allowed.includes(key), '未知状态字段：' + key); }
const STATE_FIELDS = ['schemaVersion', 'mode', 'currentStage', 'completedStages', 'titles', 'artifacts', 'artifactEvidence', 'platforms', 'legacy', 'updatedAt'];
export function normalizeArtifactPath(value: string): string {
  assert(typeof value === 'string', '产物路径必须是字符串');
  const relative = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  assert(relative && !relative.startsWith('/') && !/^[A-Za-z]:/.test(relative) && !relative.split('/').includes('..'), '产物路径必须相对于文章目录');
  return relative;
}
/** 同时防止现有符号链接和联接点将管理路径引出文章目录。 */
function managedPath(articleDir: string, relative: string): string {
  const root = fs.realpathSync(path.resolve(articleDir));
  const target = path.resolve(root, normalizeArtifactPath(relative));
  let existing = target;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const resolved = fs.realpathSync(existing);
  const outside = path.relative(root, resolved);
  assert(!outside.startsWith('..') && !path.isAbsolute(outside), '产物路径解析后越出文章目录');
  return target;
}
const statePath = (dir: string) => managedPath(dir, '.just-write/workflow.json');
const hashFile = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function extractTitles(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const fm = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const title = fm?.[1]?.match(/^title\s*:\s*(.+?)\s*$/m)?.[1]?.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
  const body = fm ? text.slice(fm[0].length) : text;
  return [...new Set([title, body.match(/^#\s+(.+?)\s*$/m)?.[1]].filter((x): x is string => Boolean(x)).map(x => x.trim()))];
}
export function bootstrapWorkflowState(dir: string, mode: WorkflowMode, selection: { draft?: string; formatted?: string } = {}): WorkflowState {
  assert(MODES.includes(mode), '未知工作流模式');
  assert(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), '文章目录不存在');
  const files = fs.readdirSync(dir).filter(x => /\.md$/i.test(x));
  const choose = (names: string[], selected?: string) => {
    if (selected) { const p = normalizeArtifactPath(selected); assert(fs.statSync(managedPath(dir, p)).isFile(), '正文路径不是文件'); return p; }
    assert(names.length <= 1, '存在多个正文候选，请显式提供 --draft 或 --formatted'); return names[0];
  };
  const draft = choose(files.filter(x => !/-(?:formatted|analysis)\.md$/i.test(x)), selection.draft);
  const formatted = choose(files.filter(x => /-formatted\.md$/i.test(x)), selection.formatted);
  const titles = [...new Set([draft, formatted].filter((x): x is string => Boolean(x)).flatMap(x => extractTitles(managedPath(dir, x))))];
  assert(titles.length <= 1, '文章标题冲突，请先解决 frontmatter 与 H1 的差异');
  const stage: WorkflowStage = mode === 'wechat_publish' || mode === 'douyin_sync' ? 'publish' : mode === 'xhs_materials' ? 'assets' : mode === 'format' ? 'format' : mode === 'polish' ? 'polish' : draft || formatted ? 'draft' : 'topic';
  let state: WorkflowState = {
    schemaVersion: 2, mode, currentStage: stage, completedStages: [],
    titles: { article: { value: titles[0] || path.basename(path.resolve(dir)), locked: false } },
    artifacts: { draft, formatted, imagesDir: 'imgs', xhsDir: 'xhs', douyinCaption: 'douyin/douyin-caption.md' },
    platforms: { wechat: { status: 'not_started' }, xhs: { status: 'not_started' }, douyin: { status: 'not_started' } }, updatedAt: new Date().toISOString(),
  };
  for (const [name, p] of [['wechatCover', 'imgs/cover.png'], ['xhsCover', 'imgs/cover-xhs.png']] as const) if (fs.existsSync(managedPath(dir, p))) state.artifacts[name] = p;
  for (const name of NAMES as Array<keyof WorkflowState['artifacts']>) {
    const p = state.artifacts[name];
    if (p && name !== 'imagesDir' && fs.existsSync(managedPath(dir, p))) state = recordArtifact(dir, state, name, p);
  }
  return state;
}
function validateTitle(title: TitleState): void {
  assert(title && typeof title.value === 'string' && typeof title.locked === 'boolean', '标题字段类型无效');
  checkFields(title, ['value', 'locked', 'confirmation']);
  if (title.confirmation) {
    checkFields(title.confirmation, ['source', 'value', 'at']);
    assert(['user_instruction', 'user_confirmation', 'legacy_unverified'].includes(title.confirmation.source) && title.confirmation.value === title.value, '标题确认记录无效');
    if (title.confirmation.at) assert(Number.isFinite(Date.parse(title.confirmation.at)), '标题确认时间无效');
  }
}
export function validateWorkflowState(value: unknown): WorkflowState {
  assert(value && typeof value === 'object' && !Array.isArray(value), '工作流状态必须是对象');
  const s = value as WorkflowState;
  checkFields(s, STATE_FIELDS);
  assert(s.schemaVersion === 2, '不支持的工作流版本：' + s.schemaVersion);
  assert(MODES.includes(s.mode) && STAGES.includes(s.currentStage), '工作流模式或阶段无效');
  assert(Array.isArray(s.completedStages) && s.completedStages.every(x => STAGES.includes(x)), '完成阶段无效');
  validateTitle(s.titles?.article); if (s.titles.douyin) validateTitle(s.titles.douyin);
  checkFields(s.titles, ['article', 'douyin']);
  assert(s.artifacts && ['imagesDir', 'xhsDir', 'douyinCaption'].every(x => typeof s.artifacts[x as keyof typeof s.artifacts] === 'string'), '缺少产物路径字段');
  for (const [name, p] of Object.entries(s.artifacts)) if (p !== undefined) { assert(NAMES.includes(name), '未知产物字段'); normalizeArtifactPath(p); }
  for (const name of ['wechat', 'xhs', 'douyin'] as const) {
    const p = s.platforms?.[name]; assert(p && STATUS[name].includes(p.status), '平台状态无效：' + name);
    checkFields(p, ['status', 'lastResult']);
    if (p.lastResult) { validatePlatformResult(p.lastResult); assert(p.lastResult.platform === name, '平台结果归属不匹配'); assert(p.status === p.lastResult.status || name === 'wechat' && p.status === 'ready' && p.lastResult.status === 'dry_run', '平台结果与状态不匹配'); }
    if (['draft_saved', 'published', 'manual_handoff', 'generated', 'dry_run'].includes(p.status)) assert(p.lastResult, '完成状态缺少操作结果');
  }
  checkFields(s.platforms, ['wechat', 'xhs', 'douyin']);
  for (const [name, ev] of Object.entries(s.artifactEvidence || {})) {
    assert(NAMES.includes(name) && ev && ['imported', 'generated'].includes(ev.origin) && Number.isFinite(Date.parse(ev.recordedAt)), '产物证据无效');
    checkFields(ev, ['origin', 'recordedAt', 'files', 'inputs', 'titleInputs']);
    for (const group of [ev.files, ev.inputs]) { assert(group && typeof group === 'object' && !Array.isArray(group), '快照必须是对象'); for (const [p, hash] of Object.entries(group)) { normalizeArtifactPath(p); assert(typeof hash === 'string' && /^[a-f\d]{64}$/.test(hash), '快照摘要无效'); } }
    if (ev.titleInputs) for (const [kind, title] of Object.entries(ev.titleInputs)) assert(['article', 'douyin'].includes(kind) && typeof title === 'string', '标题依赖无效');
  }
  assert(typeof s.updatedAt === 'string' && Number.isFinite(Date.parse(s.updatedAt)), '更新时间无效');
  if (s.legacy) assert(s.legacy.schemaVersion === 1 && Array.isArray(s.legacy.completedStages) && s.legacy.completedStages.every(x => STAGES.includes(x)) && s.legacy.platforms && Object.values(s.legacy.platforms).every(x => typeof x === 'string') && Number.isFinite(Date.parse(s.legacy.migratedAt)), '旧状态记录无效');
  if (s.legacy) checkFields(s.legacy, ['schemaVersion', 'completedStages', 'platforms', 'migratedAt']);
  return s;
}
export function migrateWorkflowState(value: unknown): WorkflowState {
  const old = value as any;
  if (old?.schemaVersion === 2) return validateWorkflowState(old);
  assert(old?.schemaVersion === 1 && MODES.includes(old.mode) && STAGES.includes(old.currentStage), '旧状态版本或模式无效');
  checkFields(old, STATE_FIELDS);
  assert(Array.isArray(old.completedStages) && old.completedStages.every((x: string) => STAGES.includes(x)), '旧完成阶段无效');
  validateTitle(old.titles?.article); if (old.titles?.douyin) validateTitle(old.titles.douyin);
  const titles = Object.fromEntries(Object.entries(old.titles).map(([k, v]) => { const t = v as TitleState; return [k, { ...t, confirmation: t.locked ? { source: 'legacy_unverified', value: t.value } : undefined }]; }));
  const oldStatuses = ['not_started', 'ready', 'generated', 'dry_run', 'published', 'failed'];
  const platforms = Object.fromEntries(['wechat', 'xhs', 'douyin'].map(name => { assert(oldStatuses.includes(old.platforms?.[name]), '旧平台状态无效'); return [name, { status: name !== 'xhs' && old.platforms[name] === 'published' ? 'outcome_unknown' : 'not_started' }]; }));
  return validateWorkflowState({ ...old, schemaVersion: 2, titles, platforms, completedStages: [], artifactEvidence: {}, legacy: { schemaVersion: 1, completedStages: old.completedStages, platforms: old.platforms, migratedAt: new Date().toISOString() } });
}
export function loadWorkflowState(dir: string): WorkflowState | null {
  const target = statePath(dir); return fs.existsSync(target) ? migrateWorkflowState(JSON.parse(fs.readFileSync(target, 'utf8'))) : null;
}
export function saveWorkflowState(dir: string, state: WorkflowState): string {
  validateWorkflowState(state);
  const target = statePath(dir);
  if (fs.existsSync(target)) {
    const raw = fs.readFileSync(target, 'utf8'); const old = JSON.parse(raw);
    if (old.schemaVersion === 1) {
      migrateWorkflowState(old);
      const backup = managedPath(dir, '.just-write/workflow.v1.backup.json');
      if (fs.existsSync(backup)) assert(fs.readFileSync(backup, 'utf8') === raw, '已有不同的 v1 备份，拒绝覆盖');
      else fs.writeFileSync(backup, raw, { encoding: 'utf8', flag: 'wx' });
    }
  }
  for (const p of Object.values(state.artifacts)) if (p) managedPath(dir, p);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() }; const temp = target + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  try { fs.renameSync(temp, target); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  state.updatedAt = next.updatedAt; return target;
}
export function loadOrBootstrapWorkflowState(dir: string, mode: WorkflowMode): WorkflowState {
  assert(MODES.includes(mode), '未知模式'); const s = loadWorkflowState(dir); return s ? { ...s, mode } : bootstrapWorkflowState(dir, mode);
}
export function advanceWorkflow(s: WorkflowState, stage: WorkflowStage, completed?: WorkflowStage): WorkflowState {
  assert(STAGES.includes(stage) && (!completed || STAGES.includes(completed)), '未知阶段');
  return { ...s, currentStage: stage, completedStages: completed ? [...new Set([...s.completedStages, completed])] : [...s.completedStages] };
}
export function setPlatformStatus(s: WorkflowState, name: PlatformName, status: PlatformStatus, result?: PlatformOperationResult): WorkflowState {
  assert(Object.hasOwn(STATUS, name) && STATUS[name].includes(status), '平台状态不匹配');
  if (result) { validatePlatformResult(result); assert(result.platform === name && (result.status === status || name === 'wechat' && status === 'ready' && result.status === 'dry_run'), '结果与状态不匹配'); }
  if (['draft_saved', 'published', 'manual_handoff', 'generated', 'dry_run'].includes(status)) assert(result, '成功结果必须提供 --result-file');
  return validateWorkflowState({ ...s, platforms: { ...s.platforms, [name]: { status, ...(result ? { lastResult: result } : {}) } } });
}
export function setWorkflowTitle(s: WorkflowState, kind: 'article' | 'douyin', value: string, locked: boolean, options: { replaceLocked?: boolean; confirmationSource?: 'user_instruction' | 'user_confirmation' } = {}): WorkflowState {
  assert(['article', 'douyin'].includes(kind), '未知标题类型'); assert(typeof value === 'string' && value.trim(), '标题不能为空');
  const old = s.titles[kind]; assert(!old?.locked || old.value === value && locked || options.replaceLocked, '标题已锁定，需要 --replace-locked');
  const title: TitleState = { value, locked, ...(locked ? { confirmation: { source: options.confirmationSource || 'user_confirmation', value, at: new Date().toISOString() } } : {}) };
  return { ...s, titles: { ...s.titles, [kind]: title } };
}
export function setWorkflowArtifact(s: WorkflowState, name: keyof WorkflowState['artifacts'], p: string): WorkflowState {
  assert(NAMES.includes(name), '未知产物'); const ev = { ...s.artifactEvidence }; delete ev[name];
  return { ...s, artifacts: { ...s.artifacts, [name]: normalizeArtifactPath(p) }, artifactEvidence: ev };
}
function snapshot(dir: string, relative: string): Record<string, string> {
  const target = managedPath(dir, relative); assert(fs.existsSync(target), '产物不存在：' + relative);
  if (fs.statSync(target).isFile()) return { [relative]: hashFile(target) };
  return Object.fromEntries(fs.readdirSync(target).filter(x => /^(?:\d{2,}-.*\.png|caption\.md|preview\.html|render-report\.json)$/i.test(x)).sort().map(x => { const p = relative + '/' + x; return [p, hashFile(managedPath(dir, p))]; }));
}
export function recordArtifact(dir: string, s: WorkflowState, name: keyof WorkflowState['artifacts'], p: string, origin: ArtifactEvidence['origin'] = 'imported', inputs: string[] = []): WorkflowState {
  assert(['imported', 'generated'].includes(origin), '产物来源无效'); const next = setWorkflowArtifact(s, name, p); const relative = next.artifacts[name]!;
  const inputHashes = Object.assign({}, ...inputs.map(x => snapshot(dir, normalizeArtifactPath(x))));
  const files = snapshot(dir, relative); assert(Object.keys(files).length > 0, '没有可登记的管理产物');
  const titleKind = name === 'douyinCaption' ? 'douyin' : ['formatted', 'wechatCover', 'xhsCover', 'xhsDir'].includes(name) ? 'article' : undefined;
  const titleInputs = origin === 'generated' && titleKind && s.titles[titleKind] ? { [titleKind]: s.titles[titleKind]!.value } : undefined;
  return { ...next, artifactEvidence: { ...next.artifactEvidence, [name]: { origin, recordedAt: new Date().toISOString(), files, inputs: inputHashes, ...(titleInputs ? { titleInputs } : {}) } } };
}
export function findMissingArtifacts(dir: string, s: WorkflowState): string[] {
  return [s.artifacts.draft, s.artifacts.formatted].filter((p): p is string => Boolean(p)).filter(p => !fs.existsSync(managedPath(dir, p)));
}
export function verifyWorkflow(dir: string, s: WorkflowState, operation: 'format' | 'wechat' | 'xhs' | 'douyin'): Diagnostic[] {
  assert(['format', 'wechat', 'xhs', 'douyin'].includes(operation), '未知校验动作');
  const names: Array<keyof WorkflowState['artifacts']> = operation === 'douyin' ? ['xhsDir', 'douyinCaption'] : [operation === 'format' ? s.artifacts.draft ? 'draft' : 'formatted' : s.artifacts.formatted ? 'formatted' : 'draft'];
  if (operation === 'wechat' && s.artifacts.wechatCover) names.push('wechatCover');
  if (operation === 'xhs' && s.artifacts.xhsCover) names.push('xhsCover');
  const diagnostics: Diagnostic[] = []; const seen = new Set<string>();
  const add = (kind: Diagnostic['kind'], p: string, message: string) => { const key = kind + ':' + p; if (!seen.has(key)) { seen.add(key); diagnostics.push({ kind, path: p, message }); } };
  for (const name of names) {
    const p = s.artifacts[name]; if (!p || !fs.existsSync(managedPath(dir, p))) { add('missing', p || name, '本次动作需要的产物不存在'); continue; }
    const target = managedPath(dir, p); const directory = name === 'xhsDir';
    if (directory !== fs.statSync(target).isDirectory()) { add('missing', p, '产物类型不符合用途'); continue; }
    if (directory && !fs.readdirSync(target).some(x => /^\d{2,}-.*\.png$/i.test(x))) add('missing', p, '没有编号轮播图片');
    const ev = s.artifactEvidence?.[name];
    if (!ev) add('unverified', p, '尚无生成快照，按本次任务核对即可');
    else {
      for (const [kind, value] of Object.entries(ev.titleInputs || {})) if (s.titles[kind as 'article' | 'douyin']?.value !== value) add('changed', 'titles.' + kind, '生成时使用的标题已变化，先核对或重新生成');
      const current = snapshot(dir, p);
      for (const recorded of Object.keys(current)) if (!(recorded in ev.files)) add('changed', recorded, '出现未登记的管理文件');
      for (const [file, hash] of Object.entries({ ...ev.files, ...ev.inputs })) {
        const full = managedPath(dir, file); if (!fs.existsSync(full)) add('missing', file, '快照依赖已丢失'); else if (!fs.statSync(full).isFile() || hashFile(full) !== hash) add('changed', file, '产物或生成输入已变化');
      }
    }
    if (!directory && /\.md$/i.test(p)) {
      const text = fs.readFileSync(target, 'utf8');
      for (const match of text.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)) {
        const src = match[1] || match[2]!; if (/^(?:https?:|data:)/i.test(src)) continue;
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(p), src));
        if (!fs.existsSync(managedPath(dir, relative))) add('missing', relative, '正文图片已丢失');
      }
    }
  }
  return diagnostics;
}
export function runCli(args: string[]): number {
  try {
    const [command, dir, ...rest] = args;
    if (command === '--help' || !command) {
      console.log(`工作流状态（schemaVersion 2）
用法：workflow-state.ts <命令> <文章目录> [参数]
  init --mode <模式> [--draft <相对路径>] [--formatted <相对路径>]
  show                       只读显示，读取 v1 不写入
  verify --for <format|wechat|xhs|douyin>
  migrate                    本地迁移，保留不可覆盖的 v1 备份
  advance --stage <阶段> [--complete <已执行阶段>]
  artifact --name <产物> --path <相对路径> [--origin <imported|generated>] [--input <相对路径> ...]
  title --kind <article|douyin> --value <标题> [--lock] [--replace-locked] [--confirmation-source <user_instruction|user_confirmation>]
  platform --name <wechat|xhs|douyin> --status <状态> [--result-file <JSON>]
模式：${MODES.join(' / ')}
阶段：${STAGES.join(' / ')}
退出码：0 完成或无阻断；1 verify 发现缺失或变化；2 参数、配置或读写错误。`);
      return 0;
    }
    assert(dir && !dir.startsWith('--'), '需要文章目录');
    const flags = new Map<string, string[]>(); const bools = new Set(['--lock', '--replace-locked']);
    const allowed: Record<string, string[]> = { init: ['--mode', '--draft', '--formatted'], show: [], verify: ['--for'], migrate: [], advance: ['--stage', '--complete'], artifact: ['--name', '--path', '--origin', '--input'], title: ['--kind', '--value', '--lock', '--replace-locked', '--confirmation-source'], platform: ['--name', '--status', '--result-file'] };
    assert(Object.hasOwn(allowed, command), '未知命令');
    for (let i = 0; i < rest.length; i++) { const flag = rest[i]!; assert(allowed[command]!.includes(flag), '未知参数：' + flag); const value = bools.has(flag) ? 'true' : rest[++i]; assert(value !== undefined && !value.startsWith('--'), '参数缺值：' + flag); if (flag !== '--input') assert(!flags.has(flag), '重复参数：' + flag); flags.set(flag, [...(flags.get(flag) || []), value]); }
    const get = (flag: string) => flags.get(flag)?.[0]; const required = (flag: string) => { const x = get(flag); assert(x !== undefined, '缺少参数：' + flag); return x; };
    let s = loadWorkflowState(dir);
    if (command === 'init') {
      const mode = required('--mode') as WorkflowMode; assert(MODES.includes(mode), '未知模式');
      if (!s) s = bootstrapWorkflowState(dir, mode, { draft: get('--draft'), formatted: get('--formatted') });
      else {
        s = { ...s, mode };
        for (const name of ['draft', 'formatted'] as const) if (get('--' + name)) s = recordArtifact(dir, s, name, get('--' + name)!);
        const titles = [...new Set([s.artifacts.draft, s.artifacts.formatted].filter((p): p is string => Boolean(p)).filter(p => fs.existsSync(managedPath(dir, p))).flatMap(p => extractTitles(managedPath(dir, p))))];
        assert(titles.length <= 1, '文章标题冲突，请先解决 frontmatter 与 H1 的差异');
        if (titles[0] && titles[0] !== s.titles.article.value) {
          assert(!s.titles.article.locked, '所选正文与锁定标题不同，先显式处理标题');
          s = setWorkflowTitle(s, 'article', titles[0], false);
        }
      }
    }
    else assert(s, '没有工作流状态，请先 init');
    if (command === 'show') { const operations = ['format', 'wechat', 'xhs', 'douyin'] as const; console.log(JSON.stringify({ ...s, missingArtifacts: findMissingArtifacts(dir, s!), diagnostics: Object.fromEntries(operations.map(op => [op, verifyWorkflow(dir, s!, op)])), migrationPending: JSON.parse(fs.readFileSync(statePath(dir), 'utf8')).schemaVersion === 1 }, null, 2)); return 0; }
    if (command === 'verify') { const findings = verifyWorkflow(dir, s!, required('--for') as any); console.log(JSON.stringify({ diagnostics: findings }, null, 2)); return findings.some(x => x.kind === 'missing' || x.kind === 'changed') ? 1 : 0; }
    if (command === 'advance') s = advanceWorkflow(s!, required('--stage') as WorkflowStage, get('--complete') as WorkflowStage | undefined);
    if (command === 'artifact') s = recordArtifact(dir, s!, required('--name') as any, required('--path'), (get('--origin') || 'imported') as any, flags.get('--input') || []);
    if (command === 'title') { const source = get('--confirmation-source'); assert(!source || ['user_instruction', 'user_confirmation'].includes(source), '确认来源无效'); s = setWorkflowTitle(s!, required('--kind') as any, required('--value'), flags.has('--lock'), { replaceLocked: flags.has('--replace-locked'), confirmationSource: source as any }); }
    if (command === 'platform') { const resultFile = get('--result-file'); const parsed = resultFile ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : undefined; const result = parsed?.result ?? parsed; s = setPlatformStatus(s!, required('--name') as any, required('--status') as PlatformStatus, result); }
    if (command === 'migrate' && JSON.parse(fs.readFileSync(statePath(dir), 'utf8')).schemaVersion === 2) { console.log(JSON.stringify(s, null, 2)); return 0; }
    saveWorkflowState(dir, s!); console.log(JSON.stringify(s, null, 2)); return 0;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 2; }
}
if (import.meta.main) process.exitCode = runCli(process.argv.slice(2));
