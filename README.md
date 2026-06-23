# just-write

> 那就开写吧——把你的想法变成可发布的文章。AI辅助但不代替，你的思路，你的表达。

## 安装

### Codex App

Codex App 目前不能在 Plugins 页面中直接搜索尚未添加的第三方 GitHub marketplace。

推荐方式：打开 Codex App 中的任意本地线程，把下面这句话发送给 Codex：

> 请从 GitHub marketplace `FengKequanX/just-write` 安装插件 `just-write@just-write-local`，并确认插件已启用。

Codex 执行本地命令时可能会请求权限，确认即可。安装完成后新建一个线程，just-write 才会出现在新的会话中。

手动安装：如果系统终端中可以使用 `codex` 命令，打开 PowerShell 或 Terminal，执行：

```bash
codex plugin marketplace add FengKequanX/just-write
codex plugin add just-write@just-write-local
```

如果提示找不到 `codex` 命令，请使用上面的 App 对话安装方式，或先按照 [Codex CLI 官方文档](https://developers.openai.com/codex/cli) 安装 CLI。

如果只执行了第一条命令，请重启 Codex App，然后打开 **Plugins**，选择 **Just Write Local**，再安装 **just-write**。

更新插件时，也可以直接告诉 Codex：

> 请更新 `just-write@just-write-local` 到 GitHub 上的最新版本，并确认插件已启用。

或手动执行：

```bash
codex plugin marketplace upgrade just-write-local
codex plugin remove just-write@just-write-local
codex plugin add just-write@just-write-local
```

### Codex 本地开发

克隆仓库后，在仓库根目录执行：

```bash
codex plugin marketplace add .
codex plugin add just-write@just-write-local
```

修改插件源码后，执行以下命令刷新安装：

```bash
codex plugin remove just-write@just-write-local
codex plugin add just-write@just-write-local
```

插件源文件位于 `plugins/just-write/`。安装或更新后请新建一个 Codex 线程，使新的 skills 生效。

### Claude Code

```bash
# 1. 添加市场
/plugin marketplace add https://github.com/FengKequanX/just-write

# 2. 安装插件
/plugin install just-write
```

运行相关功能时，Agent 会按需安装脚本依赖。

## 前置条件

| 依赖 | 说明 |
|------|------|
| **bun 或 npx** | 推荐安装 bun：`npm install -g bun`；已有 Node.js/npm 时也可通过 npx 运行 |
| **WeChat API 凭证** | 用于公众号发布（不发布则不需要） |
| **Chrome / Edge** | ≥ 112，用于浏览器发布和小红书图片渲染 |
| **uv（可选）** | 用于安装 `social-auto-upload`，开启抖音图文自动发布 |

## 配置公众号发布

### 1. 获取 API 凭证

登录 https://mp.weixin.qq.com → 开发 → 基本配置 → 复制 AppID 和 AppSecret

### 2. 配置 IP 白名单

同一个页面 → IP 白名单 → 添加当前 IP

（API 发布时如果报 `40164: invalid ip`，回来这里添加新 IP 即可）

### 3. 保存凭证

在你使用 just-write 写文章的工作目录中创建 `.baoyu-skills/.env`：

```
WECHAT_APP_ID=你的AppID
WECHAT_APP_SECRET=你的AppSecret
```

### 4. （可选）偏好设置

在同一工作目录中创建 `.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`：

```yaml
default_theme: default
default_color: blue
default_publish_method: api
default_author: 你的作者名
need_open_comment: 1
only_fans_can_comment: 0
```

主题选项：`default` / `grace` / `simple` / `modern`

## 配置小红书素材生成

### 1. （可选）偏好设置

在文章工作目录中创建 `.baoyu-skills/post-to-xhs/EXTEND.md`：

```yaml
default_author: 作者名
default_theme: default
default_aspect: "3:4"
default_topic_tags: AI观察,科技,编程
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `default_author` | — | 作者名，显示在封面和结尾页 |
| `default_theme` | `default` | 主题样式，目前支持：`default`（Quiet Observer 暖色编辑风） |
| `default_aspect` | `"3:4"` | 图片比例，可选：`3:4` / `9:16` / `1:1` / `4:3` |
| `default_topic_tags` | — | 话题标签，逗号分隔 |

### 2. 图片生成说明

小红书内容以轮播图形式发布，脚本自动将 Markdown 文章渲染为 PNG 图片：

- **封面页** — 使用文章 frontmatter 中的 `coverImage`（兜底读取 `cover.png` 或 `imgs/cover.png`）+ 文章标题 + 作者。封面图放入 **4:3** 视觉框，前景图片完整显示、不裁切；非 4:3 图片使用同图柔和背景补足版面。
- **内容页** — 按文章顺序连续排版，H2/H3 标题作为页内标题显示。分页基于浏览器真实布局测量，文字像正文阅读流一样连续铺排；当前页达到可用高度后再进入下一页，最后一页按剩余内容自然收尾。正文使用适合手机阅读的较大字号、紧凑行距和固定中英文小间距，避免两端对齐把空格拉散。
- **图片处理** — 内容页图片放入统一正文宽度的白底图框，图片本体完整显示、不裁切。分页按图片真实尺寸和最终图框高度测量；当前页放不下整张图时，图片作为整体进入下一页，避免上一页空、下一页溢出。
- **结尾页** — 感谢阅读 + 话题标签 + 作者

渲染使用 Chrome/Edge 原生 `--headless=new` 截图（需 ≥ 112），无需 Playwright。

生成的图片和文案保存在输出目录（`[文章标题]-xhs/`）。

### 3. 手动发布

图片生成后，打开 [小红书创作者平台](https://creator.xiaohongshu.com/publish/publish) 手动上传图片，从生成的 `caption.md` 复制完整标题和文案。

just-write 不会打开或控制小红书创作者平台，也不会代替用户上传、填写或点击发布。文章最终标题一经确认，轮播图和 `caption.md` 会原样复用，不做平台化缩写。

## 配置抖音自动发布

抖音发布基于社区项目 [social-auto-upload](https://github.com/dreammis/social-auto-upload) 的浏览器自动化能力，将小红书轮播图目录同步发布为抖音图文。小红书仍保持手动发布。

### 1. 安装上传工具

推荐安装到文章项目的 `.baoyu-skills/` 目录，避免污染插件源码：

```powershell
mkdir .baoyu-skills
git clone https://github.com/dreammis/social-auto-upload.git .baoyu-skills/social-auto-upload
cd .baoyu-skills/social-auto-upload
uv venv
uv pip install -e .
copy conf.example.py conf.py
.venv\Scripts\patchright.exe install chromium
```

如果 `patchright install chromium` 使用镜像源失败，可直接使用默认官方下载源重试。

### 2. 登录抖音账号

```powershell
cd .baoyu-skills/social-auto-upload
.venv\Scripts\sau.exe douyin login --account creator
.venv\Scripts\sau.exe douyin check --account creator
```

`creator` 是本地账号别名，可替换为任意名称。

### 3. 发布抖音图文

先用 `post-to-xhs` 生成小红书轮播图目录，然后把该目录交给 `sync-to-douyin`：

```powershell
bun plugins/just-write/skills/sync-to-douyin/scripts/douyin-note.ts "[文章标题]-xhs" --account creator
```

脚本会自动读取目录内的 `*.png` 和 `caption.md`，用第一行作为标题，提取 `#话题` 作为抖音标签，并调用 `sau douyin upload-note` 发布图文。

安全起见，首次使用可以先 dry-run：

```powershell
bun plugins/just-write/skills/sync-to-douyin/scripts/douyin-note.ts "[文章标题]-xhs" --account creator --dry-run
```

## 文章目录结构

每篇文章独立文件夹管理：

```
[文章标题]/
├── [文章标题].md              # 润色后的文章
├── [文章标题]-formatted.md    # 排版优化后的最终版本（用于发布）
└── imgs/                     # 该文章的所有图片和封面
```

排版优化阶段确认最终标题后，文章文件夹和同名 Markdown 文件会同步改为最终标题名称；`imgs/` 目录保持不变。

生成截图来源清单时，优先使用官方公告、原始论文、产品文档、公司博客、财报/监管文件、当事人社交媒体等第一方来源。

## 使用

直接告诉 Claude Code 或 Codex：

> 帮我写一篇关于DeepSeek V4的公众号文章

Claude Code 也可以使用 slash 命令：

```
/just-write:start-jw 想写什么
```

## 设计哲学

**AI是拐杖不是腿。** 每一步都等你确认——选题你定，内容可反复修正，标题你选——AI助你落地想法，你才是作者。

## 工作流

```
选题讨论 → 内容生成 → AI去痕润色 → 排版优化(含标题生成) → 配图 → 发布
```

每一步都有检查点，确认后才进入下一步：

| 步骤 | 确认词 |
|------|--------|
| 选题讨论 | 确认选题 |
| 内容生成 | 确认内容 |
| 润色 | 确认润色 |
| 排版优化 | 确认排版：X号 |
| 配图与发布 | 确认发布 |

当前支持：**微信公众号发布**、**小红书素材生成**、**抖音图文自动发布**。

## v1.2.0

- 新增 `sync-to-douyin` skill，可将小红书轮播图目录自动发布为抖音图文。
- 接入 `social-auto-upload` 的 `sau douyin upload-note` 命令，支持账号别名、dry-run、标题/正文/标签解析。
- 明确发布边界：小红书仍只生成素材并手动发布，抖音可在用户确认后自动发布。

## v1.1.0

- 新增 Codex 插件清单和仓库级 marketplace，可通过 Codex CLI 安装。
- 调整为 `plugins/just-write/` 标准插件目录，同时兼容 Claude Code 和 Codex。
- 将工作流中的专用工具调用改为跨 Agent 的 companion skill 表述。
- 修正 skills frontmatter，使全部 6 个 skills 通过 Codex 校验。
- 更新 `update.sh`，让上游技能同步继续写入新的插件目录。

## 内置技能

| 技能 | 上游 | 用途 |
|------|------|------|
| brainstorming | 改造自 [obra/superpowers](https://github.com/obra/superpowers) | 选题讨论 |
| humanizer-zh | [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) | 去 AI 写作痕迹 |
| baoyu-format-markdown | [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) | 排版优化 + 标题生成 + CJK 排版 |
| baoyu-post-to-wechat | [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) | 微信公众号发布 |
| post-to-xhs | 内置 | 小红书轮播图与文案素材生成 |
| sync-to-douyin | 内置，基于 [social-auto-upload](https://github.com/dreammis/social-auto-upload) | 抖音图文自动发布 |

## 开发者：同步上游技能

```bash
bash update.sh
```

## License

MIT
