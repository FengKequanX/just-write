---
name: post-to-xhs
description: Render a locked-title Markdown article into Xiaohongshu carousel PNG images, caption.md, phone preview, and layout report. Use when the user asks to prepare, generate, sync, or post Xiaohongshu/XHS content; this skill creates materials only and never controls or publishes through the creator platform.
---

# Generate Xiaohongshu Materials

将排版稿渲染到 `<article-dir>/xhs/`，生成含封面最多 18 张的连续正文轮播图，以及 `caption.md`、手机预览和渲染报告。

## Boundaries

- Generate local materials only. Never open or control Xiaohongshu, upload files, fill forms, or publish.
- Require a locked article title before rendering. Reuse it verbatim in the cover and `caption.md`; do not shorten it for platform limits.
- Use the formatted article as input and preserve inline image order.
- Resolve the cover from frontmatter `xhsCoverImage`, then `imgs/cover-xhs.png`. Never fall back to the WeChat cover `imgs/cover.png`.

## Configuration

Load the first existing `EXTEND.md` in this order:

1. `<cwd>/.baoyu-skills/post-to-xhs/EXTEND.md`
2. `$XDG_CONFIG_HOME/baoyu-skills/post-to-xhs/EXTEND.md`
3. `~/.baoyu-skills/post-to-xhs/EXTEND.md`

Only these keys are valid:

```yaml
enabled: false
default_author: 作者名
default_theme: default
default_aspect: "3:4"
default_topic_tags: AI观察,科技,编程
```

`default_aspect_ratio` and `dry_run` were removed and must produce a migration error. CLI arguments override configuration. Supported aspects are `3:4`, `9:16`, `1:1`, and `4:3`; the only bundled theme is `default`.

Treat `default_topic_tags` as a compatibility fallback for direct CLI use only. During skill execution, never reuse it as the article's topics.

## Select article topics

Before rendering, derive 3-5 topics from this article's locked title, summary, and core argument. Every topic must be directly supported by the current article:

- Prefer the central subject plus its specific entities, concepts, industry, or reader use case.
- Keep the set narrow enough that all topics describe the same article.
- Do not pad the set with generic defaults such as `科技`, `AI观察`, or `编程` unless that concept is central to the article.
- Do not carry topics over from another article or append keyword matches after the set is chosen.

Pass the derived set through `--tags`. When article-specific topics are supplied, the renderer uses exactly that set, deduplicated and capped at five.

## Run

Resolve Bun as `bun`, or use `npx -y bun` when Bun is unavailable. Then run:

```bash
bun <this-skill>/scripts/md-to-xhs.ts <article-dir>/<title>-formatted.md --out <article-dir>/xhs --tags "<topic-1>,<topic-2>,<topic-3>"
```

Other optional arguments: `--theme`, `--aspect`, and `--author`. The skill workflow always supplies article-specific `--tags`.

The renderer reads configuration itself, validates all options, renders into a staging directory, and replaces managed numbered PNG files, `caption.md`, `preview.html`, and `render-report.json` after success. Unrelated files in `xhs/` remain untouched.

## 阅读与图片布局

遵循 [手机阅读排版规则](../baoyu-format-markdown/references/reading-layout.md)。普通加粗只改变字重，显式 `<mark>` 才带底色；单次源文件折行自然排版，明确换行和新段落保留。

整组含封面最多 18 张。正文、标题和图片按原文顺序连续排版，当前页放满后自然翻页；短段落不强制独立或居中，不额外生成装饰性结束页。标题保留后续内容，段落避免只留一行。

图片保持内容宽度随文排版；超过剩余空间时，在空白处优先断开并留少量重叠，后续文字接着图片尾段继续排。短横图尽量完整，竖图不自动缩窄成独立页。截图不使用 `cover` 裁切，不无限缩小。默认正文 42px，超限时只尝试一次 40px 的紧凑排版；仍超过 18 张则报错并保留旧产物，需要拆篇或精简，禁止截断内容。低分辨率原图无法靠放大补回细节。

特殊图片可以在原始 HTML 的 `<img>` 上设置 `data-xhs-image-mode="auto|inline|page|split"`，默认 `auto`。`inline` 随文且不自动分段，`page` 强制整张独立页，`split` 按可分段图片处理，整图能放下时仍保持完整。仅在确有需要时覆盖自动布局；过长的图片说明或无法容纳的块会报错，不静默裁掉。

## Expected output

```text
xhs/
├── 01-cover.png
├── 02-content-*.png
├── ...
├── caption.md
├── preview.html
└── render-report.json
```

打开 `preview.html` 检查整组总览和 360/390/430px 手机预览，重点检查正文连续性、短段落是否孤立、非末页是否大面积留白、图片分段衔接和最后一页。`render-report.json` 记录 18 张上限、采用的字号方案、每页高度与占用比例、图片显示尺寸和原图分段范围；成功产物已通过文字完整性、图片顺序、连续覆盖、最终 DOM 溢出和 PNG 尺寸检查。末页允许自然留白，不为填满而拉大段距或改写正文。

Verify that `caption.md` contains only the selected article-specific topics. Report the input, configuration source, aspect, image count, exact output paths, title, topics, and material warnings. End by telling the user to upload the materials manually. When invoked by `just-write`, update XHS workflow status to `generated` only after the renderer succeeds and visual checks pass.
