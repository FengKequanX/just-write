---
name: post-to-xhs
description: >
  将 Markdown 文章渲染为小红书风格轮播图 PNG。
  当用户提到"发小红书"、"小红书发布"、"同步小红书"、"XHS发布"、
  "post to xhs"时使用。
metadata:
  version: 1.0.3
  openclaw:
    homepage: https://github.com/FengKequanX/just-write#post-to-xhs
    requires:
      anyBins:
        - bun
        - npx
---

# Post to Xiaohongshu (小红书)

将 Markdown 文章渲染为小红书风格轮播图 PNG，生成文案（caption.md），用户手动上传到小红书创作者平台。

## Language

**Match user's language**: Respond in the same language the user uses.

## Script Directory

**Agent Execution**: Determine this SKILL.md directory as `{baseDir}`, then use `{baseDir}/scripts/<name>.ts`. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun.

| Script | Purpose |
|--------|----------|
| `scripts/md-to-xhs.ts` | Markdown → 小红书轮播图 PNG (Chrome headless) |

## Rendering Backend

Uses Chrome/Edge native `--headless=new --screenshot` for reliable cross-platform rendering. No Playwright dependency.

**Chrome discovery** (resolution order):
1. `CHROME_PATH` env var
2. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` env var
3. Platform defaults: Windows (`chrome.exe` / `msedge.exe`), macOS (`Google Chrome.app`), Linux (`/usr/bin/google-chrome`)

If Chrome/Edge is not found, the script errors with install instructions. Set `CHROME_PATH` to override.

## Mobile-First Carousel Layout

The renderer keeps the article in reading order and packs content by visual height instead of forcing every H2 section onto a separate page.

| Page | Design |
|------|--------|
| Cover | Uses `coverImage` from frontmatter, then title and author. The cover image keeps its real aspect ratio and is never cropped; 4:3 is recommended for stronger Xiaohongshu first-screen presence. No summary text is rendered on the cover. |
| Content | Clean editorial style: warm background, serif body text, subtle accent marks, highlighted emphasis, fixed-width image frames, and no decorative page numbers. H2/H3 headings stay inline with the prose. Pages flow in article order, use browser-measured pagination, mobile-friendly typography, compact line spacing, and fixed narrow gaps around mixed Chinese/Latin text. |
| Ending | CTA, hashtags, and author. |

## Preferences (EXTEND.md)

Check EXTEND.md existence (priority order):

```bash
# macOS, Linux, WSL, Git Bash
test -f .baoyu-skills/post-to-xhs/EXTEND.md && echo "project"
test -f "${XDG_CONFIG_HOME:-$HOME/.config}/baoyu-skills/post-to-xhs/EXTEND.md" && echo "xdg"
test -f "$HOME/.baoyu-skills/post-to-xhs/EXTEND.md" && echo "user"
```

| Path | Location |
|------|----------|
| `.baoyu-skills/post-to-xhs/EXTEND.md` | Project directory |
| `${XDG_CONFIG_HOME:-$HOME/.config}/baoyu-skills/post-to-xhs/EXTEND.md` | XDG |
| `$HOME/.baoyu-skills/post-to-xhs/EXTEND.md` | User home |

**EXTEND.md example**:

```md
default_author: 作者名
default_theme: default
default_aspect: 3:4
default_topic_tags: AI观察,科技,编程
```

**Theme options**: `default` (dark gradient cover, content-aware layouts, dark ending)

**Aspect ratio options**: `3:4` (1080×1440, default) / `9:16` / `1:1` / `4:3`

## Workflow

```
XHS Rendering Progress:
- [ ] Step 0: Load preferences (EXTEND.md)
- [ ] Step 1: Render markdown to carousel images
- [ ] Step 2: Report completion
```

### Step 0: Load Preferences

Check and load EXTEND.md settings. If not found, use defaults.

Resolve defaults:
- `default_author` (from EXTEND.md or prompt)
- `default_theme` (default `default`)
- `default_aspect` (default `3:4`)
- `default_topic_tags` (comma-separated hashtags)

### Step 1: Render Markdown to Carousel Images

```bash
${BUN_X} {baseDir}/scripts/md-to-xhs.ts <markdown-file> --out <output-dir> [--theme default] [--aspect 3:4] [--author 作者名] [--tags "tag1,tag2"]
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `<markdown-file>` | Input markdown file (positional, required) |
| `--out <dir>` | Output directory (default: `<article-dir>/<filename>-xhs/`) |
| `--theme <name>` | Theme name (default: `default`) |
| `--aspect <ratio>` | Aspect ratio: `3:4` / `9:16` / `1:1` / `4:3` (default `3:4`) |
| `--author <name>` | Author name for cover/ending |
| `--tags <tags>` | Comma-separated topic tags for ending page |

**Rendering rules**:
- Frontmatter title → Cover page title
- Frontmatter `coverImage` → Cover page image; fallback to `cover.png` or `imgs/cover.png`; placed in a 4:3 visual frame, with the foreground image rendered complete without cropping and a soft same-image background for non-4:3 covers
- Frontmatter description/summary → Caption text only, not cover text
- H2 headings → Inline content headings, not forced page breaks
- Content overflow → Auto-split sequentially using browser-measured layout height; prose paragraphs can continue across pages like article text, while images stay as whole blocks and move to the next page when they do not fit at their rendered frame size; the final page keeps the remaining content naturally
- Inline images → Rendered inside unified-width white image frames; the image itself is shown complete without cropping
- Ending page → CTA + hashtags + author

**Output structure**:

```
<output-dir>/
├── 01-cover.png
├── 02-content-<slug>.png
├── 03-content-<slug>.png
├── ...
├── NN-ending.png
└── caption.md
```

### Step 2: Completion Report

```
Xiaohongshu Images Generated!

Input: [markdown-file]
Theme: [theme] · Aspect: [ratio]

Images: [N] total
- 01-cover.png ✓ Cover (cover image + title + author)
- 02-content-[slug].png ✓ Content
- ...
- NN-ending.png ✓ Ending

Caption: [output-dir]/caption.md
• Title: [title]
• Hashtags: [tags]

Next step:
→ 打开小红书创作者平台手动上传图片
→ https://creator.xiaohongshu.com/publish/publish
```

## Integration with just-write

When used as part of the just-write plugin, this skill triggers after WeChat publishing.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Chrome/Edge not found | Install Google Chrome or Microsoft Edge, or set `CHROME_PATH` env var |
| Rendering fails | Check Chrome version ≥ 112 (required for `--headless=new`) |
| Chinese path errors | Script uses ASCII temp path internally; should work for all paths |
| Content overflow | Auto-split by browser-measured layout; check whether unusually tall source images need shorter surrounding text |
| Title too long | Full title is written to `caption.md`; adjust manually only if the target platform rejects the length |

## Prerequisites

- `bun` runtime (or `npx`)
- Google Chrome or Microsoft Edge (≥ 112 for headless screenshots)

## Extension Support

Custom configurations via EXTEND.md. See **Preferences** section for paths and supported options.
