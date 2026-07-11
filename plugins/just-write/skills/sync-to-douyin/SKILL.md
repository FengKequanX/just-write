---
name: sync-to-douyin
description: Validate and publish an existing Xiaohongshu carousel as a Douyin image note through social-auto-upload, using a separate Douyin caption and explicit confirmation. Use for Douyin image-note dry runs, draft handoff, or uploads; never use it to automate Xiaohongshu.
---

# Sync Carousel to Douyin

Consume `<article-dir>/xhs/` and the independent `<article-dir>/douyin/douyin-caption.md`, then call `sau douyin upload-note`.

## Safety boundary

- Target Douyin only; never automate Xiaohongshu.
- Use `--dry-run` unless the user explicitly says `确认发布抖音` in the current workflow.
- Treat the Douyin title as platform-specific. Never write it back to the article, WeChat title, Xiaohongshu cover, or Xiaohongshu caption.
- Preserve materials after browser, login, or platform failures and report the exact error.

## Configuration

Load the first existing `.baoyu-skills/sync-to-douyin/EXTEND.md` from the project, XDG config, or user home. Only these keys are valid:

```yaml
enabled: false
default_account: creator
```

`enabled` controls whether the main workflow offers Douyin; it never authorizes a real upload. `--account` overrides `default_account`.

## Caption contract

Require this file before dry-run or upload:

```text
<article-dir>/douyin/douyin-caption.md
```

Format:

```markdown
抖音独立标题

正文

#话题1 #话题2

— 发布建议：确认音乐和发布时间。
```

The first non-empty line is the title. Pure hashtag lines become topics. A final dash-prefixed advice line is not uploaded. Enforce title ≤ 20 characters, body ≤ 1,000 characters, at most 5 topics, and no spaces inside a topic. Present these counts before publishing.

## Run

Dry-run by default:

```bash
bun <this-skill>/scripts/douyin-note.ts <article-dir>/xhs --account <account> --dry-run
```

After `确认发布抖音`:

```bash
bun <this-skill>/scripts/douyin-note.ts <article-dir>/xhs --account <account>
```

Use `--draft` for a headed, prefilled editor handoff. The script reads only numbered PNG outputs, keeps argument boundaries intact, and removes its temporary body file after dry-run or upload.

Report account, image count, independent title and length, body length, topics, caption path, mode, and result. When invoked by `just-write`, update state to `dry_run`, `published`, or `failed` only after the command finishes.
