---
name: just-write
description: |
  那就开写吧——把你的想法变成可发布的文章。AI辅助但不代替，你的思路，你的表达。
  支持微信公众号全流程：头脑风暴、标题、创作、润色、配图、一键发布。未来扩展到小红书等平台。
  Trigger immediately when user wants to write, create, or publish content, especially:
  - "写一篇关于XX的文章"、"帮我写XX"
  - "把这个想法写成文章"、"润色一下"
  - 任何表达写作意图或内容创作需求
---

# 微信公众号内容创作工作室

## ⚠️ 最重要的规则：强制暂停机制

本skill采用**强制暂停机制**——在每个暂停点必须停下来等待用户输入：

| 暂停点 | 等待什么 | 用户回复才能继续 |
|--------|---------|-----------------|
| Step 1 结束后 | 选题确认 | `确认选题` |
| Step 2 结束后 | 标题选择 | `确认标题：X号` |
| Step 3a 内容生成后 | 内容确认（可多轮修正） | `确认内容` |
| Step 3b 润色后 | 润色确认 | `确认润色` |
| Step 4 结束后 | 配图与发布确认 | `确认发布` |

---

## 工作流概览

```
用户想法 → 头脑风暴 → 爆款标题 → 内容生成与迭代修正 → 润色 → 配图采集与发布确认 → 一键发布
  Step 1    Step 2     Step 3a (迭代)          Step 3b   Step 4 (合并确认)    Step 5
```

---

## Step 1: 头脑风暴选题

Use the brainstorming skill to refine the topic. Ask one question at a time.

Core questions to guide the user:
1. 读者关心吗？（痛点/痒点/爽点至少占一个）
2. 有独特的视角或真实经历吗？
3. 现在写是否合适？（时效性）
4. 能否在3分钟内说清楚核心价值？

### ✅ 检查点

```
【选题确认清单】
1. 文章主题：XXX。确认吗？
2. 核心观点：最想表达什么？
3. 目标读者：写给谁看？
4. 文章目的：读者什么感受或行动？
5. 真实经历：有相关经历吗？

确认后回复"确认选题"。
```

---

## Step 2: 生成爆款标题

Use the viral-title skill to generate 3-5 titles. Label each with formula type:

| 类型 | 公式 |
|------|------|
| 数字式 | N个X + 收益/改变 |
| 悬念式 | 部分真相 + 省略关键信息 |
| 情感式 | 引发共鸣 + 群体标签 |
| 反差式 | 颠覆认知 + 认知冲突 |
| 热点式 | 热点事件 + 独特角度 |

**微信标题禁忌**: 禁用"震惊！""刚刚！""必看！""99%的人都不知道"

### ✅ 检查点

```
建议标题：
1.「...」（类型标注）
2.「...」
3.「...」

确认后回复"确认标题：X号"。
```

---

## Step 3a: 内容生成与迭代修正

### ⚠️ 支持多轮修正——用户可以对内容提出质疑，修正后重新确认。

### 前置调研

When the article involves recent events, products, or data:
1. Use `WebSearch` to find the latest information (official announcements, 36kr/量子位/财联社/Reuters)
2. Verify all facts before writing
3. **Never write from memory - search first**

### 🖼️ 图文一体原则

**图不是写完塞进去的。写每句话时同步判断：读者看到这句话，需要看到什么才能理解/相信？**

| 论断类型 | 配图需求 |
|---------|---------|
| 数据/排名 | 需要 benchmark 截图，标注来源 URL |
| 引用原文 | 需要原文截图，标注文件页码 |
| 新闻事件 | 需要媒体报道截图 |
| 专家观点 | 需要采访原文/社交媒体截图 |
| 个人观点 | 通常不需要 |

写作时立即用 `![描述](路径)` 标记配图位置。

### 🔁 事实争议处理

用户质疑事实时：**重新搜索 → 逐项报告「已验证/需修正/无法确认」→ 修正 → 重新确认**。

硬伤直接改；方向正确的保留但加限定词；无法确认的删除。

