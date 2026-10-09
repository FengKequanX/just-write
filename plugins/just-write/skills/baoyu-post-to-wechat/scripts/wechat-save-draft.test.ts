import { expect, test } from 'bun:test';
import { finishBrowserDraft } from './wechat-save-draft';
import { postToWeChat } from './wechat-browser';
import { postArticle } from './wechat-article';

test('未传保存开关不点击或读取保存界面', async () => {
  let calls = 0;
  const result = await finishBrowserDraft(false, { evaluate: async () => { calls++; throw new Error('不应调用'); } });
  expect(result.status).toBe('manual_handoff'); expect(calls).toBe(0);
});
test('浏览器超限直接失败，不截断后继续调用平台', async () => {
  await expect(postToWeChat({ title: '字'.repeat(21), content: '正文', images: [] })).rejects.toThrow('不自动压缩');
  await expect(postToWeChat({ title: '标题', content: '字'.repeat(1001), images: [] })).rejects.toThrow('不自动截断');
  await expect(postArticle({ title: '标题', content: '正文', summary: '字'.repeat(121) })).rejects.toThrow('120');
});
test('明确新保存提示、拒绝、普通 toast、缺按钮和旧提示分开处理', async () => {
  async function save(values: unknown[]) { return finishBrowserDraft(true, { evaluate: async () => values.shift(), wait: async () => {} }); }
  expect((await save(['[]', 'clicked', '["保存成功"]'])).status).toBe('draft_saved');
  expect((await save(['[]', 'clicked', '["保存失败"]'])).status).toBe('failed');
  expect((await save(['[]', 'clicked', '["正在加载"]'])).status).toBe('outcome_unknown');
  expect((await save(['[]', 'not_found'])).status).toBe('outcome_unknown');
  expect((await save(['["保存成功"]', 'clicked', '["保存成功"]'])).status).toBe('outcome_unknown');
});
