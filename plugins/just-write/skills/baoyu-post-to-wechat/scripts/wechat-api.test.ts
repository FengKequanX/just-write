import { expect, test } from 'bun:test';
import { buildDraftArticle, compareDraftArticle, saveDraftWithVerification, uploadImagesInHtml, type ArticleOptions } from './wechat-api';
import { platformExitCode } from '../../../lib/platform-result';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const article: ArticleOptions = { title: '原标题', content: '<p>至少 3000 次观察，原因尚未确认。</p><img src="https://img.example/a?x=1"><img src="https://img.example/b">', thumbMediaId: 'cover-id', articleType: 'news' };
function response(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }

test('草稿创建只调用一次，读回验证标题正文、封面与图片顺序', async () => {
  const calls: string[] = [];
  const actual = { ...buildDraftArticle(article), content: '<section>至少 3000 次观察，原因尚未确认。</section><img src="https://img.example/a?x=1"><img src="https://img.example/b">' };
  const request = (async (url: string | URL | Request) => {
    calls.push(String(url)); return response(calls.length === 1 ? { media_id: 'draft-id' } : { news_item: [actual] });
  }) as typeof fetch;
  const result = await saveDraftWithVerification(article, 'test-token', { request, account: 'test' });
  expect(result.status).toBe('draft_saved'); expect(result.verification).toBe('verified');
  expect(result.receipt?.id).toBe('draft-id'); expect(platformExitCode(result)).toBe(0);
  expect(calls).toHaveLength(2); expect(calls.filter(url => url.includes('/draft/add'))).toHaveLength(1);
  expect(compareDraftArticle(buildDraftArticle(article), { ...actual, title: '新标题' })).toBe(false);
  expect(compareDraftArticle(buildDraftArticle(article), { ...actual, content: '<p>3000 次观察。</p>' })).toBe(false);
  expect(compareDraftArticle(buildDraftArticle(article), { ...actual, thumb_media_id: 'other' })).toBe(false);
  expect(compareDraftArticle(buildDraftArticle(article), { ...actual, content: actual.content.replace('example/a', 'example/c') })).toBe(false);
  expect(compareDraftArticle(buildDraftArticle(article), { ...actual, content: actual.content.replace('?x=1', '?x=2') })).toBe(false);
  const cdn = { ...buildDraftArticle(article), content: '<p>正文</p><img src="https://mmbiz.qpic.cn/mmbiz_png/fixture/0?wx_fmt=png&amp;from=appmsg">' };
  expect(compareDraftArticle(cdn, { ...cdn, content: '<p>正文</p><img src="https://mmbiz.qpic.cn/mmbiz_png/fixture/0?wx_fmt=webp">' })).toBe(true);
});

test('ID 已取得但读回失败或不一致，不再次创建并返回待核验', async () => {
  for (const readback of ['network', 'mismatch']) {
    let calls = 0;
    const request = (async () => {
      calls++;
      if (calls === 1) return response({ media_id: 'saved-id' });
      if (readback === 'network') throw new Error('mock');
      return response({ news_item: [{ ...buildDraftArticle(article), title: '不同标题' }] });
    }) as typeof fetch;
    const result = await saveDraftWithVerification(article, 'mock', { request });
    expect(result.status).toBe('draft_saved'); expect(result.receipt?.id).toBe('saved-id');
    expect(result.verification).toBe(readback === 'network' ? 'unverified' : 'mismatch');
    expect(platformExitCode(result)).toBe(3); expect(calls).toBe(2);
  }
});

test('明确拒绝和不确定提交分开；没有有效 ID 不宣布保存', async () => {
  const rejection = await saveDraftWithVerification(article, 'mock', { request: (async () => response({ errcode: 40001, errmsg: '拒绝' })) as typeof fetch });
  expect(rejection.status).toBe('failed'); expect(platformExitCode(rejection)).toBe(1);
  for (const value of [null, [], {}, { media_id: '' }, { media_id: 123 }, { media_id: {} }]) {
    const unknown = await saveDraftWithVerification(article, 'mock', { request: (async () => response(value)) as typeof fetch });
    expect(unknown.status).toBe('outcome_unknown'); expect(platformExitCode(unknown)).toBe(3);
  }
  const network = await saveDraftWithVerification(article, 'mock', { request: (async () => { throw new Error('包含凭证的URL不应回显'); }) as typeof fetch });
  expect(network.status).toBe('outcome_unknown'); expect(network.message).not.toContain('URL');
});

