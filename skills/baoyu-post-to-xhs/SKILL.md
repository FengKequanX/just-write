---
name: baoyu-post-to-xhs
description: >
  将 Markdown 文章渲染为小红书轮播图并自动发布。
  当用户提到"发小红书"、"小红书发布"、"同步小红书"、"XHS发布"、
  "post to xhs"、"publish to xiaohongshu"时使用。
version: 0.1.0
metadata:
  openclaw:
    homepage: https://github.com/FengKequanX/just-write#baoyu-post-to-xhs
    requires:
      anyBins:
        - bun
        - npx
---

# Post to Xiaohongshu (小红书)

将 Markdown 文章渲染为小红书风格轮播图，并通过浏览器自动化发布。

## Language

**Match user's language**: Respond in the same language the user uses.

## Script Directory

**Agent Execution**: Determine this SKILL.md directory as `{baseDir}`, then use `{baseDir}/scripts/<name>.ts`. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun.

| Script | Purpose |
|--------|----------|
| `scripts/md-to-xhs.ts` | Markdown → 小红书轮播图 PNG |
| `scripts/xhs-publisher.ts` | 浏览器自动化发布到小红书 |

## Preferences (EXTEND.md)

Check EXTEND.md existence (priority order):

```bash
# macOS, Linux, WSL, Git Bash
test -f .baoyu-skills/baoyu-post-to-xhs/EXTEND.md && echo "project"
test -f "${XDG_CONFIG_HOME:-$HOME/.config}/baoyu-skills/baoyu-post-to-xhs/EXTEND.md" && echo "xdg"
test -f "$HOME/.baoyu-skills/baoyu-post-to-xhs/EXTEND.md" && echo "user"
```

| Path | Location |
|------|----------|
| `.baoyu-skills/baoyu-post-to-xhs/EXTEND.md` | Project directory |
| `${XDG_CONFIG_HOME:-$HOME/.config}/baoyu-skills/baoyu-post-to-xhs/EXTEND.md` | XDG |
| `$HOME/.baoyu-skills/baoyu-post-to-xhs/EXTEND.md` | User home |

**EXTEND.md example**:

```md
default_author: 炙青
default_theme: default
default_aspect: 3:4
default_topic_tags: AI观察,科技,编程
default_caption_style: 干货型
browser_profile_path: ~/.baoyu-skills/xhs-chrome-profile
```

**Theme options**: `default` (clean tech style)

**Aspect ratio options**: `3:4` (1080×1440, default) / `9:16` / `1:1` / `4:3`

**Caption style options**: `干货型` (default) / `种草型` / `故事型`

## Workflow

```
XHS Publishing Progress:
- [ ] Step 0: Load preferences (EXTEND.md)
- [ ] Step 1: Render markdown to carousel images
- [ ] Step 2: Generate caption
- [ ] Step 3: Auto-publish to Xiaohongshu
- [ ] Step 4: Report completion
```

### Step 0: Load Preferences

Check and load EXTEND.md settings.

**CRITICAL**: If not found, run first-time setup BEFORE any other steps.

Resolve defaults:
- `default_author` (from EXTEND.md or prompt)
- `default_theme` (default `default`)
- `default_aspect` (default `3:4`)
- `default_topic_tags` (comma-separated hashtags)
- `default_caption_style` (default `干货型`)
- `browser_profile_path` (for session persistence)

### Step 1: Render Markdown to Carousel Images

```bash
${BUN_X} {baseDir}/scripts/md-to-xhs.ts <markdown-file> --out <output-dir> [--theme default] [--aspect 3:4] [--author 炙青]
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `<markdown-file>` | Input markdown file (positional, required) |
| `--out <dir>` | Output directory (default: `<article-dir>/<filename>-xhs/`) |
| `--theme <name>` | Theme name (default: `default`) |
| `--aspect <ratio>` | Aspect ratio: `3:4` / `9:16` / `1:1` / `4:3` (default: `3:4`) |
| `--author <name>` | Author name for cover/ending |

**Rendering rules**:
- First H1 section → Cover page (title + subtitle + author + brand mark)
- H2 sections → Content pages (section title + body text + inline images)
- Auto-generated → Ending page (CTA + hashtags + author)
- Content overflow → Auto-split into multiple pages by paragraph
- Inline images (`![](path)`) → Embedded and rendered

**Output structure**:

```
<output-dir>/
├── 01-cover.png
├── 02-content-<slug>.png
├── 03-content-<slug>.png
├── ...
└── NN-ending.png
```

### Step 2: Generate Caption

Auto-generate from article content:

- **Title**: Article H1, truncated to 20 chars if needed
- **Description**: First paragraph or summary, max 300 chars
- **Hashtags**: From EXTEND.md `default_topic_tags` + auto-extracted from content

Write to `<output-dir>/caption.md`.

**Caption styles**:

| Style | Best for | Tone |
|-------|----------|------|
| `干货型` (default) | 教程、技术、知识分享 | 直接、信息密度高 |
| `种草型` | 推荐、测评、好物分享 | 情感驱动、痛点共鸣 |
| `故事型` | 经验分享、复盘、成长 | 叙事、代入感 |

### Step 3: Auto-Publish to Xiaohongshu

```bash
${BUN_X} {baseDir}/scripts/xhs-publisher.ts --images <dir> [--title <text>] [--desc <text>] [--profile <dir>] [--dry-run]
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `--images <dir>` | Directory containing carousel images |
| `--title <text>` | Note title (max 20 chars, from caption.md if omitted) |
| `--desc <text>` | Note description (from caption.md if omitted) |
| `--profile <dir>` | Chrome profile path (for session persistence) |
| `--dry-run` | Preview without publishing |

**Publishing flow**:
1. Launch Chromium with persistent profile
2. Navigate to `https://creator.xiaohongshu.com/publish/publish`
3. If not logged in → display QR code, wait for scan (timeout: 120s)
4. Upload carousel images
5. Fill title and description
6. Click publish
7. Verify success

### Step 4: Completion Report

```
Xiaohongshu Publishing Complete!

Input: [markdown-file]
Theme: [theme] · Aspect: [ratio]

Images: [N] total
- 01-cover.png ✓ Cover
- 02-content-[slug].png ✓ Content
- ...
- NN-ending.png ✓ Ending

Caption:
• Title: [title]
• Style: [caption style]
• Hashtags: [tags]

Result:
✓ Published to Xiaohongshu

Files:
• [output-dir]/caption.md
• [output-dir]/*.png
```

## Integration with just-write

When used as part of the just-write plugin, this skill triggers after WeChat publishing (if configured in EXTEND.md):

```md
platforms:
  wechat: true
  xhs: true
```

Set `xhs: false` to skip Xiaohongshu publishing.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Playwright not installed | `npx playwright install chromium` |
| Browser launch fails | Set `CHROME_PATH` env var or check Chromium install |
| QR code timeout | Re-run, scan within 120 seconds |
| Image upload fails | Check format (PNG/JPG only), max 20 images per note |
| Session expired | Delete profile dir, re-login with QR code |
| Content overflow | Auto-split handles overflow; check output images |
| Title too long | Auto-truncated to 20 chars |

## Prerequisites

- `bun` runtime (or `npx`)
- Playwright with Chromium (`npx playwright install chromium`)
- Google Chrome or Chromium browser
- Xiaohongshu account (for publishing)

## Extension Support

Custom configurations via EXTEND.md. See **Preferences** section for paths and supported options.
