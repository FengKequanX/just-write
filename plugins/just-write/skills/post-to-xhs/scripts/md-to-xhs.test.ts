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
  main,
  normalizeStrongAdjacency,
  parseXhsArgs,
  render,
  resolveCaptionTopics,
  resolveCoverImage,
  type RenderResult,
  type CarouselReport,
} from './md-to-xhs';
import { DEFAULT_XHS_CONFIG } from './xhs-config';
import { validatePlatformResult } from '../../../lib/platform-result';

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
  test('独立配文及显式空配文优先摘要，不改变标题和话题', () => {
    const fm = { description: '旧摘要', summary: '备用摘要' };
    expect(generateCaption('原标题', '作者', fm, ['主题'], '独立正文')).toContain('独立正文');
    expect(generateCaption('原标题', '作者', fm, ['主题'], '')).not.toContain('旧摘要');
    expect(generateCaption('原标题', '作者', fm, ['主题'])).toContain('旧摘要');
    expect(generateCaption('原标题', '作者', fm, ['主题'], '')).toContain('原标题');
    expect(generateCaption('原标题', '作者', fm, ['主题'], '')).toContain('#主题');
  });
  test('JSON 生成结果可登记，显式配文在提交前写入且源稿不变', async () => {
    const root = tempRoot();
    const article = writeArticle(root, '正文保持原样。');
    const original = fs.readFileSync(article);
    const bodyFile = path.join(root, 'caption-body.txt');
    const output = path.join(root, 'xhs');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => { stdout.push(values.join(' ')); };
    console.error = (...values) => { stderr.push(values.join(' ')); };
    try {
      for (const body of ['独立配文', '']) {
        stdout.length = 0;
        fs.writeFileSync(bodyFile, body, 'utf8');
        const exitCode = await main([article, '--out', output, '--caption-body-file', bodyFile, '--json'], {
          loadConfig: () => ({ config: DEFAULT_XHS_CONFIG, source: '测试配置' }),
          render: async (_source, staging, _theme, _aspect, _author, _tags, captionBody) => {
            expect(captionBody).toBe(body);
            fs.mkdirSync(staging, { recursive: true });
            const images = [path.join(staging, '01-cover.png')];
            const captionPath = path.join(staging, 'caption.md');
            const reportPath = path.join(staging, 'render-report.json');
            const previewPath = path.join(staging, 'preview.html');
            fs.writeFileSync(images[0]!, '模拟图片');
            fs.writeFileSync(captionPath, generateCaption('原标题', '作者', { description: '旧摘要' }, [], captionBody));
            fs.writeFileSync(reportPath, JSON.stringify({ warnings: [] }));
            fs.writeFileSync(previewPath, '<html></html>');
            return { images, captionPath, reportPath, previewPath, title: '原标题', topics: [], totalPages: 1 };
          },
        });
        expect(exitCode).toBe(0);
        expect(stdout).toHaveLength(1);
        const parsed = JSON.parse(stdout[0]!);
        validatePlatformResult(parsed.result);
        expect(parsed.result).toMatchObject({ platform: 'xhs', action: 'generate', status: 'generated', verification: 'not_required' });
        expect(parsed.images).toEqual([path.join(output, '01-cover.png')]);
        const caption = fs.readFileSync(parsed.captionPath, 'utf8');
        expect(caption).not.toContain('旧摘要');
        if (body) expect(caption).toContain(body);
        expect(fs.readFileSync(article)).toEqual(original);
        expect(fs.readdirSync(root).filter(name => name.startsWith('xhs.tmp-'))).toEqual([]);
      }
      expect(stderr.join('\n')).toContain('[md-to-xhs]');
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
  test('参数错误不渲染，超限返回业务失败并保留旧产物', async () => {
    const root = tempRoot();
    const article = writeArticle(root, '正文。');
    const output = path.join(root, 'xhs');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, '01-cover.png'), '旧产物');
    let calls = 0;
    const stdout: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => { stdout.push(values.join(' ')); };
    console.error = () => {};
    try {
      const dependencies = {
        loadConfig: () => ({ config: DEFAULT_XHS_CONFIG, source: '测试配置' }),
        render: async (_source: string, staging: string) => {
          calls++;
          fs.mkdirSync(staging, { recursive: true });
          fs.writeFileSync(path.join(staging, '临时文件'), '待清理');
          throw new CarouselLimitError(19, []);
        },
      };
      expect(await main([article, '--unknown', '--json'], dependencies)).toBe(2);
      expect(calls).toBe(0);
      expect(await main([article, '--out', output, '--json'], dependencies)).toBe(1);
      expect(calls).toBe(1);
      for (const line of stdout) {
        const parsed = JSON.parse(line);
        validatePlatformResult(parsed.result);
        expect(parsed.result.status).toBe('failed');
      }
      expect(fs.readFileSync(path.join(output, '01-cover.png'), 'utf8')).toBe('旧产物');
      expect(fs.readdirSync(root).filter(name => name.startsWith('xhs.tmp-'))).toEqual([]);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
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
    const options = parseXhsArgs(['article.md', '--aspect', '1:1', '--author', 'CLI作者', '--caption-body-file', 'body.txt'], {
      enabled: true,
      default_author: '配置作者',
      default_theme: 'default',
      default_aspect: '9:16',
      default_topic_tags: '配置标签',
    });
    expect(options).toMatchObject({
      markdownPath: 'article.md', aspect: '1:1', author: 'CLI作者', tags: '配置标签', captionBodyFile: 'body.txt',
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

});