test('Markdown 离线预览无需凭证，使用本地 Bun，并保留源稿', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-offline-test-'));
  try {
    const configDir = path.join(root, '.baoyu-skills', 'baoyu-post-to-wechat');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'EXTEND.md'), 'default_theme: grace\naccounts:\n  - alias: a\n    name: 甲\n  - alias: b\n    name: 乙\n');
    const file = path.join(root, 'article.md');
    const source = '---\ntitle: 原标题\nsummary: 至少 3000 次观察，原因尚未确认。\ntheme: simple\n---\n\n正文与引语：“至少三次。”\n';
    fs.writeFileSync(file, source);
    const run = Bun.spawnSync({ cmd: [process.execPath, path.join(import.meta.dir, 'wechat-api.ts'), file, '--dry-run', '--json'], cwd: root, stdout: 'pipe', stderr: 'pipe' });
    expect(run.exitCode).toBe(0);
    const result = JSON.parse(run.stdout.toString());
    expect(result.result.status).toBe('dry_run'); expect(result.title).toBe('原标题');
    expect(result.accountSource).toBe('offline_unselected'); expect(result.digest).toContain('至少 3000');
    expect(fs.readFileSync(file, 'utf8')).toBe(source);
    const tooLong = Bun.spawnSync({ cmd: [process.execPath, path.join(import.meta.dir, 'wechat-api.ts'), file, '--dry-run', '--summary', '字'.repeat(121)], cwd: root, stdout: 'pipe', stderr: 'pipe' });
    expect(tooLong.exitCode).toBe(2); expect(tooLong.stderr.toString()).toContain('不自动截断');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('正文图片失败或缺少上传URL时停止，不能保存缺图草稿', async () => {
  let draftCreates = 0;
  const uploaded = async () => { throw new Error('模拟上传失败'); };
  const prepareThenSave = async () => {
    const prepared = await uploadImagesInHtml('<p>正文</p><img src="missing.png">', 'mock', '.', [], 'news', false, { upload: uploaded });
    draftCreates++;
    return prepared;
  };
  await expect(prepareThenSave()).rejects.toThrow('上传失败'); expect(draftCreates).toBe(0);
  await expect(uploadImagesInHtml('<p>IMAGE_PLACEHOLDER_1</p>', 'mock', '.', [{ placeholder: 'IMAGE_PLACEHOLDER_1', localPath: 'missing.png', originalPath: 'missing.png' }], 'news', false, { upload: uploaded })).rejects.toThrow('上传失败');
  await expect(uploadImagesInHtml('<img src="a.png">', 'mock', '.', [], 'news', false, { upload: async () => ({ media_id: 'id', url: '' }) })).rejects.toThrow('有效 URL');
  await expect(uploadImagesInHtml('<img src="a.png">', 'mock', '.', [], 'newspic', false, { upload: async () => ({ media_id: '', url: 'https://img.example/a' }) })).rejects.toThrow('有效 ID');
});

test('贴图素材保留已有微信图片与本地图片的完整顺序', async () => {
  const html = '<img src="https://mmbiz.qpic.cn/fixture/first"><img src="second.png">';
  const result = await uploadImagesInHtml(html, 'mock', '.', [], 'newspic', false, { upload: async (source, _token, _base, type) => ({ media_id: type === 'material' ? source.includes('first') ? 'first-id' : 'second-id' : '', url: 'https://mmbiz.qpic.cn/fixture/second' }) });
  expect(result.imageMediaIds).toEqual(['first-id', 'second-id']);
  expect(result.html).toContain('https://mmbiz.qpic.cn/fixture/first');
});
