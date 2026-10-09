---
name: sync-to-douyin
description: 校验已有轮播与独立抖音文案，按请求交接预填编辑器或显式上传图文。默认只校验，不运行上传器；本技能仅针对抖音。
---

# 轮播同步到抖音

使用 `<文章目录>/xhs/` 的编号 PNG 和独立 `<文章目录>/douyin/douyin-caption.md`。抖音标题与正文不回写文章、微信或 XHS 配文。

## 动作边界

默认只校验，`--dry-run` 是兼容别名。用户要求打开预填编辑器时用 `--draft`；已有明确上传授权时用 `--publish`。自然语言授权有效，不要求“确认发布抖音”口令。三个显式模式互斥；参数、配置和技能调用不能扩大授权。

校验无需账号。交接或上传必须有明确账号及所需运行条件。保留本地材料，失败或结果未知先核对，不重复提交来证明成功。本技能不控制小红书。

## 独立文案

```markdown
---
publishingAdvice: 确认音乐和发布时间。
---
抖音独立标题

正文

#话题1 #话题2
```

正文第一条非空行是标题；纯话题行成为 topics，正文中的普通 hashtag 不被自动抽走。`publishingAdvice` 是建议，不进入上传载荷。旧末行只有明确标为“发布建议：”时分离并提示迁移，普通破折号正文保留。

标题最多 20 字符，正文最多 1000 字符，至多五个话题且单个话题不含空格。超限明确报错，不静默删改。平台独立文案依据原稿已有内容准备，不增加事实；有规则冲突时读 [共用内容契约](../just-write/references/content-contract.md)。

## 运行

```text
bun <本技能目录>/scripts/douyin-note.ts <文章目录>/xhs --json
bun <本技能目录>/scripts/douyin-note.ts <文章目录>/xhs --account <账号> --draft --json
bun <本技能目录>/scripts/douyin-note.ts <文章目录>/xhs --account <账号> --publish --json
```

可用 `--caption` 指定独立文件，`--title / --note / --tags` 显式覆盖相应字段。`--sau` 指定已有上传器；默认查找配置安装目录或 `SAU_BIN / sau`。运行实际调用前确保存在工具，不能因缺失自行换平台。

脚本只读取编号 PNG，参数边界保留，临时正文文件执行后清理。完整选项以 `--help` 为准。

## 结果

- 校验成功为 `dry_run`，没有调用上传器。
- 预填完成为 `manual_handoff`，由用户继续操作。
- 上传器退出 0 仅证明执行结束；有支持公开发布的回执才能记 `published`。
- 可能已提交却无明确回执，或进程中断无法判断时记 `outcome_unknown`；先查平台。
- 明确业务拒绝报告 `failed`；参数／运行条件错误与平台结果分开。

`--json` 输出结构结果，日志写 stderr。退出码 0 成功，1 明确业务失败，2 参数／运行错误，3 结果待核验。记录状态只在实际执行后进行。

交付实际模式、账号（若适用）、图片数、标题和长度、正文长度、话题及结果。不把校验、预填或未知结果写成“已发布”。

## 配置

读取首个项目、XDG（未设置时 `~/.config`）或用户目录下 `.baoyu-skills/sync-to-douyin/EXTEND.md`（XDG 使用 `baoyu-skills/sync-to-douyin/EXTEND.md`）：

```yaml
enabled: false
default_account: creator
```

仅这两个键有效。`--account` 覆盖默认账号；`enabled` 控制主流程是否提供该选项，不授权上传。