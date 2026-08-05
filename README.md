# just-write

> 那就开写吧——把你的想法变成可发布的文章。AI 辅助但不代替：思路是你的，表达也是你的。

Just Write 是面向 Claude Code 与 Codex 的中文内容创作插件。它保留严谨的公众号完整工作流，也允许直接润色、排版、生成小红书素材或同步抖音图文。

## 安装

### Codex App

在任意本地任务中告诉 Codex：

> 请从 GitHub marketplace `FengKequanX/just-write` 安装插件 `just-write@just-write-local`，并确认插件已启用。

也可以使用 Codex CLI：

```bash
codex plugin marketplace add FengKequanX/just-write
codex plugin add just-write@just-write-local
```

安装或更新后新建一个任务，使新的 skills 生效。

### Claude Code

```text
/plugin marketplace add https://github.com/FengKequanX/just-write
/plugin install just-write
```

### 本地开发

```bash
codex plugin marketplace add .
codex plugin add just-write@just-write-local
```

## 使用方式

自然描述目标即可：

```text
帮我写一篇关于 AI Agent 的公众号文章
只润色这篇文章，不要进入发布流程
把这篇 Markdown 排版并给出标题候选
为这篇文章生成小红书轮播图素材
先 dry-run 检查这组轮播图的抖音发布参数
把排版稿保存到微信公众号草稿箱
```

“写一篇文章”进入完整模式，也可以用 `/start-jw 主题` 直接启动；意图明确的加工或发布请求直接进入对应能力，不再强制从选题重新开始。

写作时优先读取项目的个人风格档案，动笔前先过材料关卡，初稿只带正向目标，修稿阶段才按固定次序清理 AI 痕迹，最后由确定性脚本兜底检查。详见下文「写作质量体系」。

## 完整工作流

```text
选题讨论 → 内容生成 → 中文润色 → 排版与标题 → 配图确认 → 微信发布
```

| 步骤 | 确认词 |
|---|---|
| 选题讨论 | `确认选题` |
| 内容生成 | `确认内容` |
| 润色 | `确认润色` |
| 排版与标题 | `确认排版：X号` |
| 微信发布 | `确认发布微信` |
| 抖音真实上传 | `确认发布抖音` |

微信公众号仍是完整模式的主发布链。微信成功后，可按配置继续生成小红书素材，再选择是否 dry-run 或发布抖音。小红书始终只生成素材，不会自动打开或控制创作者平台。

## 写作质量体系

