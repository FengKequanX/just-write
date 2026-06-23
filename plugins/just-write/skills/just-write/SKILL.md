---
name: just-write
description: >-
  Trigger immediately when the user wants to write, create, edit, format, or
  publish content, including requests such as "写一篇关于 XX 的文章"、"帮我写 XX"、
  "把这个想法写成文章"、"润色一下"，以及其他内容创作需求。
---

# 微信公众号内容创作工作室

把你的想法变成可发布的文章。支持全流程：选题讨论 → 内容生成 → 润色 → 排版优化(含标题) → 配图与发布 → 发布。

---

## MANDATORY RULES

这些规则覆盖本文件中的所有其他指令。违反任何一条 = 工作流失败。

1. **MANDATORY 每次回复开头标注当前步骤。** 格式：`[Step N: 步骤名]`。这让跳步对用户可见。每个 Step 的 label：
   - `[Step 1: 选题讨论]`
   - `[Step 2: 内容生成]`
   - `[Step 3: 润色]`
   - `[Step 4: 排版优化]`
   - `[Step 5: 配图与发布确认]`
   - `[Step 6: 发布]`

2. **MANDATORY 每个 Step 结束后输出检查点块，然后停下来等用户说确认词。** 不能自己判断"差不多就过了"。确认词表：

   | 步骤 | 确认词 |
   |------|--------|
   | Step 1 | `确认选题` |
   | Step 2 | `确认内容` |
   | Step 3 | `确认润色` |
   | Step 4 | `确认排版：X号` |
   | Step 5 | `确认发布` |

3. **MANDATORY 每个 Step 使用对应的 companion skill，不要自己手动替代。** 当前 Agent 应加载并遵循同一插件中的对应 skill：
   - Step 1 → `brainstorming`
   - Step 3 → `humanizer-zh`
   - Step 4 → `baoyu-format-markdown`
   - Step 6 → `baoyu-post-to-wechat`

4. **MANDATORY 写文章时每个事实性论断同步写入图片占位符。** 数据、引用、新闻事件必须带 `![描述](imgs/xxx.png)`。纯个人观点不需要。写完后再补 = 失败。

5. **MANDATORY "确认内容"后立即输出截图来源清单。** 不能等用户问。格式见 Step 2。

6. **MANDATORY 配图来源优先使用第一方来源。** 截图来源清单优先列官方公告、原始论文、产品文档、公司博客、当事人社交媒体、财报/监管文件等原始出处；只有第一方不可用或不足以证明时，才使用权威媒体、数据库或二手整理，并说明原因。

7. **MANDATORY 不重启已完成步骤。** 如果用户在前一轮对话中已经完成了某步，从下一个未完成的步骤继续。

8. **MANDATORY "确认排版：X号"后立即同步最终标题到目录和文件名。** 这是 Step 4 到 Step 5 的交接动作，必须在配图检查前完成。用用户确认的标题生成安全文件名，并重命名文章文件夹及同名 Markdown 文件；后续所有路径都必须使用新名称。

9. **MANDATORY 用户确认标题后锁定标题。** `确认排版：X号` 或用户明确确认自定义标题后，该标题是全文和所有平台素材的唯一最终标题。后续 frontmatter、正文 H1、目录名、文件名、微信公众号标题、小红书封面标题和 `caption.md` 必须保持一致；不得为了平台字数、点击率、SEO 或“更适合平台”擅自缩写、改写或另拟标题。只有用户明确要求修改标题时才可变更，并重新同步所有相关文件。

10. **MANDATORY 小红书只准备素材，不执行发布。** 用户要求“同步小红书”“发小红书”或类似操作时，只加载 `post-to-xhs` 生成轮播图和 `caption.md`。不得打开小红书创作者平台，不得上传图片、填写表单或点击发布；完成后把素材目录交给用户手动发布。

