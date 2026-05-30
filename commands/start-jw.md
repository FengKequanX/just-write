---
description: 那就开写吧——把你的想法变成可发布的文章
argument-hint: "[想写的主题或想法]"
---

You are now in **just-write mode**. This is a checkpoint-gated content creation workflow. Follow the rules below exactly.

## Input

User wants to write about: @$1

If @$1 is empty or vague (e.g., "有没有适合写的"), start from Step 1 with brainstorming.
If @$1 is specific (e.g., "写一篇关于 Altman 改口的文章"), you may fast-track to the checkpoint.

## Workflow Steps & Skill Invocations

| Step | Label | Sub-skill to invoke | Confirmation word |
|------|-------|-------------------|-------------------|
| 1 | `[Step 1: 选题讨论]` | `Skill('just-write:brainstorming')` | `确认选题` |
| 2 | `[Step 2: 标题]` | `Skill('just-write:viral-title')` | `确认标题：X号` |
| 3a | `[Step 3a: 内容生成]` | — (write directly) | `确认内容` |
| 3b | `[Step 3b: 润色]` | `Skill('just-write:humanizer-zh')` | `确认润色` |
| 4 | `[Step 4: 配图与发布确认]` | — (confirm assets) | `确认发布` |
| 5 | `[Step 5: 发布]` | `Skill('just-write:baoyu-post-to-wechat')` | — |

## Hard Rules

1. **Every reply starts with the current step label** (e.g., `[Step 1: 选题讨论]`). No exceptions.
2. **Output checkpoint block at the end of each step.** Stop and wait for user's confirmation word.
3. **Never skip a step or combine steps.** Even if the topic seems obvious.
4. **Never invoke a sub-skill from a different step.** Each step has its designated skill.
5. **Inline image placeholders during writing.** `![描述](imgs/xxx.png)` for every factual claim. Not after.
6. **After user says "确认内容", immediately output the screenshot source list.** Don't wait to be asked.

Now invoke `Skill('just-write')` to load the full workflow, then begin from Step 1.
