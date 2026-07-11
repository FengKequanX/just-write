import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  advanceWorkflow,
  bootstrapWorkflowState,
  findMissingArtifacts,
  loadOrBootstrapWorkflowState,
  loadWorkflowState,
  saveWorkflowState,
  setPlatformStatus,
  setWorkflowArtifact,
  setWorkflowTitle,
} from './workflow-state';

const roots: string[] = [];

function tempArticle(name = '测试文章'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'just-write-state-'));
  roots.push(root);
  const article = path.join(root, name);
  fs.mkdirSync(article);
  return article;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('workflow state', () => {
  test('bootstraps and resumes an existing formatted article', () => {
    const article = tempArticle();
    fs.writeFileSync(path.join(article, '测试文章.md'), '# 测试文章\n\n正文');
    fs.writeFileSync(path.join(article, '测试文章-formatted.md'), '---\ntitle: 测试文章\n---\n# 测试文章');

    const state = bootstrapWorkflowState(article, 'full');
    expect(state.currentStage).toBe('assets');
    expect(state.titles.article).toEqual({ value: '测试文章', locked: true });
    expect(state.artifacts.formatted).toBe('测试文章-formatted.md');

    saveWorkflowState(article, state);
    expect(loadWorkflowState(article)).toMatchObject({ mode: 'full', currentStage: 'assets' });
    expect(loadOrBootstrapWorkflowState(article, 'xhs_materials').mode).toBe('xhs_materials');
  });

  test('refuses ambiguous files and conflicting titles', () => {
    const multiple = tempArticle('multiple');
    fs.writeFileSync(path.join(multiple, 'a.md'), '# A');
    fs.writeFileSync(path.join(multiple, 'b.md'), '# B');
    expect(() => bootstrapWorkflowState(multiple, 'polish')).toThrow('Multiple draft markdown');

    const conflict = tempArticle('conflict');
    fs.writeFileSync(path.join(conflict, 'a.md'), '# A');
    fs.writeFileSync(path.join(conflict, 'a-formatted.md'), '---\ntitle: B\n---\n# B');
    expect(() => bootstrapWorkflowState(conflict, 'format')).toThrow('Conflicting article titles');
  });

  test('advances only when explicitly saved and reports artifact drift', () => {
    const article = tempArticle();
    fs.writeFileSync(path.join(article, '测试文章.md'), '# 测试文章');
    const initial = bootstrapWorkflowState(article, 'full');
    saveWorkflowState(article, initial);

    const advanced = setPlatformStatus(advanceWorkflow(initial, 'publish', 'assets'), 'wechat', 'ready');
    expect(loadWorkflowState(article)?.currentStage).toBe('polish');
    saveWorkflowState(article, advanced);
    expect(loadWorkflowState(article)?.platforms.wechat).toBe('ready');

    fs.unlinkSync(path.join(article, '测试文章.md'));
    expect(findMissingArtifacts(article, advanced)).toEqual(['测试文章.md']);
  });

  test('records independent article and Douyin titles and safe relative artifacts', () => {
    const article = tempArticle();
    let state = bootstrapWorkflowState(article, 'douyin_sync');
    state = setWorkflowTitle(state, 'article', '文章长标题', true);
    state = setWorkflowTitle(state, 'douyin', '抖音短标题', true);
    state = setWorkflowArtifact(state, 'xhsDir', 'xhs');
    expect(state.titles.article.value).toBe('文章长标题');
    expect(state.titles.douyin?.value).toBe('抖音短标题');
    expect(() => setWorkflowArtifact(state, 'draft', '../outside.md')).toThrow('relative');
  });
});
