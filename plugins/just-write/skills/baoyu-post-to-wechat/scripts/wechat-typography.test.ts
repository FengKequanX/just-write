import { describe, expect, test } from "bun:test";
import { renderMarkdownDocument } from "baoyu-md";

import {
  applyWechatEditorialTypography,
  normalizeReferenceMarkdown,
  XHS_DEFAULT_ACCENT,
} from "./wechat-typography.ts";

describe("applyWechatEditorialTypography", () => {
  test("adds the editorial hierarchy as inline styles", () => {
    const html = `
      <body style="padding: 24px">
        <section class="container" style="font-size: 16px">
          <h2 class="h2" style="color: #fff; background: #0F4C81">章节标题</h2>
          <h3 class="h3">判断</h3>
          <p class="p">正文 <strong>重点</strong></p>
          <blockquote class="blockquote"><p class="p">引用内容</p></blockquote>
          <ul class="ul"><li class="listitem">• 列表项</li></ul>
        </section>
      </body>
    `;

    const result = applyWechatEditorialTypography(html, "#285680");

    expect(result).toContain("font-family: Songti SC, SimSun");
    expect(result).toContain("font-family: KaiTi, STKaiti");
    expect(result).toContain("margin: 1.5em 0");
    expect(result).toContain("font-size: 18px; font-weight: 700; line-height: 1.65");
    expect(result).toContain("border-left: 4px solid #285680");
    expect(result).toContain("background: transparent");
    expect(result).toContain("text-indent: -1.2em");
    expect(result).toContain("margin: 0; color: #4B5563");
    expect(result).toContain("rgba(40, 86, 128, 0.18)");
  });

  test("styles inline code without overriding fenced code content", () => {
    const html = `
      <code class="codespan" style="color: #d14">inline</code>
      <pre class="hljs code__pre" style="box-shadow: inset 0 0 10px #000">
        <code class="language-ts" style="color: #111">const value = 1;</code>
      </pre>
    `;

    const result = applyWechatEditorialTypography(html);
    const fencedCode = result.match(/<code class="language-ts"[^>]*>/)?.[0] ?? "";

    expect(result).toContain("class=\"codespan\"");
    expect(result).toContain("background: #F2EFE9");
    expect(result).toContain("class=\"hljs code__pre\"");
    expect(result).toContain("box-shadow: none");
    expect(fencedCode).not.toContain("background: #F2EFE9");
  });

  test("preserves self-closing tags while adding image styles", () => {
    const result = applyWechatEditorialTypography('<figure><img src="cover.png"/></figure>');

    expect(result).toContain('<img src="cover.png" style="');
    expect(result).toContain('border-radius: 8px; box-shadow:');
  });

  test("uses the carousel theme's warm paper and copper accent by default", () => {
    const result = applyWechatEditorialTypography("<body><section><h2>标题</h2><hr></section></body>");

    expect(result).toContain("background: #FBFAF7");
    expect(result).toContain("border-left: 4px solid #D4563F");
    expect(result).toContain("display: none; width: 0; height: 0; margin: 0; border: 0");
    expect(result).not.toContain("border-top: 2px solid #D4563F");
  });

  test("normalizes unnumbered source sections without inventing citation numbers", () => {
    const markdown = `正文没有引用编号。\n\n## 资料来源\n\n1. **官方公告：** [原文链接](https://example.com/news)`;
    const result = normalizeReferenceMarkdown(markdown);

    expect(result).toContain('- **官方公告：**[https://example.com/news](https://example.com/news)');
    expect(result).not.toContain('1. **官方公告');
  });

  test("keeps source numbers that correspond to original citation markers", () => {
    const markdown = `这项结论见原文[1]。\n\n## 引用链接\n\n1. 研究报告：[原文](https://example.com/report)`;
    const result = normalizeReferenceMarkdown(markdown);

    expect(result).toContain('1. 研究报告：[https://example.com/report](https://example.com/report)');
  });

  test("styles manual sources like generated citation links", () => {
    const html = `
      <section>
        <h2>资料来源</h2>
        <ul><li>• <strong>官方公告：</strong> <a href="https://example.com/news">原文链接</a></li></ul>
      </section>
    `;
    const result = applyWechatEditorialTypography(html);

    expect(result).toContain('font-size: 13px; line-height: 1.7; letter-spacing: 0');
    expect(result).toContain('font-weight: 400');
    expect(result).toContain('text-decoration: none');
    expect(result).toContain('<i style="word-break: break-all; color: inherit;');
    expect(result).toContain('>https://example.com/news</i>');
    expect(result).not.toContain('>• ');
  });

  test("keeps normalized sources out of duplicate generated footnotes", async () => {
    const markdown = normalizeReferenceMarkdown(
      `## 正文\n\n正文没有引用编号。\n\n## 资料来源\n\n1. 官方公告：[原文链接](https://example.com/news)`,
    );
    const rendered = await renderMarkdownDocument(markdown, {
      citeStatus: true,
      defaultTitle: "测试",
      keepTitle: false,
      primaryColor: XHS_DEFAULT_ACCENT,
      theme: "default",
    });
    const result = applyWechatEditorialTypography(rendered.html, rendered.style.primaryColor);

    expect(result).not.toContain("引用链接");
    expect(result).toContain(">https://example.com/news</i>");
    expect(result).toContain("font-size: 13px; line-height: 1.7; letter-spacing: 0");
    expect(result).not.toContain("text-decoration: underline");
  });
});
