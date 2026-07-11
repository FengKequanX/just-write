---
name: just-write
description: Route and execute Chinese content creation work, including full article writing, polishing, Markdown formatting, WeChat publishing, Xiaohongshu carousel generation, and Douyin image-note syncing. Use whenever the user asks to write, edit, polish, format, prepare, or publish article content.
---

# Just Write

Turn an idea or existing article into publishable content. Preserve user authorship, make reversible transformations directly, and gate title locking and real publishing.

## Route the request

Choose exactly one mode before acting:

| Mode | Trigger | Entry behavior |
|---|---|---|
| `full` | Write an article from an idea or topic | Run the six-step workflow below |
| `polish` | Polish, rewrite, or remove AI tone from existing content | Load `humanizer-zh` directly |
| `format` | Format Markdown or generate title candidates | Load `baoyu-format-markdown` directly |
| `wechat_publish` | Publish an existing article to WeChat | Start from asset checks and WeChat confirmation |
| `xhs_materials` | Generate Xiaohongshu images or caption | Load `post-to-xhs`; never publish |
| `douyin_sync` | Dry-run or upload an existing carousel to Douyin | Load `sync-to-douyin` |

Do not force a direct request through unrelated full-workflow steps. If the intent mixes modes, finish reversible preparation first and ask only before title locking or a real publish.

## Persist article state

Use `scripts/workflow-state.ts` for every mode once an article directory exists:

```bash
bun <this-skill>/scripts/workflow-state.ts init <article-dir> --mode <mode>
bun <this-skill>/scripts/workflow-state.ts show <article-dir>
```

The state lives at `<article-dir>/.just-write/workflow.json`. Treat missing artifacts reported by `show` as drift: stop and locate or regenerate them instead of guessing.

After a successful operation, update the artifact, title, stage, or platform status with the matching command. Never advance state before the filesystem or publishing operation succeeds. Mark a platform `failed` when its attempted operation fails.

Managed layout:

```text
<article-dir>/
├── <title>.md
├── <title>-formatted.md
├── imgs/
│   ├── cover.png
│   └── cover-xhs.png
├── xhs/
│   ├── 01-cover.png
│   └── caption.md
├── douyin/
│   └── douyin-caption.md
└── .just-write/
    └── workflow.json
```

## Title and publishing rules

- Confirm and lock the article title before generating platform assets. Reuse it verbatim for the source article, formatted article, WeChat, Xiaohongshu cover, and Xiaohongshu `caption.md`.
- Use `imgs/cover.png` only for WeChat and `imgs/cover-xhs.png` only for Xiaohongshu. Never substitute one platform's conventional cover for the other.
- Store a separate Douyin title in `titles.douyin`. It may satisfy Douyin limits without changing the article title. Lock it as part of Douyin publish confirmation.
- Require an explicit WeChat confirmation immediately before saving the WeChat draft.
- Require an explicit Douyin confirmation immediately before a real upload. Without it, run `--dry-run` only.
- Xiaohongshu is materials-only. Never open its creator platform, upload, fill forms, or click publish.

## Full mode

Prefix every full-mode response with the current label. Stop at each checkpoint until the exact confirmation is received.

1. `[Step 1: 选题讨论]` — Load `brainstorming`; confirm with `确认选题`.
2. `[Step 2: 内容生成]` — Draft into the article directory. Put factual image placeholders inline as `![描述](imgs/name.png)`. On `确认内容`, immediately list first-party screenshot sources.
3. `[Step 3: 润色]` — Load `humanizer-zh`; confirm with `确认润色`.
4. `[Step 4: 排版优化]` — Load `baoyu-format-markdown`, produce 4–5 title candidates and `<title>-formatted.md`; confirm with `确认排版：X号`.
5. `[Step 5: 配图与发布确认]` — Lock the chosen article title, rename the directory and same-name Markdown files without overwriting, verify `imgs/cover.png` and any inline images, and confirm WeChat with `确认发布微信`.
6. `[Step 6: 发布]` — Load `baoyu-post-to-wechat`. After a successful WeChat draft, optionally offer Xiaohongshu materials when its config has `enabled: true`, then optionally offer Douyin.

If a rename target exists, stop without overwriting. Remove only illegal path characters (`< > : " / \\ | ? *`), line breaks, surrounding whitespace, and trailing periods from filesystem names; keep the locked display title unchanged.

## Direct modes

- `polish`: operate on the supplied file/content, write the requested result, update state, and report the artifact. Do not ask for topic or publishing confirmation.
- `format`: format and produce title candidates. Require title confirmation only if the user asks to generate platform assets afterward.
- `wechat_publish`: require a formatted article, locked article title, cover/body assets, and `确认发布微信`; then load `baoyu-post-to-wechat`.
- `xhs_materials`: require a formatted article, locked article title, and `imgs/cover-xhs.png` when a custom cover is expected; render into `<article-dir>/xhs`, update XHS status to `generated`, and stop with local paths.
- `douyin_sync`: require `<article-dir>/xhs` and `<article-dir>/douyin/douyin-caption.md`; validate the independent title/body/topics, dry-run by default, and require `确认发布抖音` for upload.

## State transitions

Use these stages: `topic → draft → polish → format → assets → publish → complete`. Direct modes may enter at their relevant stage, but completed stages must describe operations that actually happened. Platform statuses use `not_started`, `ready`, `generated`, `dry_run`, `published`, or `failed`.
