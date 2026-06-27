---
name: sync-to-douyin
description: >
  Publish an existing Xiaohongshu carousel output folder to Douyin as an image
  note with a platform-specific caption through the community
  social-auto-upload CLI. Enforces Douyin title and topic limits. Use when the
  user asks to sync XHS carousel images to Douyin, auto-upload to Douyin, or
  reduce manual Douyin uploads.
metadata:
  version: 0.1.0
  openclaw:
    homepage: https://github.com/FengKequanX/just-write#sync-to-douyin
    requires:
      anyBins:
        - bun
        - npx
      optionalBins:
        - sau
---

# Sync to Douyin

Publish a generated carousel folder to Douyin as a graphic/image note by
wrapping the `sau douyin upload-note` command from
`dreammis/social-auto-upload`.

## Boundaries

1. This skill only targets Douyin. It must not open, automate, or publish to
   Xiaohongshu.
2. Use an already generated `xhs/` carousel folder for numbered PNG files, but
   never reuse `xhs/caption.md` as Douyin copy.
3. Require a sibling `douyin/douyin-caption.md`. If it is missing, stop and
   create it before any dry run or upload.
4. Before running a real upload, confirm that the user wants to publish to
   Douyin now. If confirmation is missing, run `--dry-run` only.
5. Account login is handled by `social-auto-upload`. If the account is not
   logged in, ask the user to run the login command in their local terminal.
6. Browser automation may be affected by Douyin UI changes and platform risk
   controls. Report failures plainly and preserve the generated materials.

## Required Douyin Caption

Create this file for every article before syncing:

```text
<article-dir>/douyin/douyin-caption.md
```

Use this format:

```markdown
抖音标题

正文

#话题1 #话题2

— 发布建议：添加音乐并确认发布时间后发布。
```

The first non-empty line is the title. Pure hashtag lines become tags. A final
line beginning with `—` is publishing advice and is not uploaded as body text.

## Douyin Copy Strategy

Write the caption for Douyin instead of shortening the WeChat title or copying
the Xiaohongshu caption. Aim for qualified views and completion, not empty
clicks. Keep the account voice clear, restrained, personal, and opinionated.

Apply these hard limits:

- Keep the title at 20 characters or fewer. Prefer 12–18 characters so it is
  readable in the feed. Count letters, numbers, spaces, and punctuation.
- Use at most 5 topics. Prefer 3–5 highly relevant topics. Do not silently
  truncate extras; revise the selection.
- Keep the body at 1,000 characters or fewer. For a news/analysis image note,
  usually target 80–200 Chinese characters.
- Write multiword topics without spaces, such as `#AIAgent`.

Construct the title as `specific entity/model + strongest change, result, or
conflict`. Put searchable names such as `GPT-5.6` or `OpenAI` in the first half.
State the value clearly, but never invent urgency, exaggerate conclusions, or
use bait such as “震惊”“必看”“99%的人不知道”. Keep the title consistent with the
cover and body.

Structure the body for feed reading:

1. Open with one short conclusion, contrast, or user-relevant change. Do not
   begin with background history.
2. Give 2–3 concrete facts or examples that support the opening.
3. Add one personal judgment or practical implication for ordinary users or
   developers.
4. Optionally end with a genuine trade-off question. Do not use engagement bait
   or unrelated calls to comment.

Select topics by relevance, not raw popularity:

- 1–2 exact entities or products, such as `#OpenAI` and `#GPT56`.
- 1–2 vertical subjects, such as `#AIAgent` and `#大模型`.
- Up to 1 broader discovery topic, such as `#AI`.
- Use an official event or trending topic only when the content directly
  matches it. Never add unrelated hot topics for reach.

Before a dry run, report the proposed title and its length, body length, and the
final topic count/list. Rewrite any generic cross-platform copy first.

## Prerequisites

Install and prepare `social-auto-upload` once:

```powershell
git clone https://github.com/dreammis/social-auto-upload.git
cd social-auto-upload
uv venv
.venv\Scripts\activate
uv pip install -e .
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"; patchright install chromium
sau douyin login --account creator
sau douyin check --account creator
```

Use any account name you like instead of `creator`; the same name is passed to
this skill with `--account`.

## Script

Resolve this skill directory as `{baseDir}` and run:

```powershell
bun {baseDir}\scripts\douyin-note.ts <xhs-output-dir> --account <account-name> --dry-run
```

For a real upload after explicit confirmation:

```powershell
bun {baseDir}\scripts\douyin-note.ts <xhs-output-dir> --account <account-name>
```

Optional arguments:

| Argument | Description |
| --- | --- |
| `<xhs-output-dir>` | Folder containing `01-cover.png`, content PNGs, and ending PNG |
| `--account <name>` | `social-auto-upload` account name |
| `--caption <path>` | Optional caption override; defaults to sibling `douyin/douyin-caption.md` |
| `--sau <path>` | Custom `sau` executable path; otherwise uses `SAU_BIN`, then `<project>/.baoyu-skills/social-auto-upload/.venv/.../sau`, then `sau` |
| `--title <title>` | Override the title parsed from `douyin-caption.md` |
| `--note <text>` | Override the body text parsed from `douyin-caption.md` |
| `--tags <a,b>` | Override tags parsed from hashtags in `douyin-caption.md` |
| `--bgm <name>` | Optional BGM name passed to Douyin |
| `--draft` | Open a headed, prefilled editor and keep it open for the user to add music or choose a scheduled time. Douyin web does not expose these items as account drafts in Work Management. |
| `--dry-run` | Print the resolved upload command without publishing |

## What the Script Does

1. Sorts all PNG files in the carousel folder by filename.
2. Reads sibling `douyin/douyin-caption.md`; aborts if it is missing.
3. Uses the first non-empty line as the title.
4. Extracts hashtags such as `#AI` or `#科技` as Douyin tags.
5. Rejects titles over 20 characters, bodies over 1,000 characters, more than 5
   topics, and topics containing spaces.
6. Writes a temporary note text file to avoid command-line encoding issues.
7. Calls:

```powershell
sau douyin upload-note --account <account> --images <pngs...> --title <title> --notef <temp-note> --tags <tags>
```

## Completion Report

Report:

- Douyin account name used
- Number of images sent
- Parsed title
- Title and body lengths
- Parsed tags
- Topic count, which must not exceed 5
- Douyin caption path used
- Whether it was published or handed off in the open editor
- Whether it was a dry run or a real upload
- Any `sau` error message and suggested next step
