import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapWorkflowState, loadWorkflowState, saveWorkflowState, migrateWorkflowState, advanceWorkflow, setPlatformStatus, setWorkflowTitle, setWorkflowArtifact, recordArtifact, verifyWorkflow, runCli, validateWorkflowState } from './workflow-state';
import { operationResult } from '../../../lib/platform-result';
const roots: string[] = [];
function article() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-state-')); roots.push(dir); return dir; }
function put(dir: string, name: string, text: string) { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text); }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function legacy(dir: string) { const s = bootstrapWorkflowState(dir, 'full'); return { ...s, schemaVersion: 1, completedStages: ['topic', 'draft', 'format'], titles: { article: { value: '标题', locked: true } }, platforms: { wechat: 'published', xhs: 'generated', douyin: 'dry_run' } }; }
describe('工作流 v2', () => {
  test('导入排版稿不冒认完成、标题认可或素材生成', () => {
    const dir = article(); put(dir, '稿-formatted.md', '---\ntitle: 标题\n---\n# 标题\n正文');
    const s = bootstrapWorkflowState(dir, 'xhs_materials');
    expect(s.currentStage).toBe('assets'); expect(s.completedStages).toEqual([]); expect(s.titles.article).toEqual({ value: '标题', locked: false });
    expect(s.platforms.xhs.status).toBe('not_started'); expect(s.artifactEvidence?.formatted?.origin).toBe('imported');
    expect(verifyWorkflow(dir, s, 'format').some(x => x.kind === 'missing')).toBe(false);
  });
  test('正文歧义可显式消除，标题冲突仍拒绝猜测', () => {
    const dir = article(); put(dir, 'a.md', '# A'); put(dir, 'b.md', '# B');
    expect(() => bootstrapWorkflowState(dir, 'full')).toThrow('候选');
    expect(bootstrapWorkflowState(dir, 'full', { draft: 'a.md' }).artifacts.draft).toBe('a.md');
    put(dir, 'a-formatted.md', '---\ntitle: B\n---\n# A');
    expect(() => bootstrapWorkflowState(dir, 'format', { draft: 'a.md' })).toThrow('冲突');
  });
  test('标题保护和抖音独立标题', () => {
    const dir = article(); let s = bootstrapWorkflowState(dir, 'full'); s = setWorkflowTitle(s, 'article', '原题', true, { confirmationSource: 'user_instruction' });
    expect(() => setWorkflowTitle(s, 'article', '新题', true)).toThrow('锁定');
    expect(() => setWorkflowTitle(s, 'article', '原题', false)).toThrow('锁定');
    s = setWorkflowTitle(s, 'article', '新题', true, { replaceLocked: true }); s = setWorkflowTitle(s, 'douyin', '短题', true);
    expect(s.titles.article.value).toBe('新题'); expect(s.titles.douyin?.confirmation?.value).toBe('短题');
  });
  test('只读迁移不改文件，写入先备份且迁移幂等', () => {
    const dir = article(); put(dir, '稿.md', '# 标题'); const old = legacy(dir); const raw = JSON.stringify(old); put(dir, '.just-write/workflow.json', raw);
    const migrated = loadWorkflowState(dir)!;
    expect(fs.readFileSync(path.join(dir, '.just-write/workflow.json'), 'utf8')).toBe(raw);
    expect(migrated.completedStages).toEqual([]); expect(migrated.legacy?.completedStages).toEqual(old.completedStages);
    expect(migrated.titles.article.locked).toBe(true); expect(migrated.titles.article.confirmation?.source).toBe('legacy_unverified');
    expect(migrated.platforms.wechat.status).toBe('outcome_unknown'); expect(migrated.platforms.xhs.status).toBe('not_started');
    saveWorkflowState(dir, migrated); expect(fs.readFileSync(path.join(dir, '.just-write/workflow.v1.backup.json'), 'utf8')).toBe(raw);
    expect(migrateWorkflowState(migrated)).toEqual(migrated);
  });
  test('拒绝覆盖不同备份，失败保留原状态', () => {
    const dir = article(); const raw = JSON.stringify(legacy(dir)); put(dir, '.just-write/workflow.json', raw); put(dir, '.just-write/workflow.v1.backup.json', '先前备份');
    expect(() => saveWorkflowState(dir, loadWorkflowState(dir)!)).toThrow('备份'); expect(fs.readFileSync(path.join(dir, '.just-write/workflow.json'), 'utf8')).toBe(raw);
  });
  test('完成阶段不补造前置操作，校验完成参数', () => {
    const s = bootstrapWorkflowState(article(), 'full'); expect(advanceWorkflow(s, 'complete', 'format').completedStages).toEqual(['format']);
    expect(() => advanceWorkflow(s, 'format', 'invalid' as any)).toThrow('阶段');
  });
  test('来源变化只影响相关任务，不抹掉旧草稿回执', () => {
    const dir = article(); put(dir, '稿.md', '# 标题\n初稿'); put(dir, '稿-formatted.md', '# 标题\n排版'); let s = bootstrapWorkflowState(dir, 'full');
    s = recordArtifact(dir, s, 'formatted', '稿-formatted.md', 'generated', ['稿.md']);
    s = setPlatformStatus(s, 'wechat', 'draft_saved', operationResult('wechat', 'save_draft', 'draft_saved', { receipt: { kind: 'api', id: 'fixture-id' }, verification: 'verified' }));
    put(dir, '稿.md', '# 标题\n修改');
    expect(verifyWorkflow(dir, s, 'xhs').some(x => x.kind === 'changed' && x.path === '稿.md')).toBe(true);
    expect(s.platforms.wechat.lastResult?.receipt?.id).toBe('fixture-id');
    expect(verifyWorkflow(dir, s, 'format').some(x => x.kind === 'missing')).toBe(false);
  });
  test('显式更换标题使相关衍生产物待核对，保留原始导入稿和历史回执', () => {
    const dir = article(); put(dir, '稿.md', '# 原题'); put(dir, '稿-formatted.md', '# 原题'); let s = bootstrapWorkflowState(dir, 'full');
    s = recordArtifact(dir, s, 'formatted', '稿-formatted.md', 'generated', ['稿.md']);
    s = setPlatformStatus(s, 'wechat', 'draft_saved', operationResult('wechat', 'save_draft', 'draft_saved', { receipt: { kind: 'api', id: 'old-draft' }, verification: 'verified' }));
    s = setWorkflowTitle(s, 'article', '新题', true);
    expect(verifyWorkflow(dir, s, 'wechat').some(x => x.kind === 'changed' && x.path === 'titles.article')).toBe(true);
    expect(verifyWorkflow(dir, s, 'format').some(x => x.kind === 'changed')).toBe(false);
    expect(s.platforms.wechat.lastResult?.receipt?.id).toBe('old-draft');
    s = recordArtifact(dir, s, 'formatted', '稿-formatted.md', 'generated', ['稿.md']);
    expect(verifyWorkflow(dir, s, 'wechat').some(x => x.kind === 'changed')).toBe(false);
  });
  test('已有状态的 init 使用显式正文路径，拒绝绕过标题锁', () => {
    const dir = article(); put(dir, 'a.md', '# 原题'); let s = bootstrapWorkflowState(dir, 'full'); saveWorkflowState(dir, s);
    put(dir, 'b.md', '# 原题'); put(dir, 'c.md', '# 别题'); const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {};
    try {
      expect(runCli(['init', dir, '--mode', 'polish', '--draft', 'b.md'])).toBe(0);
      expect(loadWorkflowState(dir)?.artifacts.draft).toBe('b.md');
      s = setWorkflowTitle(loadWorkflowState(dir)!, 'article', '原题', true); saveWorkflowState(dir, s);
      expect(runCli(['init', dir, '--mode', 'polish', '--draft', 'c.md'])).toBe(2);
      expect(loadWorkflowState(dir)?.artifacts.draft).toBe('b.md');
    } finally { console.log = log; console.error = err; }
  });
  test('缺图、无编号轮播和独立抖音文案被发现', () => {
    const dir = article(); put(dir, '稿.md', '# 标题\n![正文图](imgs/missing.png)'); let s = bootstrapWorkflowState(dir, 'full');
    expect(verifyWorkflow(dir, s, 'wechat').some(x => x.path === 'imgs/missing.png')).toBe(true);
    fs.mkdirSync(path.join(dir, 'xhs')); expect(verifyWorkflow(dir, s, 'douyin').filter(x => x.kind === 'missing').length).toBe(2);
    put(dir, 'xhs/01-cover.png', '图片'); put(dir, 'douyin/douyin-caption.md', '标题\n正文');
    expect(verifyWorkflow(dir, s, 'douyin').some(x => x.kind === 'missing')).toBe(false);
  });
  test('路径和 schema 严格校验', () => {
    const s = bootstrapWorkflowState(article(), 'full');
    for (const p of ['../x', '/x', 'C:\\x', '\\\\server\\x']) expect(() => setWorkflowArtifact(s, 'draft', p)).toThrow('相对');
    expect(() => validateWorkflowState({ ...s, titles: { article: { value: '标题', locked: 'true' } } })).toThrow('类型');
    expect(() => validateWorkflowState({ ...s, schemaVersion: 99 })).toThrow('版本');
    expect(() => validateWorkflowState({ ...s, access_token: '不可保存' })).toThrow('字段');
    expect(() => migrateWorkflowState({ ...legacy(article()), messages: ['不可保存'] })).toThrow('字段');
  });
  test('联接目录越界也被拒绝', () => {
    const dir = article(); const outside = article(); fs.symlinkSync(outside, path.join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const s = setWorkflowArtifact(bootstrapWorkflowState(dir, 'full'), 'draft', 'linked/x.md');
    expect(() => saveWorkflowState(dir, s)).toThrow('越出');
  });
  test('成功平台状态需要真实结构结果且平台对应', () => {
    const s = bootstrapWorkflowState(article(), 'full');
    expect(() => setPlatformStatus(s, 'wechat', 'draft_saved')).toThrow('result-file');
    expect(() => setPlatformStatus(s, 'xhs', 'published')).toThrow('不匹配');
    expect(() => setPlatformStatus(s, 'douyin', 'published', operationResult('douyin', 'publish', 'published'))).toThrow('回执');
    const next = setPlatformStatus(s, 'wechat', 'manual_handoff', operationResult('wechat', 'prefill', 'manual_handoff'));
    expect(next.platforms.wechat.status).toBe('manual_handoff');
  });
  test('CLI 拒绝未知参数，show 不写状态', () => {
    const dir = article(); put(dir, '.just-write/workflow.json', JSON.stringify(legacy(dir))); const p = path.join(dir, '.just-write/workflow.json'); const raw = fs.readFileSync(p, 'utf8');
    const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {};
    try { expect(runCli(['show', dir])).toBe(0); expect(runCli(['show', dir, '--unknown'])).toBe(2); expect(runCli(['platform', dir, '--name', 'wechat', '--status', 'draft_saved'])).toBe(2); }
    finally { console.log = log; console.error = err; }
    expect(fs.readFileSync(p, 'utf8')).toBe(raw);
  });
});