v1.4.0 融合了 [KKKKhazix/human-writing](https://github.com/KKKKhazix/human-writing)（活人感写作，MIT）的方法，把去 AI 味从「句式清理」升级为四层治理：材料门禁、正向写法、有序修稿、确定性检查。

### 材料关卡

写 1,200 字以上的非虚构长文前，必须先在内部列出至少 5 件有出处的具体材料（用户原话或可核验来源），且能组成一条实际过程。列不出就不产长稿，只有三种处理：有公开材料先研究再计数；依赖用户亲历时一次最多问 3 个问题；不许追问时收缩成 600 字左右短稿。目标字数和催促不能把材料变多。这一条挡住了「三条抽象观点灌成十二段」这个最大的 AI 味来源。

### 正向中文写法

初稿阶段只加载正向目标（`writing-style/references/chinese-prose.md`）：说话位置、按读者的下一个问题推进、句子主干前置、顺势接话、留白、白话打底。禁令清单在动笔前不加载，避免模型带着一长串「不许」写出僵硬回避的稿子。

### 七遍修稿

初稿完成后按 `writing-style/references/quality-check.md` 的固定次序修，先救人再清句子：看谁在说、看文章有没有往前走（含压缩试验：删掉三分之一后几乎没变，就保留短版）、拆表演性中文、听中文词序，第五遍才加载 `humanizer-zh` 清硬禁项，随后核事实、查结尾（删掉最后两段分别再读）。七遍之后跑四层审计出验收报告。

### 确定性检查器

```bash
bun plugins/just-write/skills/humanizer-zh/scripts/check-prose.ts 稿件.md
```

正则硬查翻案句（「不是……而是……」等七组变形）、商业黑话（赋能、抓手、闭环、底层逻辑等 28 词）、硬停词、模型路标和正文破折号，命中即失败（exit 1）。短段鼓点、重「的」长句、借喻堆叠、语境判断词等列为警告，留给人工判断。正文句中的冒号默认只警告，小标题、列表项和对话引出处豁免，加 `--strict` 升级为失败。代码块、行内代码、链接和 frontmatter 自动屏蔽不参与检查。硬禁词表与 `humanizer-zh` 文档逐字一致，由测试断言保证不漂移。

## 文章目录与断点恢复

每篇文章使用独立目录：

```text
[文章标题]/
├── [文章标题].md
├── [文章标题]-formatted.md
├── imgs/
│   ├── cover.png              # 微信公众号封面
│   └── cover-xhs.png          # 小红书轮播图封面
├── xhs/
│   ├── 01-cover.png
│   ├── 02-content-*.png
│   ├── NN-ending.png
│   └── caption.md
├── douyin/
│   └── douyin-caption.md
└── .just-write/
    └── workflow.json
```

`workflow.json` 记录阶段、锁定标题、产物相对路径和各平台状态，不保存正文、Cookie、AppSecret 等敏感信息。换任务或换 Agent 后，Just Write 会读取它继续工作；状态引用的文件缺失时会停止并报告漂移，不会猜测。

文章标题原样用于原稿、排版稿、微信和小红书。抖音使用 `douyin-caption.md` 中的独立短标题，不会回写文章标题。

封面约定固定为 `imgs/cover.png`（微信公众号）和 `imgs/cover-xhs.png`（小红书）。两个平台不会互相回退使用另一张封面；如果缺少各自封面，则使用该平台自己的无封面兜底逻辑。

## 依赖

| 依赖 | 用途 |
|---|---|
| Bun 或 Node.js/npm | 运行 TypeScript 脚本；无 Bun 时可用 `npx -y bun` |
| Chrome / Edge ≥ 112 | 小红书渲染和浏览器发布 |
| 微信公众号 API 凭证 | 使用公众号 API 保存草稿 |
| uv（可选） | 安装 `social-auto-upload`，用于抖音自动上传 |

## 微信公众号配置

在文章工作目录创建 `.baoyu-skills/.env`：

```dotenv
WECHAT_APP_ID=你的AppID
WECHAT_APP_SECRET=你的AppSecret
```

可选配置 `.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`：

```yaml
default_theme: default
default_color: blue
default_publish_method: api
default_author: 作者名
need_open_comment: 1
only_fans_can_comment: 0
```

API 报 `40164: invalid ip` 时，在微信公众平台的开发配置中更新 IP 白名单。

## 小红书素材配置

创建 `.baoyu-skills/post-to-xhs/EXTEND.md`：

```yaml
enabled: true
default_author: 作者名
default_theme: default
default_aspect: "3:4"
default_topic_tags: AI观察,科技,编程
```

只接受上面五个键。v1.3.0 不兼容旧的宽高比键和 dry-run 配置；发现已移除或未知键时会直接给出迁移错误。

CLI 参数优先于配置文件。项目配置优先于 XDG 配置和用户目录配置。

独立生成命令：

```bash
bun plugins/just-write/skills/post-to-xhs/scripts/md-to-xhs.ts "[文章标题]/[文章标题]-formatted.md" --out "[文章标题]/xhs"
```

渲染先写入临时目录，全部成功后才替换 `xhs/` 中受管的编号 PNG 和 `caption.md`，避免失败或页数变少时留下旧页面；无关文件不会被删除。

小红书默认读取文章目录内的 `imgs/cover-xhs.png`。如需显式覆盖，可在 frontmatter 使用 `xhsCoverImage`；不会读取公众号的 `imgs/cover.png`。

## 抖音同步配置

抖音上传基于 [social-auto-upload](https://github.com/dreammis/social-auto-upload)。建议安装到文章项目的 `.baoyu-skills/`：

```powershell
git clone https://github.com/dreammis/social-auto-upload.git .baoyu-skills/social-auto-upload
cd .baoyu-skills/social-auto-upload
uv venv
uv pip install -e .
copy conf.example.py conf.py
.venv\Scripts\patchright.exe install chromium
.venv\Scripts\sau.exe douyin login --account creator
```

可选配置 `.baoyu-skills/sync-to-douyin/EXTEND.md`：

```yaml
enabled: true
default_account: creator
```

`enabled` 只控制完整工作流是否主动询问抖音同步，不能绕过真实发布确认。

每篇文章必须单独准备 `douyin/douyin-caption.md`：

```markdown
抖音独立标题

正文

#话题1 #话题2

— 发布建议：确认音乐和发布时间。
```

抖音标题不超过 20 字，正文不超过 1,000 字，话题不超过 5 个且话题内部不能有空格。

```powershell
# 只校验，不发布
bun plugins/just-write/skills/sync-to-douyin/scripts/douyin-note.ts "[文章标题]/xhs" --account creator --dry-run

# 用户明确确认后发布
bun plugins/just-write/skills/sync-to-douyin/scripts/douyin-note.ts "[文章标题]/xhs" --account creator
```

## 配置优先级

各能力独立保存配置，并使用统一优先级：

```text
CLI 参数 > 项目 .baoyu-skills/<skill>/EXTEND.md > XDG 配置 > 用户目录配置 > 默认值
```

## 个人写作风格

可在项目中创建 `.baoyu-skills/writing-style/STYLE.md`，定义账号定位、作者姿态、证据边界、常用文章原型和代表文章路径。完整写作流程会在初稿前加载该档案，七遍修稿全程保持作者姿态，最后用四层审计检查文章是否还像作者本人。

风格层不会编造个人经历或情绪，也不会强制禁用小标题、列表等正常表达工具。它优先检查事实与推断边界、主线推进、证据质量和作者声音。

## 开发与验证

```bash
bun run setup
bun test
bun run check:contracts
```

同步上游 companion skills：

```bash
bash update.sh
```

## 内置能力

| Skill | 用途 |
|---|---|
| `just-write` | 意图路由、完整流程和断点状态 |
| `brainstorming` | 选题讨论 |
| `humanizer-zh` | 中文负向模式字典与确定性检查器（check-prose） |
| `writing-style` | 材料关卡、正向中文写法、个人文风与七遍修稿 |
| `baoyu-format-markdown` | 标题生成和 Markdown 排版 |
| `baoyu-post-to-wechat` | 微信公众号草稿发布 |
| `post-to-xhs` | 小红书轮播图与文案素材 |
| `sync-to-douyin` | 抖音图文校验与上传 |

## 致谢

- [KKKKhazix/human-writing](https://github.com/KKKKhazix/human-writing)（MIT）：材料关卡、中文正向写法、七遍修稿与检查脚本的方法来源，详见 `plugins/just-write/THIRD_PARTY_NOTICES.md`
- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、blader/humanizer、hardikpandya/stop-slop：`humanizer-zh` 的模式基础
- [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills)：`baoyu-format-markdown` 与 `baoyu-post-to-wechat` 的上游

## License

MIT
