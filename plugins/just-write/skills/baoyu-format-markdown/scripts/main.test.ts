import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { formatMarkdown } from './main';
test('严格排版保留标题、未知元数据、数字、原话及代码实体', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-format-'));
  try {
    const p = path.join(dir, '稿.md'); const quote = '老师说：“这里不是把增益调大就行，而是先确认测量噪声。”';
    fs.writeFileSync(p, '---\ntitle: 标题原样\ncustom: 保留字段\n---\n# 标题原样\n\n截至周五，共有超过 3000 人登记。\n'+quote+'\n\n```text\nx = "&#x41;"\n```\n\n[来源](https://example.invalid/a?x=1&y=2)\n');
    expect(formatMarkdown(p, { spacing: false, quotes: false, emphasis: true }).success).toBe(true);
    const out = fs.readFileSync(p, 'utf8'); const fm = YAML.parse(out.match(/^---\n([\s\S]*?)\n---/)![1]!);
    expect(fm).toEqual({ title: '标题原样', custom: '保留字段' }); expect(out).toContain(quote); expect(out).toContain('超过 3000'); expect(out).toContain('x = "&#x41;"'); const tree = unified().use(remarkParse).parse(out); const links: string[] = []; const walk = (node: any) => { if (node.type === 'link') links.push(node.url); for (const child of node.children || []) walk(child); }; walk(tree); expect(links).toEqual(['https://example.invalid/a?x=1&y=2']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
