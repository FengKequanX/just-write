---
name: just-write
description: Trigger immediately when user wants to write, create, or publish content, especially:
  - "写一篇关于XX的文章"、"帮我写XX"
  - "把这个想法写成文章"、"润色一下"
  - 任何表达写作意图或内容创作需求
---

# 微信公众号内容创作工作室

把你的想法变成可发布的文章。支持全流程：头脑风暴 → 标题 → 创作 → 润色 → 配图 → 发布（可同步小红书）。

---

<RULES>
这些规则覆盖本文件中的所有其他指令。违反任何一条 = 工作流失败。

1. **NEVER 跳步。** 检查点要求"确认内容"，你必须停下来等用户说这几个字，不能自己判断"差不多就过了"。
2. **NEVER 不输出检查点就进入下一步。** 每个步骤结束后，必须先输出该步骤的检查点块，再等待用户确认。
3. **NEVER 写没有图片占位符的文章。** 每个事实性论断（数据、引用、新闻事件）必须带 `![描述](imgs/xxx.png)`。纯个人观点不需要。
4. **NEVER 在用户确认内容之前运行 humanizer-zh。** 润色必须在"确认内容"之后。
5. **NEVER 跳过截图来源清单。** 用户说"确认内容"后，立即输出来源表，不能等用户问。
6. **NEVER 重启已完成步骤。** 如果用户在前一轮对话中已经完成了某步，从下一个未完成的步骤继续。
</RULES>

## 步骤追踪

> 在每次回复开头标注当前步骤：`[Step 1: 头脑风暴]`。这让跳步对用户可见。

## 工作流

```
用户想法 → 头脑风暴 → 爆款标题 → 内容生成(迭代) → 润色 → 配图与发布确认 → 发布
  Step 1    Step 2     Step 3a           Step 3b   Step 4           Step 5
```

每个检查点需要用户说出特定确认词才能继续：

| 步骤 | 确认词 |
|------|--------|
| Step 1 | `确认选题` |
| Step 2 | `确认标题：X号` |
| Step 3a | `确认内容` |
| Step 3b | `确认润色` |
| Step 4 | `确认发布` |

---

## Step 1: 头脑风暴

用 brainstorming skill 辅助选题。一次问一个问题，最多 5 个问题。

核心引导：
1. 读者关心吗？（痛点/痒点/爽点至少占一个）
2. 有独特视角或真实经历吗？
3. 现在写合适吗？（时效性）

**快速通道：** 如果用户已经明确说了主题和角度，直接确认选题，不需要再问。

### 检查点（必须输出）

```
【选题确认】
- 文章主题：...
- 核心观点：...
- 目标读者：...

确认后回复"确认选题"。
```

---

## Step 2: 标题

用 viral-title skill 生成 3-5 个标题。

**微信禁忌：** 不用"震惊！""刚刚！""必看！""99%的人不知道"。

### 检查点（必须输出）

```
1.「...」（类型）
2.「...」（类型）
3.「...」（类型）

确认后回复"确认标题：X号"。
```

---

## Step 3a: 内容生成

支持多轮修正——用户可以反复提出修改意见，每次修改后重新输出检查点。

### 前置调研

涉及近期事件、产品或数据时：
1. 用 `WebSearch` 查最新信息（官方公告、36kr/量子位/财联社/Reuters）
2. 验证事实后再写
3. **不凭记忆写——先搜索**

### 图文一体（硬性要求）

写每句话时同步判断：读者看到这句话，需要看到什么才能理解/相信？

| 论断类型 | 配图 |
|---------|------|
| 数据/排名 | benchmark 截图 + 来源 URL |
| 引用原文 | 原文截图 + 页码 |
| 新闻事件 | 媒体报道截图 |
| 专家观点 | 采访原文/社交媒体截图 |
| 个人观点 | 通常不需要 |

**写作时立即用 `![描述](imgs/xxx.png)` 标记位置。不在写完后再补。**

### 事实争议处理

用户质疑事实时：重新搜索 → 逐项报告「已验证/需修正/无法确认」→ 修正 → 重新确认。

硬伤直接改；方向正确的保留但加限定词；无法确认的删除。

### 写作风格

理性、克制、有判断、不说教。
- 先说问题，再讲道理
- 少煽动，多判断
- 数据标注来源（"据XX官方公布"）
- 数字 + 参照系 + 具体场景
- 承认局限增加信任
- 倒金字塔（结论先行）
- 每段不超过 3 行（手机阅读）

### 检查点（必须输出）

```
【文章内容确认】
- 标题：...
- 核心观点：...
- 图片占位符：N 张（列出每个占位符和对应论断）
- 待确认数据：...

确认后回复"确认内容"。
```

