import { describe, expect, test } from 'bun:test';
import { inspectReadingHtml, normalizeReadingBreaks, preserveExplicitBreaks } from './reading-format';

describe('阅读格式', () => {
  test('普通折行不变成强制换行，明确换行仍然保留', () => {
    const markdown = '普通折行。\n继续阅读。\n\n明确换行。  \n下一行。\n反斜线换行。\\\n再一行。';
    const prepared = preserveExplicitBreaks(markdown);
    expect(prepared).toContain('普通折行。\n继续阅读。');
    expect(prepared.match(/data-jw-hard-break/g)?.length).toBe(2);
    const result = normalizeReadingBreaks('<p>普通折行。<br>继续阅读。<br data-jw-hard-break="true">明确换行。</p>');
    expect(result).toBe('<p>普通折行。\n继续阅读。<br>明确换行。</p>');
  });

  test('代码、显式 HTML 换行和引用来源保持格式', () => {
    const code = '```text\n保留代码尾部空格。  \n下一行。\n```\n';
    expect(preserveExplicitBreaks(code)).toBe(code);
    expect(preserveExplicitBreaks('`代码  \n继续`')).toBe('`代码  \n继续`');
    expect(normalizeReadingBreaks('<p class="footnotes">来源一<br>来源二</p>')).toContain('来源一<br>来源二');
    expect(normalizeReadingBreaks(preserveExplicitBreaks('<p>地址<br/>下一行</p>'))).toBe('<p>地址<br>下一行</p>');
    expect(preserveExplicitBreaks('保留转义反斜线\\\\\n继续')).toBe('保留转义反斜线\\\\\n继续');
    expect(preserveExplicitBreaks('> 引用  \n> 续行')).toContain('<br data-jw-hard-break="true">\n> 续行');
  });

  test('提示大面积强调，不改变原文', () => {
    const html = `<p><strong>${'重要内容。'.repeat(14)}</strong></p>`;
    expect(inspectReadingHtml(html)).toHaveLength(1);
    expect(inspectReadingHtml('<p>正文中的<strong>一个重点</strong>，接着解释。</p>')).toHaveLength(0);
  });
});