### 写作风格

**理性、克制、有判断、不说教。**

- 先说问题，再讲道理
- 少煽动，多判断
- 数据必须标注来源（"据XX官方公布"）
- 数字 + 参照系 + 具体场景（不是"近10分"，而是"从40分到50分，意味着..."）
- 承认局限增加信任
- 优先倒金字塔结构（结论先行）
- 每段不超过3行（手机阅读）

### ✅ 检查点

```
【文章内容确认】
1. 内容是否符合想法？需要调整吗？
2. 核心观点准确吗？
3. 数据是否有误？（我会交叉验证）
4. 配图标注合理吗？

确认后回复"确认内容"，进入润色。
```

---

## Step 3b: 润色

Use the humanizer-zh skill to polish the article:

- 去除 AI 写作痕迹（24条规则）
- 提升文字质感
- 优化段落衔接
- 错别字检查

**Only call humanizer-zh once.** Do not chain multiple polish skills.

### ✅ 检查点

```
【润色结果确认】
1. 文字流畅吗？有读起来别扭的地方吗？
2. 配图位置合理吗？
3. 有需要补充的信息吗？

确认后回复"确认润色"。
```

---

## Step 4: 配图采集与最终发布确认

### 4.1 截图素材

输出截图清单，让用户手动采集：

```
【截图清单】
| # | 论断 | 来源 URL | 截图内容 |
|---|------|---------|---------|
| 1 | ... | https://... | ... |
```

用户截图后告知文件名，写入文章对应位置。

### 4.2 AI 配图

Use the image-prompt-engineer skill for cover art and illustrations.

### 4.3 封面图

- 用户有素材 → 直接使用
- 无素材 → 用 image-prompt-engineer 生成提示词
- 默认 2:3 竖版

### ✅ 最终确认（合并）

```
【最终发布确认】
标题：「XXX」
作者：XXX
主题/颜色：default / blue
内联图片：N 张
封面图：[描述]

确认后回复"确认发布"，立即发布。
```

---

## Step 5: 一键发布

Use the baoyu-post-to-wechat skill for publishing.

### 发布命令

Before publishing, ensure the baoyu-post-to-wechat script dependencies are installed:

```bash
# First time only: install script dependencies
SCRIPT_DIR=<plugin-dir>/skills/baoyu-post-to-wechat/scripts
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  bun install --cwd "$SCRIPT_DIR"
fi
```

Then publish:

```bash
bun <plugin-dir>/skills/baoyu-post-to-wechat/scripts/wechat-api.ts \
  "articles/文章标题.md" \
  --theme default \
  --color blue \
  --author "作者名" \
  --cover "imgs/封面图.png"
```

**Parameters**:
- `--theme`: default | grace | simple | modern
- `--color`: blue | green | vermilion | yellow | purple | sky | rose | olive | black | gray | pink | red | orange
- `--author`: from EXTEND.md or CLI
- `--cover`: path to cover image
- `--no-cite`: keep external links inline (default: convert to bottom citations)

### 配置要求

Before publishing, ensure:

1. **baoyu-post-to-wechat EXTEND.md** at `.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`:
   ```yaml
   default_theme: default
   default_color: blue
   default_publish_method: api
   default_author: 作者名
   ```

2. **API credentials** at `.baoyu-skills/.env`:
   ```
   WECHAT_APP_ID=your_app_id
   WECHAT_APP_SECRET=your_app_secret
   ```

3. **Bun** runtime installed (`bun --version`)

### 发布后

告知用户草稿箱链接：https://mp.weixin.qq.com → 内容管理 → 草稿箱

---

## 常见问题

| 问题 | 处理 |
|------|------|
| API 40164: invalid ip | 在 mp.weixin.qq.com → 开发 → 基本配置 → IP白名单 添加当前IP |
| bun 未安装 | `npm install -g bun` 或 https://bun.sh |
| 图片过大 (>1MB) | baoyu-post-to-wechat 自动压缩 |
