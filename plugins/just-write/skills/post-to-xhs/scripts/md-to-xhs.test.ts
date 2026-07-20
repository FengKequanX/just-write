import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCoverHtml,
  buildEndingHtml,
  commitGeneratedOutput,
  parseXhsArgs,
  render,
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

function writeArticle(root: string, body: string): string {
  const article = path.join(root, 'article.md');
  fs.writeFileSync(article, `---\ntitle: 分页压力测试\nauthor: 测试作者\n---\n\n${body}`, 'utf8');
  return article;
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

  test('paginates nested structures, long prose, code, and tables without clipping', async () => {
    const root = tempRoot();
    const prose = '这是一段用于验证中文分页、英文 pagination 和长链接 https://example.com/some/really/long/path 的正文。';
    const code = Array.from({ length: 24 }, (_, index) => `const value${index} = "line-${index}";`).join('\n');
    const rows = Array.from({ length: 16 }, (_, index) => `| ${index + 1} | 第 ${index + 1} 行表格内容 |`).join('\n');
    fs.writeFileSync(path.join(root, 'wide.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><rect width="1200" height="400" fill="#ddd"/></svg>');
    fs.writeFileSync(path.join(root, 'tall.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1200"><rect width="400" height="1200" fill="#ccc"/></svg>');
    const article = writeArticle(root, `# 分页压力测试

## 长段落

${Array.from({ length: 28 }, () => prose).join('')}

## 嵌套内容

> 第一段引用包含 **强调内容**。
>
> - 引用中的列表一
> - 引用中的列表二

1. 第一项
2. 第二项包含较长的说明文字，用于验证有序列表分页后仍然保持正确编号。
3. 第三项

## 图片

![横图](wide.svg)

![竖图](tall.svg)

## 代码

\`\`\`ts
${code}
\`\`\`

## 表格

| 序号 | 内容 |
| --- | --- |
${rows}
`);
    const output = path.join(root, 'xhs');

    const result = await render(article, output, 'default', '1:1', '测试作者', '分页,测试');

    expect(result.totalPages).toBeGreaterThan(4);
    expect(result.images.every((image) => fs.existsSync(image))).toBe(true);
    expect(path.basename(result.images[0]!)).toBe('01-cover.png');
    expect(path.basename(result.images.at(-1)!)).toMatch(/-ending\.png$/);
  }, 60_000);

  test('renders the same short article in every supported aspect', async () => {
    const root = tempRoot();
    const article = writeArticle(root, `# 分页压力测试

## 正文

短文章也应在所有受支持的画布比例中稳定生成，且保持封面、正文和结束页结构。
`);

    for (const aspect of ['3:4', '9:16', '1:1', '4:3']) {
      const output = path.join(root, aspect.replace(':', '-'));
      const result = await render(article, output, 'default', aspect, '测试作者', '');
      expect(result.totalPages).toBe(3);
    }
  }, 60_000);

  test('rejects an unsplittable oversized block instead of writing clipped pages', async () => {
    const root = tempRoot();
    const article = writeArticle(root, `# 分页压力测试

<div style="height: 5000px">不可安全拆分的内容</div>
`);
    const output = path.join(root, 'xhs');

    await expect(render(article, output, 'default', '3:4', '测试作者', '')).rejects.toThrow(
      /Pagination failed: cannot safely split other block/,
    );
    expect(fs.readdirSync(output)).toEqual([]);
  }, 30_000);
});
