# just-write

> 那就开写吧——把你的想法变成可发布的文章。AI辅助但不代替，你的思路，你的表达。

## 安装

```bash
# 1. 添加市场
/plugin marketplace add https://github.com/FengKequanX/just-write

# 2. 安装插件
/plugin install just-write
```

发布时 Agent 自动安装脚本依赖，无需手动操作。

## 前置条件

| 依赖 | 说明 |
|------|------|
| **bun** | `npm install -g bun` 或 https://bun.sh |
| **WeChat API 凭证** | 用于公众号发布（不发布则不需要） |
| **浏览器** | 用于小红书扫码登录（Chromium） |

## 配置公众号发布

### 1. 获取 API 凭证

登录 https://mp.weixin.qq.com → 开发 → 基本配置 → 复制 AppID 和 AppSecret

### 2. 配置 IP 白名单

同一个页面 → IP 白名单 → 添加当前 IP

（API 发布时如果报 `40164: invalid ip`，回来这里添加新 IP 即可）

### 3. 保存凭证

在项目根目录创建 `.baoyu-skills/.env`：

```
WECHAT_APP_ID=你的AppID
WECHAT_APP_SECRET=你的AppSecret
```

### 4. （可选）偏好设置

创建 `.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`：

```yaml
default_theme: default
default_color: blue
default_publish_method: api
default_author: 你的作者名
need_open_comment: 1
only_fans_can_comment: 0
```

主题选项：`default` / `grace` / `simple` / `modern`

## 配置小红书发布

### 1. 扫码登录

首次发布时，脚本会打开浏览器并显示小红书创作者平台的登录二维码，使用小红书 App 扫码即可。

登录状态通过 Chrome Profile 持久化保存，后续发布无需重复扫码。

### 2. （可选）偏好设置

创建 `.baoyu-skills/post-to-xhs/EXTEND.md`：

```yaml
default_author: 作者名
default_theme: default
default_aspect: "3:4"
default_topic_tags: AI观察,科技,编程
default_caption_style: 干货型
dry_run: false
browser_profile_path: ~/.baoyu-skills/xhs-chrome-profile
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `default_author` | — | 作者名，显示在封面和结尾页 |
| `default_theme` | `default` | 主题样式，目前支持：`default` |
| `default_aspect` | `"3:4"` | 图片比例，可选：`3:4` / `9:16` / `1:1` / `4:3` |
| `default_topic_tags` | — | 话题标签，逗号分隔 |
| `default_caption_style` | `干货型` | 标题风格：`干货型` / `种草型` / `故事型` |
| `dry_run` | `false` | 仅生成图片不发布到平台 |
| `browser_profile_path` | 自动 | Chrome Profile 路径（用于登录态持久化） |

### 3. 图片生成说明

小红书内容以图片卡片形式发布，脚本会自动将 Markdown 文章渲染为：
- **封面页** — 文章标题 + 副标题 + 作者 + 品牌标记
- **内容页** — 按 H2 章节分页，溢出按段落自动拆分，支持内嵌图片
- **结尾页** — 互动引导 + 话题标签 + 作者

渲染使用 Chrome headless 截图（需 Chrome ≥ 112），发布使用 Playwright 浏览器自动化。

生成的图片保存在输出目录（`[文章标题]-xhs/`），也可通过 `dry_run: true` 仅预览不发布。

## 文章目录结构

每篇文章独立文件夹管理：

```
[文章标题]/
├── [文章标题].md              # 润色后的文章
├── [文章标题]-formatted.md    # 排版优化后的最终版本（用于发布）
└── imgs/                     # 该文章的所有图片和封面
```

## 使用

直接告诉 Claude：

> 帮我写一篇关于DeepSeek V4的公众号文章

或 slash 命令：

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

当前支持：**微信公众号**、**小红书**。

## 内置技能

| 技能 | 上游 | 用途 |
|------|------|------|
| brainstorming | 改造自 [obra/superpowers](https://github.com/obra/superpowers) | 选题讨论 |
| humanizer-zh | [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) | 去 AI 写作痕迹 |
| baoyu-format-markdown | [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) | 排版优化 + 标题生成 + CJK 排版 |
| baoyu-post-to-wechat | [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) | 微信公众号发布 |
| post-to-xhs | 内置 | 小红书发布 |

## 更新

```bash
bash update.sh
```

## License

MIT
