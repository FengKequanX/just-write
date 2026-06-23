---
name: sync-to-douyin
description: >
  Publish an existing Xiaohongshu carousel output folder to Douyin as an image
  note through the community social-auto-upload CLI. Use when the user asks to
  sync XHS carousel images to Douyin, auto-upload to Douyin, or reduce manual
  Douyin uploads.
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
2. Use an already generated carousel folder that contains numbered PNG files
   and `caption.md`.
3. Before running a real upload, confirm that the user wants to publish to
   Douyin now. If confirmation is missing, run `--dry-run` only.
4. Account login is handled by `social-auto-upload`. If the account is not
   logged in, ask the user to run the login command in their local terminal.
5. Browser automation may be affected by Douyin UI changes and platform risk
   controls. Report failures plainly and preserve the generated materials.

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
| `<xhs-output-dir>` | Folder containing `01-cover.png`, content PNGs, ending PNG, and `caption.md` |
| `--account <name>` | `social-auto-upload` account name |
| `--sau <path>` | Custom `sau` executable path; otherwise uses `SAU_BIN`, then `<project>/.baoyu-skills/social-auto-upload/.venv/.../sau`, then `sau` |
| `--title <title>` | Override the title parsed from `caption.md` |
| `--note <text>` | Override the body text parsed from `caption.md` |
| `--tags <a,b>` | Override tags parsed from hashtags in `caption.md` |
| `--bgm <name>` | Optional BGM name passed to Douyin |
| `--dry-run` | Print the resolved upload command without publishing |

## What the Script Does

1. Sorts all PNG files in the carousel folder by filename.
2. Reads `caption.md`.
3. Uses the first non-empty line as the title.
4. Extracts hashtags such as `#AI` or `#科技` as Douyin tags.
5. Writes a temporary note text file to avoid command-line encoding issues.
6. Calls:

```powershell
sau douyin upload-note --account <account> --images <pngs...> --title <title> --notef <temp-note> --tags <tags>
```

## Completion Report

Report:

- Douyin account name used
- Number of images sent
- Parsed title
- Parsed tags
- Whether it was a dry run or a real upload
- Any `sau` error message and suggested next step
