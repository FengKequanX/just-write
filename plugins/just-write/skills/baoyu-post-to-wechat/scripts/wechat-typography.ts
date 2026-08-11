const PAPER = "#FBFAF7";
const PAPER_WARM = "#F2EFE9";
const INK = "#17171B";
const BODY_TEXT = "#202124";
const MUTED = "#4B5563";
const LIGHT_TEXT = "#8A8178";
const ACCENT_WASH = "#FFF8F4";
const LINE = "#E6E0D7";

export const XHS_DEFAULT_ACCENT = "#D4563F";

function colorWithAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
  if (!hex) return "rgba(212, 86, 63, 0.18)";

  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${channels.join(", ")}, ${alpha})`;
}

function appendInlineStyle(openingTag: string, style: string): string {
  const styleAttribute = /\sstyle=(["'])([\s\S]*?)\1/i;

  if (styleAttribute.test(openingTag)) {
    return openingTag.replace(styleAttribute, (_match, quote: string, current: string) => {
      const existing = current.trim().replace(/;?$/, ";");
      return ` style=${quote}${existing} ${style}${quote}`;
    });
  }

  return openingTag.replace(/\/?>$/, (closing) => ` style="${style}"${closing}`);
}

function styleTags(html: string, tagName: string, style: string): string {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return html.replace(pattern, (openingTag) => appendInlineStyle(openingTag, style));
}

function styleClass(html: string, tagName: string, className: string, style: string): string {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const classPattern = new RegExp(`\\bclass=["'][^"']*\\b${className}\\b[^"']*["']`, "i");

  return html.replace(pattern, (openingTag) => (
    classPattern.test(openingTag) ? appendInlineStyle(openingTag, style) : openingTag
  ));
}

function styleBlockChildren(
  html: string,
  blockTag: string,
  childTag: string,
  style: string,
): string {
  const pattern = new RegExp(`<${blockTag}\\b[^>]*>[\\s\\S]*?<\/${blockTag}>`, "gi");
  return html.replace(pattern, (block) => styleTags(block, childTag, style));
}

const REFERENCE_HEADING = /^(?:引用链接|资料来源|参考资料|参考来源|参考链接|references?|sources?)[:：]?$/i;
const REFERENCE_LINE_STYLE = `margin: 0.6em 0; padding: 0; color: ${MUTED}; font-size: 13px; line-height: 1.7; letter-spacing: 0; text-indent: 0; word-break: break-all;`;

function isReferenceHeading(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
  return REFERENCE_HEADING.test(text);
}

function italicizeBareUrls(html: string): string {
  let italicDepth = 0;
  return html.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith("<")) {
      if (/^<\/(?:i|em)\b/i.test(part)) italicDepth = Math.max(0, italicDepth - 1);
      else if (/^<(?:i|em)\b/i.test(part) && !/\/>$/.test(part)) italicDepth += 1;
      return part;
    }
    if (italicDepth > 0) return part;
    return part.replace(
      /https?:\/\/[^\s<>"'，。；;）)]+/gi,
      (url) => `<i style="word-break: break-all;">${url}</i>`,
    );
  }).join("");
}

