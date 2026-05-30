---
name: post-to-xhs
description: >
  将 Markdown 文章渲染为小红书风格轮播图 PNG。
  当用户提到"发小红书"、"小红书发布"、"同步小红书"、"XHS发布"、
  "post to xhs"时使用。
version: 0.3.0
metadata:
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

## Content-Aware Layout

The renderer analyzes each content section and picks the best layout:

| Layout | Trigger | Design |
|--------|---------|--------|
| `prose` | Default | White background, blue accent title, standard typography |
| `image-focus` | Image + short text | Large image with rounded corners + shadow, text as caption |
| `stats` | Bold numbers/percentages | Blue gradient stat cards with large values |
| `pull-quote` | Blockquote as main content | Centered large quote with decorative quotation mark |
| `list-highlight` | `**term**: desc` patterns | Blue sidebar highlight items |
| `code` | Code blocks | Dark background page, syntax-highlighted code |

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
- Frontmatter description → Cover page subtitle
- H2 sections → Content pages with content-aware layouts
- Content overflow → Auto-split into multiple pages by paragraph
- Inline images → Embedded and rendered
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
- 01-cover.png ✓ Cover (dark gradient)
- 02-content-[slug].png ✓ Content ([layout-type])
- ...
- NN-ending.png ✓ Ending (dark gradient)

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
| Content overflow | Auto-split by heuristic; check output images and adjust content length |
| Title too long | Auto-truncated to 20 chars in caption |

## Prerequisites

- `bun` runtime (or `npx`)
- Google Chrome or Microsoft Edge (≥ 112 for headless screenshots)

## Extension Support

Custom configurations via EXTEND.md. See **Preferences** section for paths and supported options.