11. **MANDATORY 抖音发布使用独立确认。** 抖音图文自动发布只能消费已经生成的小红书轮播图目录，并加载 `sync-to-douyin` companion skill。未获得用户明确确认前只能 dry-run；不得把抖音自动发布规则套用到小红书。

---

## 工作流

```
用户想法 → 选题讨论 → 内容生成(迭代) → 润色 → 排版优化(含标题) → 配图与发布确认 → 发布
  Step 1    Step 2     Step 3       Step 4         Step 5          Step 6
```

---

## Step 1: 选题讨论

**必须加载并遵循 `brainstorming` companion skill 辅助选题。** 该 skill 会一次问一个问题（最多 3 个），帮用户理清主题和角度。

**快速通道：** 如果用户已经明确说了主题和角度，直接确认选题，不需要再问。

核心引导：
1. 读者关心吗？（痛点/痒点/爽点至少占一个）
2. 有独特视角或真实经历吗？
3. 现在写合适吗？（时效性）

### 检查点（必须输出）

```
【选题确认】
- 文章主题：...
- 核心观点：...
- 目标读者：...

确认后回复"确认选题"。
```

---

## Step 2: 内容生成

支持多轮修正——用户可以反复提出修改意见，每次修改后重新输出检查点。

### 前置调研

涉及近期事件、产品或数据时：
1. 使用当前 Agent 可用的联网搜索工具查最新信息，优先官方公告和一手来源，必要时再参考可靠媒体
2. 验证事实后再写
3. **不凭记忆写——先搜索**

### 图文一体（硬性要求）

写每句话时，立即判断：这句话是否包含事实性论断？如果是，立即写 `![描述](imgs/xxx.png)` 占位符。

| 论断类型 | 配图 |
|---------|------|
| 数据/排名 | benchmark 截图 + 来源 URL |
| 引用原文 | 原文截图 + 页码 |
| 新闻事件 | 媒体报道截图 |
| 专家观点 | 采访原文/社交媒体截图 |
| 个人观点 | 通常不需要 |

正例：
> Cursor 最近发了一份《开发者习惯报告》，周均代码产出从 3.6K 行涨到 8.6K 行。![Cursor 开发者习惯报告数据](imgs/03-cursor-report.png)

反例（写完再补）：
> Cursor 最近发了一份《开发者习惯报告》，周均代码产出从 3.6K 行涨到 8.6K 行。
> ~~（写完整篇文章后才想起来要加图片占位符）~~

### 事实争议处理

用户质疑事实时：重新搜索 → 逐项报告「已验证/需修正/无法确认」→ 修正 → 重新确认。

硬伤直接改；方向正确的保留但加限定词；无法确认的删除。

### 写作风格

理性、克制、有判断、不说教。
- 先说问题，再讲道理
- 少煽动，多判断
- 数字 + 参照系 + 具体场景
- 承认局限增加信任
- 倒金字塔（结论先行）
- 每段不超过 3 行（手机阅读）

### 检查点（必须输出）

```
【文章内容确认】
- 主题：...
- 核心观点：...
- 图片占位符：N 张（列出每个占位符和对应论断）
- 待确认数据：...

确认后回复"确认内容"。
```

### 截图来源清单（"确认内容"后立即输出）

**用户说"确认内容"后的第一个动作就是输出这个清单。**

**来源优先级：** 第一方原始来源优先。按顺序选择：官方公告 / 产品文档 / 公司博客 / 论文原文 / 财报或监管文件 / 当事人社交媒体 → 权威媒体报道 → 数据库或二手整理。使用非第一方来源时，在「截图要点」里说明为什么不用第一方来源。

```
【截图来源清单】
| # | 文中位置 | 来源 URL | 截图要点 |
|---|---------|---------|---------|
| 1 | ![图1](imgs/xxx.png) | https://... | 截取包含XX的部分 |
```

