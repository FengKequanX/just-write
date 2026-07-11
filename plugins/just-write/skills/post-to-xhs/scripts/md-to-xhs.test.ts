import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCoverHtml,
  buildEndingHtml,
  commitGeneratedOutput,
  parseXhsArgs,
  resolveCoverImage,
  type RenderResult,
} from './md-to-xhs';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-output-'));
  roots.push(root);
  return root;
}

describe('XHS rendering contracts', () => {
  test('uses a balanced text-only cover class', () => {
    const html = buildCoverHtml('标题', '', '4 / 3', '作者', '', 1, 2, '', 1440);
    expect(html).toContain('cover cover--text-only');
  });

  test('uses imgs/cover-xhs.png instead of the WeChat cover', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'imgs'));
    fs.writeFileSync(path.join(root, 'imgs', 'cover.png'), 'wechat');
    fs.writeFileSync(path.join(root, 'imgs', 'cover-xhs.png'), 'xhs');
    const resolved = resolveCoverImage({}, root);
    expect(resolved).toContain('cover-xhs.png');
    expect(resolved).not.toMatch(/\/cover\.png$/);
  });

  test('never falls back to imgs/cover.png', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'imgs'));
    fs.writeFileSync(path.join(root, 'imgs', 'cover.png'), 'wechat');
    expect(resolveCoverImage({}, root)).toBe('');
  });

  test('allows an explicit xhsCoverImage override', () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'custom.png'), 'custom');
    expect(resolveCoverImage({ xhsCoverImage: 'custom.png' }, root)).toContain('custom.png');
  });

  test('uses the configured author in the ending CTA', () => {
    const html = buildEndingHtml([], '测试作者', '', 2, 2, '');
    expect(html).toContain('关注测试作者，期待下次见。');
    expect(html).not.toContain('关注炙青');
  });

  test('replaces stale generated pages but preserves unrelated files', () => {
    const root = tempRoot();
    const staging = path.join(root, 'staging');
    const output = path.join(root, 'xhs');
    fs.mkdirSync(staging);
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, '01-cover.png'), 'old');
    fs.writeFileSync(path.join(output, '99-content-stale.png'), 'old');
    fs.writeFileSync(path.join(output, 'notes.txt'), 'keep');
    const cover = path.join(staging, '01-cover.png');
    const ending = path.join(staging, '02-ending.png');
    const caption = path.join(staging, 'caption.md');
    fs.writeFileSync(cover, 'new');
    fs.writeFileSync(ending, 'new');
    fs.writeFileSync(caption, 'caption');
    const result: RenderResult = { images: [cover, ending], captionPath: caption, title: '标题', totalPages: 2 };

    const committed = commitGeneratedOutput(result, staging, output);
    expect(fs.existsSync(path.join(output, '99-content-stale.png'))).toBe(false);
    expect(fs.readFileSync(path.join(output, '01-cover.png'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(output, 'notes.txt'))).toBe(true);
    expect(committed.images.map((file) => path.basename(file))).toEqual(['01-cover.png', '02-ending.png']);
  });

  test('CLI values override loaded configuration', () => {
    const options = parseXhsArgs(['article.md', '--aspect', '1:1', '--author', 'CLI作者'], {
      enabled: true,
      default_author: '配置作者',
      default_theme: 'default',
      default_aspect: '9:16',
      default_topic_tags: '配置标签',
    });
    expect(options).toMatchObject({
      markdownPath: 'article.md', aspect: '1:1', author: 'CLI作者', tags: '配置标签',
    });
  });
});
