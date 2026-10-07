import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCoverHtml,
  buildEndingHtml,
  CarouselLimitError,
  commitGeneratedOutput,
  generateCaption,
  normalizeStrongAdjacency,
  parseXhsArgs,
  render,
  resolveCaptionTopics,
  resolveCoverImage,
  type RenderResult,
  type CarouselReport,
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

  test('keeps image covers focused on the image and title', () => {
    const html = buildCoverHtml('较长的封面标题', 'cover.png', '4 / 3', '作者', '', 1, 2, '', 1440, '摘要');
    expect(html).toContain('cover cover--with-image');
    expect(html).toContain('<div class="title">较长的封面标题</div>');
    expect(html).not.toContain('class="subtitle"');
    expect(html).toContain("const gapKeys = ['topPadding', 'bottomPadding', 'imageGap', 'titleGap', 'subtitleGap', 'footerGap']");
    expect(html).toContain("const fontKeys = ['titleSize', 'subtitleSize']");
    expect(html).toContain("root.dataset.coverOverflow = overflows() ? 'true' : 'false'");
  });

  test('uses equal cover side padding and natural title wrapping', () => {
    const css = fs.readFileSync(path.join(import.meta.dir, '..', 'themes', 'default', 'style.css'), 'utf8');
    const titleRule = css.match(/\.cover \.title\s*\{([\s\S]*?)\}/)?.[1] || '';
    expect(css).toContain('padding: var(--cover-top-padding) 72px var(--cover-bottom-padding)');
    expect(titleRule).toContain('font-family: "Noto Serif SC"');
    expect(titleRule).toContain('font-weight: 700');
    expect(titleRule).toContain('text-wrap: wrap');
    expect(titleRule).not.toContain('text-wrap: balance');
  });

  test('separates bold delimiters from immediately following Chinese invisibly', () => {
    const source = '**关键结论。**后文紧接中文';
    const normalized = normalizeStrongAdjacency(source);
    expect(normalized).toBe('**关键结论。**<!-- -->后文紧接中文');
    expect(normalized).not.toContain('**关键结论。** 后文');
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
    fs.writeFileSync(path.join(output, 'preview.html'), 'stale preview');
    const cover = path.join(staging, '01-cover.png');
    const ending = path.join(staging, '02-ending.png');
    const caption = path.join(staging, 'caption.md');
    fs.writeFileSync(cover, 'new');
    fs.writeFileSync(ending, 'new');
    fs.writeFileSync(caption, 'caption');
    const result: RenderResult = { images: [cover, ending], captionPath: caption, title: '标题', topics: [], totalPages: 2 };

    const committed = commitGeneratedOutput(result, staging, output);
    expect(fs.existsSync(path.join(output, '99-content-stale.png'))).toBe(false);
    expect(fs.readFileSync(path.join(output, '01-cover.png'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(output, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(path.join(output, 'preview.html'))).toBe(false);
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

  test('uses only article-specific topics when they are provided', () => {
    const topics = resolveCaptionTopics(
      '英伟达要让 5000 亿美元涌向 AI 工厂',
      '正文同时提到了 OpenAI、融资、开发者和代码。',
      { description: '乌兰察布把绿电转化为可出售的算力。' },
      'AI工厂,乌兰察布,算力产业,基础设施投资,AI工厂,',
    );
    const caption = generateCaption('标题', '作者', {}, topics);

    expect(topics).toEqual(['AI工厂', '乌兰察布', '算力产业', '基础设施投资']);
    expect(caption).toContain('#AI工厂 #乌兰察布 #算力产业 #基础设施投资');
    expect(caption).not.toContain('#OpenAI');
    expect(caption).not.toContain('#编程');
    expect(caption).not.toContain('#融资');
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
    expect(result.totalPages).toBeLessThanOrEqual(18);
    expect(path.basename(result.images.at(-1)!)).toMatch(/-content-/);
  }, 120_000);

  test('renders the same short article in every supported aspect', async () => {
    const root = tempRoot();
    const article = writeArticle(root, `# 分页压力测试

## 正文

短文章应在所有受支持的画布比例中稳定生成，正文读完即结束。
`);

    for (const aspect of ['3:4', '9:16', '1:1', '4:3']) {
      const output = path.join(root, aspect.replace(':', '-'));
      const result = await render(article, output, 'default', aspect, '测试作者', '');
      expect(result.totalPages).toBe(2);
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

  test('超过 18 张时不生成 PNG，并保留已有轮播和无关文件', async () => {
    const root = tempRoot();
    const article = writeArticle(root, Array.from({ length: 20 }, (_, i) => `<div style="height:1200px">完整内容 ${i + 1}</div>`).join('\n\n'));
    const output = path.join(root, 'xhs');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, '01-cover.png'), '已有封面');
    fs.writeFileSync(path.join(output, 'notes.txt'), '无关文件');
    try {
      await render(article, output, 'default', '3:4', '作者', '');
      throw new Error('超限应拒绝生成');
    } catch (error) {
      expect(error).toBeInstanceOf(CarouselLimitError);
      expect((error as CarouselLimitError).neededImages).toBeGreaterThan(18);
    }
    expect(fs.readdirSync(output).sort()).toEqual(['01-cover.png', 'notes.txt']);
    expect(fs.readFileSync(path.join(output, '01-cover.png'), 'utf8')).toBe('已有封面');
  }, 30_000);

  test('短列表项放不下时整体换页，不能把一两个字单独留在续页', async () => {
    const root = tempRoot();
    const article = writeArticle(root, `<div style="height:1230px">前页内容</div>\n\n- ${'短列表项应完整阅读，'.repeat(4)}\n\n后续正文自然跟随。`);
    const result = await render(article, path.join(root, 'xhs'), 'default', '3:4', '作者', '');
    const report = JSON.parse(fs.readFileSync(result.reportPath!, 'utf8')) as CarouselReport;
    const bodyPages = report.pages.filter(page => page.type === 'content');
    expect(bodyPages).toHaveLength(2);
    expect(bodyPages[0]!.metrics!.blockKinds).toEqual(['other']);
    expect(bodyPages[1]!.metrics!.blockKinds).toEqual(['list-item', 'paragraph']);
  }, 30_000);

  test('连续父子标题与后续短段落一起换页，不能让父标题孤立在页尾', async () => {
    const root = tempRoot();
    const article = writeArticle(root, `<div style="height:1050px">前页内容</div>\n\n## 父章节\n\n### 子章节\n\n${'标题后的短段落需要完整保留。'.repeat(3)}`);
    const result = await render(article, path.join(root, 'xhs'), 'default', '3:4', '作者', '');
    const report = JSON.parse(fs.readFileSync(result.reportPath!, 'utf8')) as CarouselReport;
    const bodyPages = report.pages.filter(page => page.type === 'content');
    expect(bodyPages).toHaveLength(2);
    expect(bodyPages[0]!.metrics!.blockKinds).toEqual(['other']);
    expect(bodyPages[1]!.metrics!.blockKinds).toEqual(['heading', 'heading', 'paragraph']);
    expect(report.textPreserved).toBe(true);
  }, 60_000);

  test('图片从正文剩余空间自然翻页，竖图和长图保持整宽及连续覆盖', async () => {
    const root = tempRoot();
    const image = (height: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}"><rect width="600" height="${height}" fill="white"/>${Array.from({ length: Math.floor(height / 80) }, (_, index) => `<text x="24" y="${index * 80 + 40}" font-size="28">截图内容 ${index + 1} · 保留整行文字</text>`).join('')}</svg>`;
    fs.writeFileSync(path.join(root, 'portrait.svg'), image(900));
    fs.writeFileSync(path.join(root, 'long.svg'), image(3000));
    // PNG 封面覆盖无头浏览器 decode() 等待不返回的回归场景。
    fs.mkdirSync(path.join(root, 'imgs'));
    fs.writeFileSync(path.join(root, 'imgs', 'cover-xhs.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const article = writeArticle(root, `## 竖图\n\n这段短文字必须与后面的图片连续排版，不能单独一页。\n\n![竖图](portrait.svg)\n\n## 长图\n\n![长图](long.svg)\n\n*原图说明保持在最后一段图片旁边。*\n\n## 后文\n\n图片之后的正文仍然完整。`);
    const result = await render(article, path.join(root, 'xhs'), 'default', '3:4', '作者', '排版,图片');
    const report = JSON.parse(fs.readFileSync(result.reportPath!, 'utf8')) as CarouselReport;
    const images = report.pages.flatMap((page) => page.metrics?.images || []);
    expect(report.textPreserved).toBe(true);
    expect(report.imageOrderPreserved).toBe(true);
    expect(report.pages.every((page) => page.layoutChecked)).toBe(true);
    expect(images[0]!.mode).toBe('split');
    expect(images[0]!.displayWidth).toBeCloseTo(report.contentWidth, 1);
    const bodyPages = report.pages.filter(page => page.type === 'content');
    expect(bodyPages[0]!.metrics!.blockKinds).toContain('paragraph');
    expect(bodyPages[0]!.metrics!.images[0]!.sourceIndex).toBe(1);
    expect(bodyPages.slice(0, -1).every(page => page.metrics!.occupancy > 0.75)).toBe(true);
    expect(report.maxImages).toBe(18);
    expect(result.totalPages).toBeLessThanOrEqual(18);
    const slices = images.filter((img) => img.sourceIndex === 2);
    expect(slices.length).toBeGreaterThan(1);
    expect(slices[0]!.sliceStart).toBe(0);
    expect(slices.at(-1)!.sliceEnd).toBeCloseTo(3000, 2);
    for (let index = 0; index < slices.length; index++) {
      expect(slices[index]!.displayWidth).toBeCloseTo(report.contentWidth, 1);
      if (index) {
        expect(slices[index]!.sliceStart).toBeLessThanOrEqual(slices[index - 1]!.sliceEnd);
        expect(slices[index]!.sliceEnd).toBeGreaterThan(slices[index - 1]!.sliceEnd);
      }
    }
    expect(report.pages.every((page) => !page.metrics || page.metrics.height <= report.availableHeight + 0.5)).toBe(true);
    const preview = fs.readFileSync(result.previewPath!, 'utf8');
    expect(preview).toContain(path.basename(result.images[0]!));
    expect(preview).not.toContain(root);
    expect(preview).toContain('手机 360px');
  }, 60_000);
});