- 每个占位符必须有对应来源
- URL 必须是调研阶段验证过的真实链接
- 优先使用第一方 URL，避免用聚合页、搬运图、营销号截图替代原始来源
- 截图要点要具体（"截取表格第3行"而非"截取页面"）

用户可以边截图边等润色完成。

---

## Step 3: 润色

**前置条件：用户必须已说出"确认内容"。** 未确认前不得执行润色。

**必须加载并遵循 `humanizer-zh` companion skill 润色文章。** 不要自己手动替代。

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

## Step 4: 排版优化

**前置条件：用户必须已说出"确认润色"。** 未确认前不得执行排版。

**必须加载并遵循 `baoyu-format-markdown` companion skill 进行排版优化。** 不要自己手动替代。

调用 skill 时，自动选择"优化排版"选项，不询问用户选择排版模式。

该 skill 会：
1. 分析内容结构，识别关键亮点和排版问题
2. 生成 4-5 个标题候选（基于内容，比写前生成更精准）
3. 应用格式优化（标题层级、加粗重点、列表化）
4. 运行 CJK 排版脚本（中英间距、标点修正）
5. 输出 `{filename}-formatted.md`

### 微信标题硬性规则

标题选择时额外强制执行以下规则：

1. **微信禁忌词**（任何标题候选不得包含）：震惊！、刚刚！、必看！、99%的人不知道、太可怕了、不看后悔一辈子、刚刚曝光
2. **热点关键词**：标题必须包含至少一个具体人名/公司名/模型名/热门事件名。纯抽象概念或比喻 = 不合格。
3. **字数限制**：标题最大 ~30 字符（微信信息流截断线）

### 检查点（必须输出）

```
【排版结果确认】
- 标题候选：
  1.「...」（类型）
  2.「...」（类型）
  3.「...」（类型）
- 排版文件：{filename}-formatted.md
- 排版改动摘要：加粗 N 处 / 新增标题 N 个 / 列表化 N 处
- 标题确认后动作：将目录和文件名同步为所选标题

确认后回复"确认排版：X号"。
```

用户确认后，所选标题立即进入锁定状态。除非用户明确要求改标题，否则后续任何步骤和平台都不得生成替代标题。

---

## Step 5: 配图与发布确认

### 5.0 标题落盘同步（进入 Step 5 的第一个动作）

**触发条件：用户刚刚说出 `确认排版：X号`。**

在检查配图素材前，必须先完成：

1. 从用户确认的编号中取出最终标题；如果用户给的是自定义标题，使用自定义标题。
2. 生成文件系统安全名称：
   - 删除 Windows/macOS/Linux 路径非法字符：`< > : " / \ | ? *`
   - 去掉换行、首尾空格、末尾句点
   - 连续空格压缩为一个空格
3. 将当前文章目录从最初选题名改为最终标题名。
4. 将目录内同名文件同步改名：
   - `{旧名}.md` → `{最终标题}.md`
   - `{旧名}-formatted.md` → `{最终标题}-formatted.md`
   - `{旧名}-analysis.md` → `{最终标题}-analysis.md`（如果存在）
5. 保留 `imgs/` 目录及其中图片路径不变。
6. 如果目标目录或目标文件已存在，停止并向用户说明冲突，不覆盖任何文件。
7. 后续 Step 5/Step 6 的 `排版文件`、发布命令、小红书渲染输入，都必须使用重命名后的路径。
8. 将最终标题写入原稿 H1 和排版稿 frontmatter；后续平台素材完整复用该标题，不做平台化改写。

### 5.1 截图素材

截图来源清单已在 Step 2 输出。用户按清单保存截图到 `imgs/`。检查目录确认文件到齐。

如果用户新增了论断需要配图，更新截图清单。

### 5.2 AI 配图

根据文章主题生成英文 AI 绘图提示词：
- 风格与文章调性一致
- 主体突出、构图简洁
- 格式：`Prompt: [英文] | Negative: [避免元素]`

### 5.3 封面图