function styleReferenceBlock(block: string): string {
  let output = block.replace(
    /<a\b([^>]*\bhref=(["'])(https?:\/\/.*?)\2[^>]*)>[\s\S]*?<\/a>/gi,
    (_match, attributes: string, _quote: string, href: string) => (
      `<a${attributes}><i style="word-break: break-all;">${href}</i></a>`
    ),
  );
  output = italicizeBareUrls(output);
  output = output.replace(/(<li\b[^>]*>)\s*(?:•|[-–—])\s*/gi, "$1");
  output = styleTags(output, "p", REFERENCE_LINE_STYLE);
  output = styleTags(output, "li", REFERENCE_LINE_STYLE);
  output = styleTags(output, "ul", "margin: 0; padding: 0; list-style: none;");
  output = styleTags(output, "ol", "margin: 0; padding: 0; list-style: none;");
  output = styleTags(output, "a", "color: inherit; text-decoration: none; word-break: break-all;");
  output = styleTags(output, "strong", "color: inherit; background: none; font-size: inherit; font-weight: 400;");
  output = styleTags(output, "em", "color: inherit; font-family: inherit; font-size: inherit; font-style: italic;");
  output = styleTags(output, "i", "color: inherit; font-family: inherit; font-size: inherit; font-style: italic;");
  return output;
}

function styleReferenceSections(html: string): string {
  const headingPattern = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi;
  const headings = [...html.matchAll(headingPattern)];
  let cursor = 0;
  let output = "";

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!;
    if (!isReferenceHeading(heading[0])) continue;

    const start = (heading.index ?? 0) + heading[0].length;
    const nextHeadingStart = headings[index + 1]?.index ?? html.length;
    const sectionEnd = html.indexOf("</section>", start);
    const end = sectionEnd >= 0 && sectionEnd < nextHeadingStart ? sectionEnd : nextHeadingStart;

    output += html.slice(cursor, start);
    output += styleReferenceBlock(html.slice(start, end));
    cursor = end;
  }

  return cursor === 0 ? html : output + html.slice(cursor);
}

export function normalizeReferenceMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const citedNumbers = new Set(
    [...markdown.matchAll(/(?<!!)\[(\d+)\](?!\()/g)].map((match) => Number(match[1])),
  );
  let inReferenceSection = false;

  return lines.map((originalLine) => {
    const heading = originalLine.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      inReferenceSection = REFERENCE_HEADING.test(heading[1]!.trim());
      return originalLine;
    }
    if (!inReferenceSection) return originalLine;

    let line = originalLine.replace(
      /(?<!!)\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi,
      (_match, url: string) => `[${url}](${url})`,
    );

    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (ordered && !citedNumbers.has(Number(ordered[2]))) {
      line = `${ordered[1]}- ${ordered[3]}`;
    }

    const sourceLink = line.match(/^(\s*(?:(?:[-*+]|\d+[.)])\s+|\[\d+\]\s+)?)(.*?)(\[https?:\/\/[^\]]+\]\(https?:\/\/[^)]+\))\s*$/i);
    if (sourceLink) {
      const prefix = sourceLink[1]!;
      const title = sourceLink[2]!.trimEnd();
      const separator = !title || /[：:](?:\*\*|__)?\s*$/.test(title) ? "" : "：";
      line = `${prefix}${title}${separator}${sourceLink[3]}`;
    }

    return line;
  }).join("\n");
}

/**
 * Adds a restrained, editorial reading rhythm to baoyu-md's default theme.
 * Styles stay inline because WeChat strips or rewrites stylesheet rules on paste.
 */