### 截图来源清单（"确认内容"后立即输出）

```
【截图来源清单】
| # | 文中位置 | 来源 URL | 截图要点 |
|---|---------|---------|---------|
| 1 | ![图1](imgs/xxx.png) | https://... | 截取包含XX的部分 |
```

- 每个占位符必须有对应来源
- URL 必须是调研阶段验证过的真实链接
- 截图要点要具体（"截取表格第3行"而非"截取页面"）

用户可以边截图边等润色完成。

---

## Step 3b: 润色

用 humanizer-zh skill 润色文章。**只在用户确认内容后执行。**

- 去 AI 写作痕迹（24条规则）
- 提升文字质感
- 优化段落衔接
- 错别字检查

**只调用 humanizer-zh 一次。**

### 检查点（必须输出）

```
【润色结果确认】
- 文字流畅吗？
- 配图位置合理吗？
- 有需要补充的信息吗？

确认后回复"确认润色"。
```

---

## Step 4: 配图与发布确认

### 4.1 截图素材

截图来源清单已在 Step 3a 输出。用户按清单保存截图到 `imgs/`。检查目录确认文件到齐。

如果用户新增了论断需要配图，更新截图清单。

### 4.2 AI 配图

根据文章主题生成英文 AI 绘图提示词：
- 风格与文章调性一致
- 主体突出、构图简洁
- 格式：`Prompt: [英文] | Negative: [避免元素]`

### 4.3 封面图

- 用户有素材 → 直接用
- 无素材 → 生成封面图提示词（默认 2:3 竖版）

### 检查点（必须输出）

```
【最终发布确认】
标题：「...」
作者：...
主题/颜色：default / blue
内联图片：N 张
封面图：[描述]

确认后回复"确认发布"。
```

---

## Step 5: 发布

用户说"确认发布"后执行。

### 5.1 微信公众号

用 baoyu-post-to-wechat skill 发布。

### 5.2 小红书（可选）

微信发布后，检查 `.baoyu-skills/post-to-xhs/EXTEND.md` 的 `enabled` 配置：
- `enabled: true` → 询问用户是否同步发小红书
- 用户确认后调用 `post-to-xhs` skill

### 发布后

- 微信：告知草稿箱链接 https://mp.weixin.qq.com → 内容管理 → 草稿箱
- 小红书：确认发布结果

---

## 附录：发布命令与配置

<details>
<summary>展开查看发布命令、参数和配置</summary>

### 微信公众号发布

安装依赖：
```bash
SCRIPT_DIR=<plugin-dir>/skills/baoyu-post-to-wechat/scripts
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  bun install --cwd "$SCRIPT_DIR"
fi
```

发布命令：
```bash
bun <plugin-dir>/skills/baoyu-post-to-wechat/scripts/wechat-api.ts \
  "[文章标题]/[文章标题].md" \
  --theme default \
  --color blue \
  --author "作者名" \
  --cover "[文章标题]/imgs/封面图.png"
```

参数：
- `--theme`: default | grace | simple | modern
- `--color`: blue | green | vermilion | yellow | purple | sky | rose | olive | black | gray | pink | red | orange
- `--author`: 从 EXTEND.md 或 CLI
- `--cover`: 封面图路径
- `--no-cite`: 保留内联链接（默认转底部引用）

### 小红书发布

安装依赖：
```bash
SCRIPT_DIR=<plugin-dir>/skills/post-to-xhs/scripts
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  bun install --cwd "$SCRIPT_DIR"
fi
```

发布命令：
```bash
bun <plugin-dir>/skills/post-to-xhs/scripts/md-to-xhs.ts "[文章标题]/[文章标题].md"
bun <plugin-dir>/skills/post-to-xhs/scripts/xhs-publisher.ts
```

### 配置文件

**baoyu-post-to-wechat EXTEND.md**（`.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`）：
```yaml
default_theme: default
default_color: blue
default_publish_method: api
default_author: 作者名
```

**post-to-xhs EXTEND.md**（`.baoyu-skills/post-to-xhs/EXTEND.md`，可选）：
```yaml
enabled: true
default_aspect_ratio: "3:4"
dry_run: false
```

**API 凭证**（`.baoyu-skills/.env`）：
```
WECHAT_APP_ID=your_app_id
WECHAT_APP_SECRET=your_app_secret
```

**Bun** 运行时（`bun --version`）

### 常见问题

| 问题 | 处理 |
|------|------|
| API 40164: invalid ip | mp.weixin.qq.com → 开发 → 基本配置 → IP白名单 添加当前IP |
| bun 未安装 | `npm install -g bun` 或 https://bun.sh |
| 图片过大 (>1MB) | baoyu-post-to-wechat 自动压缩 |

</details>
