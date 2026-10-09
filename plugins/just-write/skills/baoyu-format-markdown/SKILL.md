---
name: baoyu-format-markdown
description: 优化已有文章或纯文本的 Markdown 阅读结构，输出衍生排版稿。标题建议和发布元数据仅在用户要求时单独处理，纯排版保留正文及现有标题。
metadata:
  version: 1.57.0
  openclaw:
    homepage: https://github.com/JimLiu/baoyu-skills#baoyu-format-markdown
    requires:
      anyBins:
        - bun
        - npx
---

# Markdown 排版

先确定本次启用的任务：排版、标题建议、元数据准备，可以组合。仅“排版／美化文章”默认启用排版。读取全文后直接处理明确范围，不为已有充分输入加选择环节。

## 排版

读 [手机阅读规则](references/reading-layout.md)，按语义调整段落、标题层级、强调、列表、代码和表格：

- 保留原句、数字、限定、引语、术语、来源身份和链接目标；不替作者改判断。
- 已有唯一标题原样沿用，H1 与 frontmatter 默认保留，不在排版中抽取、删除或重新生成。
- 并列内容可换成列表，真实步骤及顺序完整。新增中性小标题只能表达已有内容，不能附加评价。
- 调整强调标记时保留术语全称和解释，不为了增加装饰而制造金句。
- 图注与图片对应；已删除图注不恢复。
- 明显文字错误只有在请求包含文字修正时处理；纯排版发现疑点可以说明，不默认改词。
- 无明显问题可以保持现状。分析是工作依据，不默认另写 `-analysis.md`。
- 严格保护任务不改变指定字符串或整稿；必要元数据和配文放入独立产物。

保存到 `<原文件名>-formatted.md`，保留源稿。覆盖已有衍生稿前保存不冲突备份。用户明确要求原地修改时才处理源稿。

遇到保真与表达规则冲突，读 [共用内容契约](../just-write/references/content-contract.md)。

## 标题与元数据任务

只有请求优化／生成标题时读 [标题建议](references/title-formulas.md)。按准确性、范围、读者用途和作者语气推荐，描述式标题与其他候选同等可选，不默认最强钩子。数字、亲历、耗时和效果必须来自材料。用户指定标题不再优化。

需要发布摘要、作者或平台字段时读 [元数据准备](references/metadata.md)。纯排版不创建 frontmatter、slug、summary 或 description。标题与 H1 冲突只有在需要采用其中一个作为平台标题时解决；不借排版悄悄改其中之一。

配置中 `auto_select / auto_select_title / auto_select_summary` 只影响本次已启用的标题／元数据任务，不能自动启用这些任务或覆盖用户选择。

## 排印脚本

脚本目录为本技能 `scripts/`，Bun 可直接运行；不存在时使用已有可用的 `npx -y bun`，两者都缺失则说明需要安装。

```text
bun <本技能目录>/scripts/main.ts <衍生稿.md> [选项]
```

| 选项 | 默认行为 |
|---|---|
| `--quotes / --no-quotes` | 默认不换引号 |
| `--spacing / --no-spacing` | 默认处理中英文间距 |
| `--emphasis / --no-emphasis` | 默认修复 CJK 强调标记 |
| `--help` | 查看用法 |

保护原话和字符串时显式使用 `--no-quotes --no-spacing`；强调标记也受保护时再加 `--no-emphasis`。保护整文件字节时不运行会重排 YAML 的脚本。脚本总会规范化 frontmatter 形式，不能把“值未变”报告成“文件未改”。

脚本只能做排印，不能替 agent 完成结构判断。运行后比较受保护内容、元数据值、代码和链接目标；交付排版稿路径与有意义的变动，不统计金句或装饰数量。

## 配置

按项目 `.baoyu-skills/baoyu-format-markdown/EXTEND.md`、XDG（未设置时 `~/.config`）、用户 `~/.baoyu-skills/baoyu-format-markdown/EXTEND.md` 顺序读取首个文件。配置可记录排印偏好和已启用任务的自动选择行为；没有配置直接使用默认，不要求首次设置。