export function applyWechatEditorialTypography(
  html: string,
  primaryColor = XHS_DEFAULT_ACCENT,
): string {
  const highlightColor = colorWithAlpha(primaryColor, 0.18);
  const tagStyles: Array<[string, string]> = [
    ["body", `padding: 24px 20px; background: ${PAPER}; color: ${INK};`],
    ["section", `padding: 1px 2px 20px; background: ${PAPER}; font-family: Songti SC, SimSun, Noto Serif CJK SC, Georgia, serif; font-size: 16px; line-height: 1.95; text-align: left; color: ${BODY_TEXT}; word-break: break-word;`],
    ["h1", `display: block; margin: 0 0 1.8em; padding: 0; border: 0; color: ${INK}; background: transparent; font-family: KaiTi, STKaiti, Georgia, serif; font-size: 25px; font-weight: 700; line-height: 1.45; letter-spacing: 0.02em; text-align: left;`],
    ["h2", `display: block; margin: 1.5em 0; padding: 0 0 0 12px; border: 0; border-left: 4px solid ${primaryColor}; border-radius: 0; color: ${INK}; background: transparent; font-family: KaiTi, STKaiti, Georgia, serif; font-size: 18px; font-weight: 700; line-height: 1.65; letter-spacing: 0.01em; text-align: left;`],
    ["h3", `margin: 2.2em 0 0.75em; padding: 0; border: 0; color: ${INK}; background: transparent; font-family: KaiTi, STKaiti, Georgia, serif; font-size: 19px; font-weight: 700; line-height: 1.5; letter-spacing: 0.01em;`],
    ["h4", `margin: 2em 0 0.7em; padding: 0; color: ${primaryColor}; font-size: 16px; font-weight: 650; line-height: 1.6;`],
    ["h5", `margin: 1.8em 0 0.6em; padding: 0; color: ${INK}; font-size: 16px; font-weight: 650; line-height: 1.6;`],
    ["h6", `margin: 1.8em 0 0.6em; padding: 0; color: ${MUTED}; font-size: 15px; font-weight: 600; line-height: 1.6;`],
    ["p", `margin: 1.15em 0; color: ${BODY_TEXT}; font-size: 16px; line-height: 1.95; letter-spacing: 0.025em;`],
    ["blockquote", `margin: 1.7em 0; padding: 1em 1.15em; border: 0; border-left: 4px solid ${primaryColor}; border-radius: 0 8px 8px 0; color: ${MUTED}; background: ${ACCENT_WASH}; font-style: normal; line-height: 1.85;`],
    ["ul", `margin: 1.2em 0; padding: 0; list-style: none; color: ${BODY_TEXT};`],
    ["ol", `margin: 1.2em 0; padding: 0; list-style: none; color: ${BODY_TEXT};`],
    ["li", `display: block; margin: 0.55em 0; padding-left: 1.2em; color: ${BODY_TEXT}; line-height: 1.85; text-indent: -1.2em;`],
    ["figure", "margin: 1.8em 0 1.4em;"],
    ["img", "display: block; max-width: 100%; margin: 0 auto 0.65em; border: 1px solid rgba(23, 23, 27, 0.07); border-radius: 8px; box-shadow: 0 6px 18px rgba(64, 48, 37, 0.06);"],
    ["figcaption", `margin-top: 0.55em; color: ${LIGHT_TEXT}; font-size: 13px; line-height: 1.6; letter-spacing: 0.02em; text-align: center;`],
    ["hr", "display: none; width: 0; height: 0; margin: 0; border: 0; background: transparent; transform: none;"],
    ["a", `color: inherit; text-decoration: underline; text-decoration-color: ${primaryColor}; text-underline-offset: 3px;`],
    ["strong", `color: ${INK}; background: linear-gradient(transparent 68%, ${highlightColor} 68%); font-size: inherit; font-weight: 700;`],
    ["em", `color: ${MUTED}; font-family: KaiTi, STKaiti, Georgia, serif; font-size: inherit; font-style: normal;`],
    ["table", `width: 100%; margin: 1.6em 0; border-collapse: collapse; color: ${INK}; font-size: 14px; line-height: 1.65;`],
    ["thead", `color: ${INK}; font-weight: 650;`],
    ["th", `padding: 8px 10px; border: 1px solid ${LINE}; color: ${INK}; background: ${PAPER_WARM}; font-weight: 700; text-align: left; word-break: normal;`],
    ["td", `padding: 8px 10px; border: 1px solid ${LINE}; color: ${BODY_TEXT}; background: ${PAPER}; text-align: left; word-break: normal;`],
  ];

  let output = html;
  for (const [tagName, style] of tagStyles) {
    output = styleTags(output, tagName, style);
  }

  output = styleBlockChildren(
    output,
    "blockquote",
    "p",
    `margin: 0; color: ${MUTED}; font-size: 15px; line-height: 1.85; letter-spacing: 0.02em;`,
  );
  output = styleClass(
    output,
    "code",
    "codespan",
    `padding: 2px 5px; border-radius: 4px; color: ${primaryColor}; background: ${PAPER_WARM}; font-family: Menlo, Monaco, Consolas, Courier New, monospace; font-size: 0.88em;`,
  );
  output = styleClass(
    output,
    "pre",
    "code__pre",
    `margin: 1.6em 0; border: 1px solid ${LINE}; border-radius: 6px; background: #FFFFFF; box-shadow: none; font-size: 13px; line-height: 1.65;`,
  );
  output = styleClass(
    output,
    "p",
    "footnotes",
    `margin: 0.6em 0; color: ${MUTED}; font-size: 13px; line-height: 1.7; letter-spacing: 0;`,
  );

  output = styleReferenceSections(output);

  return output;
}
