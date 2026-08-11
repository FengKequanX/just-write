---
name: post-to-xhs
description: Render a locked-title Markdown article into Xiaohongshu carousel PNG images and caption.md. Use when the user asks to prepare, generate, sync, or post Xiaohongshu/XHS content; this skill creates materials only and never controls or publishes through the creator platform.
---

# Generate Xiaohongshu Materials

Render a formatted Markdown article into `<article-dir>/xhs/` with a cover, paginated content images, an ending image, and `caption.md`.

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

The renderer reads configuration itself, validates all options, renders into a staging directory, and replaces only managed numbered PNG files plus `caption.md` after success. Unrelated files in `xhs/` remain untouched.

## Expected output

```text
xhs/
├── 01-cover.png
├── 02-content-*.png
├── ...
├── NN-ending.png
└── caption.md
```

Verify that `caption.md` contains only the selected article-specific topics. Report the input, configuration source, aspect, image count, exact output paths, title, and topics. End by telling the user to upload the materials manually. When invoked by `just-write`, update XHS workflow status to `generated` only after the renderer succeeds.
