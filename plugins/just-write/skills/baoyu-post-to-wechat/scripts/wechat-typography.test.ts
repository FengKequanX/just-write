import { describe, expect, test } from "bun:test";

import { applyWechatEditorialTypography } from "./wechat-typography.ts";

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
    expect(result).toContain("border-top: 2px solid #D4563F");
  });
});
