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

## 使用

直接告诉 Claude：

> 帮我写一篇关于DeepSeek V4的公众号文章

或 slash 命令：

```
/just-write:just-write 想写什么
```

## 设计哲学

**AI是拐杖不是腿。** 每一步都等你确认——选题你定，标题你选，内容可反复修正——AI助你落地想法，你才是作者。

## 工作流

```
选题 → 标题 → 内容生成与修正 → AI去痕润色 → 配图 → 一键发布
```

当前支持：**微信公众号**。计划支持：小红书、抖音。

## 内置技能

| 技能 | 上游 |
|------|------|
| brainstorming | [obra/superpowers](https://github.com/obra/superpowers) |
| viral-title | 内置 |
| humanizer-zh | [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) |
| image-prompt-engineer | 内置 |
| baoyu-post-to-wechat | [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) |

## 更新

```bash
bash update.sh
```

## License

MIT