- 用户有素材 → 直接用
- 无素材 → 生成封面图提示词（默认 2:3 竖版）

### 检查点（必须输出）

```
【最终发布确认】
标题：「...」
作者：...
主题/颜色：default / blue
排版文件：{filename}-formatted.md
内联图片：N 张
封面图：[描述]

确认后回复"确认发布"。未回复确认发布前不得执行任何发布操作。
```

---

## Step 6: 发布

用户说"确认发布"后执行。

### 6.1 微信公众号

**必须加载并遵循 `baoyu-post-to-wechat` companion skill 发布。**

发布时使用排版后的文件 `{filename}-formatted.md` 作为输入。

### 6.2 小红书（可选）

微信发布后，检查 `.baoyu-skills/post-to-xhs/EXTEND.md` 的 `enabled` 配置：
- `enabled: true` → 询问用户是否生成小红书素材
- 用户确认后加载并遵循 `post-to-xhs` companion skill，只生成轮播图和 `caption.md`
- 不打开小红书创作者平台，不上传、不填写、不点击发布

### 6.3 抖音（可选）

小红书素材生成后，询问用户是否同步发布到抖音：
- 用户确认后加载并遵循 `sync-to-douyin` companion skill
- 使用小红书轮播图输出目录作为输入，读取其中的 PNG 和 `caption.md`
- 未确认直接发布时，只运行 `--dry-run`
- 抖音通过 `social-auto-upload` 的浏览器自动化发布，失败时保留素材并提示用户检查登录状态

### 发布后

- 微信：告知草稿箱链接 https://mp.weixin.qq.com → 内容管理 → 草稿箱
- 小红书：告知素材目录和 `caption.md` 路径，由用户手动发布
- 抖音：告知使用的账号别名、图片数量、标题和发布结果

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

发布命令（使用排版后的文件）：
```bash
bun <plugin-dir>/skills/baoyu-post-to-wechat/scripts/wechat-api.ts \
  "[文章标题]/[文章标题]-formatted.md" \
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

### 排版优化依赖

安装依赖：
```bash
SCRIPT_DIR=<plugin-dir>/skills/baoyu-format-markdown/scripts
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  bun install --cwd "$SCRIPT_DIR"
fi
```

### 小红书素材生成

安装依赖：
```bash
SCRIPT_DIR=<plugin-dir>/skills/post-to-xhs/scripts
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  bun install --cwd "$SCRIPT_DIR"
fi
```

生成命令：
```bash
bun <plugin-dir>/skills/post-to-xhs/scripts/md-to-xhs.ts "[文章标题]/[文章标题]-formatted.md"
```

### 抖音图文发布

安装 `social-auto-upload`：
```powershell
mkdir .baoyu-skills
git clone https://github.com/dreammis/social-auto-upload.git .baoyu-skills/social-auto-upload
cd .baoyu-skills/social-auto-upload
uv venv
uv pip install -e .
copy conf.example.py conf.py
.venv\Scripts\patchright.exe install chromium
```

登录和检查抖音账号：
```powershell
cd .baoyu-skills/social-auto-upload
.venv\Scripts\sau.exe douyin login --account creator
.venv\Scripts\sau.exe douyin check --account creator
```

dry-run：
```powershell
bun <plugin-dir>/skills/sync-to-douyin/scripts/douyin-note.ts "[文章标题]-xhs" --account creator --dry-run
```

确认后发布：
```powershell
bun <plugin-dir>/skills/sync-to-douyin/scripts/douyin-note.ts "[文章标题]-xhs" --account creator
```

### 配置文件

**baoyu-post-to-wechat EXTEND.md**（`.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`）：
```yaml
default_theme: default
default_color: blue
default_publish_method: api
default_author: 作者名
```

**baoyu-format-markdown EXTEND.md**（`.baoyu-skills/baoyu-format-markdown/EXTEND.md`）：
```yaml
auto_select_title: false
auto_select_summary: false
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
