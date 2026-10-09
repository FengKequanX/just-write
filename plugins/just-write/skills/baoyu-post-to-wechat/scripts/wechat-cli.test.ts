import { expect, test } from 'bun:test';
import { ensureTitleAgreement, parseBrowserArgs } from './wechat-cli';
import { parseArgs } from './wechat-api';

test('浏览器默认不保存，兼容保存别名，未知和缺值参数失败', () => {
  expect(parseBrowserArgs(['--markdown', 'article.md'], 'article').submit).toBe(false);
  expect(parseBrowserArgs(['--markdown', 'article.md', '--save-draft'], 'article').submit).toBe(true);
  expect(parseBrowserArgs(['--submit'], 'image').submit).toBe(true);
  expect(() => parseBrowserArgs(['--title', '--save-draft'], 'article')).toThrow('缺少值');
  expect(() => parseBrowserArgs(['--ignored', 'x'], 'image')).toThrow('未知');
  expect(() => parseBrowserArgs(['--cdp-port', 'nan'], 'article')).toThrow('无效');
});
test('API 默认保存兼容，预览互斥，未提供主题时保留配置优先级', () => {
  expect(parseArgs(['article.md']).dryRun).toBe(false);
  expect(parseArgs(['article.md']).theme).toBeUndefined();
  expect(parseArgs(['article.md', '--save-draft']).saveDraft).toBe(true);
  expect(() => parseArgs(['article.md', '--dry-run', '--save-draft'])).toThrow('互斥');
  expect(() => parseArgs(['article.md', '--title', '--dry-run'])).toThrow('缺少值');
  expect(() => parseArgs(['article.md', '--ignored', 'x'])).toThrow('未知');
});
test('标题冲突需要明确选择，显式平台标题可以解决冲突', () => {
  expect(() => ensureTitleAgreement({ title: '甲', h1: '乙' })).toThrow('冲突');
  expect(() => ensureTitleAgreement({ title: '甲', h1: '乙' }, '甲')).not.toThrow();
});
