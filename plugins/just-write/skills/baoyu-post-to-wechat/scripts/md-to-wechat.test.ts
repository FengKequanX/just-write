import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertMarkdown } from './md-to-wechat.ts';
import { createWechatPreview } from './wechat-preview.ts';

describe('公众号实际 Markdown 转换', () => {
  test('普通折行自然排版，显式换行与段落、重点、代码保持完整', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-reading-'));
    let renderedPath: string | undefined;
    try {
      const markdownPath = path.join(root, 'article.md');
      fs.writeFileSync(markdownPath, '---\ntitle: 标题保持原样\n---\n\n## 阅读测试\n\n普通折行\n继续同段。\n\n显式空格换行  \n继续下一行。\n\n显式反斜线换行\\\n继续下一行。\n\n原始 HTML<br>继续下一行。\n\n> 引用第一行  \n> 引用第二行。\n\n- 列表第一行  \n  列表第二行。\n\n**核心结论**和<mark>主动高亮</mark>。\n\n```text\n第一行\n第二行\n```\n');
      const result = await convertMarkdown(markdownPath);
      renderedPath = result.htmlPath;
      const html = fs.readFileSync(result.htmlPath, 'utf8');
      expect(result.title).toBe('标题保持原样');
      expect(html).toContain('阅读测试');
      const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(match => match[1]!);
      expect(paragraphs.find(text => text.includes('普通折行'))).not.toMatch(/<br\b/);
      for (const prefix of ['显式空格换行', '显式反斜线换行', '原始 HTML']) {
        expect(paragraphs.find(text => text.includes(prefix))).toMatch(/<br\b/);
      }
      expect(html).not.toContain('data-jw-hard-break');
      expect(html.match(/<strong\b[^>]*>/)?.[0]).toContain('background: none');
      expect(html).toContain('核心结论');
      expect(html).toContain('主动高亮');
      expect(html).toContain('第一行');
      expect(html).toContain('第二行');
      expect(html).toMatch(/引用第一行[\s\S]*?<br[^>]*>\s*引用第二行/);
      expect(html).toMatch(/列表第一行[\s\S]*?<br[^>]*>\s*列表第二行/);
      expect(result.readingWarnings).toEqual([]);
    } finally {
      // 只移除此测试自己创建的临时目录。
      fs.rmSync(root, { recursive: true, force: true });
      if (renderedPath) fs.rmSync(path.dirname(renderedPath), { recursive: true, force: true });
    }
  });

  test('移除重复的正文文章标题，但保留第一节及后续章节标题', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-heading-test-'));
    let renderedPath: string | undefined;
    try {
      const markdownPath = path.join(root, 'article.md');
      fs.writeFileSync(markdownPath, '# 文章标题\n\n开头正文。\n\n## 第一节标题\n\n第一节内容。\n\n### 子节标题\n\n子节内容。');
      const result = await convertMarkdown(markdownPath);
      renderedPath = result.htmlPath;
      const html = fs.readFileSync(renderedPath, 'utf8');
      expect(result.title).toBe('文章标题');
      expect(html).not.toMatch(/<h1\b/);
      expect(html).toContain('第一节标题');
      expect(html).toContain('子节标题');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      if (renderedPath) fs.rmSync(path.dirname(renderedPath), { recursive: true, force: true });
    }
  });

  test('离线预览替换真实图片，复制资源并支持手机宽度，不覆盖原稿', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-preview-test-'));
    try {
      const markdownPath = path.join(root, 'article.md');
      const outputPath = path.join(root, 'preview.html');
      fs.writeFileSync(path.join(root, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="white"/></svg>');
      const source = '---\ntitle: 图片预览\n---\n\n正文。\n\n![完整截图](image.svg)\n';
      fs.writeFileSync(markdownPath, source);
      const result = await createWechatPreview(markdownPath, outputPath);
      const html = fs.readFileSync(result.previewPath, 'utf8');
      expect(html).not.toContain('WECHATIMGPH_');
      expect(html).toContain('preview.assets/image-1.svg');
      expect(html).toContain('height: auto');
      expect(html).toContain('data-width="360"');
      expect(fs.readFileSync(path.join(root, 'preview.assets', 'image-1.svg'), 'utf8')).toContain('height="1200"');
      await expect(createWechatPreview(markdownPath, markdownPath)).rejects.toThrow('不能覆盖文章原稿');
      expect(fs.readFileSync(markdownPath, 'utf8')).toBe(source);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
