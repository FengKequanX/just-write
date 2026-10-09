---
name: post-to-xhs
description: 将已有 Markdown 文章生成本地小红书轮播 PNG、独立配文、手机预览和渲染报告。适用于准备 XHS 素材；本技能不控制或发布到创作者平台。
---

# 小红书本地材料

使用本次确定的文章标题和排版稿，生成 `<文章目录>/xhs/`。含封面最多 18 张，正文与图片连续完整；成功交付本地文件。

## 输入与内容保护

- 用户指定或确认标题原样用于封面和 `caption.md`。唯一现有标题可以沿用，不补造历史确认；多个候选或冲突才确认。
- 正文图片顺序和内容保留；微信封面不代替 XHS 封面。
- 封面取 frontmatter `xhsCoverImage`，再取 `imgs/cover-xhs.png`。没有自定义封面时可以用渲染器文字封面；用户要求指定图片但不可用时先解决缺口。
- 本技能只产出本地材料，不打开 XHS、预填、上传或发布。
- 有保真冲突时读 [共用内容契约](../just-write/references/content-contract.md)。

## 配文与话题

已有 `description` 或 `summary` 适合配文时可沿用。需要独立平台正文、摘要缺失或原稿受保护时，依据正文准备 UTF-8 配文文本，使用 `--caption-body-file`；不回写文章。

显式文件只含配文正文，标题、话题和作者由现有参数处理。显式文件优先于 `description || summary`，即使文件为空也有效；缺省保持原有 fallback。正文不能新增经历、数字或结果。

根据标题和主线选择少量准确话题，至多五个，一至两个足够就不强凑。配置里的通用话题仅供旧 CLI fallback；技能执行时显式传本篇话题，不追加别篇或热门无关词。

## 运行与检查

```text
bun <本技能目录>/scripts/md-to-xhs.ts <排版稿.md> --out <文章目录>/xhs --tags "<话题1>,<话题2>" [--caption-body-file <配文正文.txt>]
```

可选 `--theme / --aspect / --author`。渲染器自行读取配置，向 staging 写入 PNG、配文、预览和报告；成功才替换本次管理产物，无关文件保留。不要在渲染结束后临时改 `caption.md` 造成产物不同步。

遵循 [手机阅读规则](../baoyu-format-markdown/references/reading-layout.md)。特殊图片、比例或分页问题时读 [渲染与图片](references/rendering.md)。不为压到上限删正文、缩窄长图或静默截断。

输出：

```text
xhs/
├── 01-cover.png
├── 02-content-*.png
├── caption.md
├── preview.html
└── render-report.json
```

打开预览总览及 360／390／430px 阅读宽度，检查连续内容、背景与字体、封面标题、图注、图片分段衔接和最后一页。机器报告不代替视觉判断。核对配文标题、正文和本篇话题。成功并完成相关视觉检查后才登记 XHS `generated`。

交付产物链接、图片数和需要注意的问题；不默认输出全部配置或安排平台上传。

## 配置

按项目 `.baoyu-skills/post-to-xhs/EXTEND.md`、XDG（未设置时 `~/.config`）、用户 `~/.baoyu-skills/post-to-xhs/EXTEND.md` 顺序读取首个配置，CLI 优先。

```yaml
enabled: false
default_author: 作者名
default_theme: default
default_aspect: "3:4"
default_topic_tags: 旧CLI默认话题
```

仅这些键有效；`default_aspect_ratio` 与 `dry_run` 是已移除键，须按错误提示迁移。支持 `3:4 / 9:16 / 1:1 / 4:3`，内置主题为 `default`。`enabled` 只是流程提供该选项的偏好，不自动授权生成或平台操作。