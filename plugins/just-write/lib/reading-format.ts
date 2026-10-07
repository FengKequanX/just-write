/** 保留作者明确写出的换行，普通源文件折行交给页面自然排版。 */
export function preserveExplicitBreaks(markdown: string): string {
  return markdown.replace(
    /(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\2[^\n]*(?:\n|$)|(`+)[\s\S]*?\3(?!`)|<(?:pre|code)\b[^>]*>[\s\S]*?<\/(?:pre|code)>|<!--[\s\S]*?-->)|(?<=\S)(?: {2,}|\\)\r?\n|<br\b[^>]*>/gim,
    (match, protectedContent, _fence, _inline, offset, source) => {
      if (protectedContent) return match;
      if (/^<br\b/i.test(match)) {
        return match.replace(/\s*\/?>$/, ' data-jw-hard-break="true">');
      }
      if (match.startsWith('\\')) {
        const precedingSlashes = source.slice(0, offset).match(/\\+$/)?.[0].length || 0;
        if (precedingSlashes % 2 === 1) return match;
      }
      // 保留源换行，让引用前缀和列表续行缩进仍参与 Markdown 解析。
      return '<br data-jw-hard-break="true">' + (match.endsWith('\r\n') ? '\r\n' : '\n');
    },
  );
}

/** 兼容上游 breaks:true，同时保留引用来源和代码里的原始格式。 */
export function normalizeReadingBreaks(html: string): string {
  return html.replace(/<(p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (block, tag, attrs, content) => {
    if (/\bfootnotes\b/i.test(attrs)) return block;
    const normalized = content.replace(
      /<(pre|code)\b[^>]*>[\s\S]*?<\/\1>|<br\b[^>]*>/gi,
      (match: string) => {
        if (!/^<br\b/i.test(match)) return match;
        return /data-jw-hard-break/i.test(match)
          ? match.replace(/\sdata-jw-hard-break=["']true["']/i, '')
          : '\n';
      },
    );
    return `<${tag}${attrs}>${normalized}</${tag}>`;
  }).replace(/\sdata-jw-hard-break=["']true["']/gi, '');
}

/** 只提示阅读负担，不按字数或强调比例自动改写正文。 */
export function inspectReadingHtml(html: string): string[] {
  const warnings: string[] = [];
  for (const paragraph of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = paragraph[1]!.replace(/<[^>]*>/g, '').trim();
    if (!text) continue;
    const emphasized = [...paragraph[1]!.matchAll(/<(?:strong|mark)\b[^>]*>([\s\S]*?)<\/(?:strong|mark)>/gi)]
      .reduce((total, match) => total + match[1]!.replace(/<[^>]*>/g, '').length, 0);
    if (text.length > 220) warnings.push(`长段落需要检查分段位置：${text.slice(0, 28)}…`);
    if (text.length > 45 && emphasized / text.length > 0.65) {
      warnings.push(`大面积强调需要人工检查：${text.slice(0, 28)}…`);
    }
  }
  return [...new Set(warnings)];
}
