# 首次设置与账号配置

仅在当前动作缺少运行条件，或用户请求配置时读取。离线预览不需要登录、API 凭证或 EXTEND；没有偏好文件不阻断其他已具备条件的动作。

## 可选偏好

EXTEND 搜索顺序：项目 `.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`、XDG 目录（未设置时 `~/.config`）的 `baoyu-skills/baoyu-post-to-wechat/EXTEND.md`、用户 `~/.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`。首个文件生效。

```yaml
default_theme: default
default_publish_method: api
need_open_comment: 1
only_fans_can_comment: 0
accounts:
  - name: 示例公众号
    alias: creator
    default: true
    default_author: 作者名
    default_theme: default
    chrome_profile_path: /path/to/isolated/profile
```

主题有 `default / grace / simple / modern`。颜色可以使用程序支持的预设或 hex，未设置时沿用主题默认。作者、主题、颜色、路线及评论偏好可以有账号覆盖值，CLI 和适用 frontmatter 优先。账号示例仅用于结构，不创建用户配置。

## API 凭证

当前动作要保存 API 草稿时才检查凭证。用户在微信公众平台取得 AppID／AppSecret，并配置对应 IP 白名单。让用户在适当的本地凭证位置填写；不要要求把秘密粘到公开稿件或普通日志。

已选 `creator` 账号使用成对来源，按账号内 `app_id / app_secret`、环境变量、项目 `.baoyu-skills/.env`、用户 `~/.baoyu-skills/.env` 解析。外部键使用 `WECHAT_CREATOR_APP_ID / WECHAT_CREATOR_APP_SECRET`；别名大写、连字符变下划线。一个来源只存在半对时报错，不与其他来源拼接，也不回退未带账号前缀的凭证。

无 `accounts` 时 legacy 单账号兼容 `WECHAT_APP_ID / WECHAT_APP_SECRET` 的完整来源。未知账号不能当成单账号。凭证文件不得提交到版本库。

## 浏览器条件

需要 Chrome 和公众号登录会话。可用 `WECHAT_BROWSER_CHROME_PATH` 指定实际 Chrome 路径。每个账号使用独立 profile，检查当前页面确实对应目标公众号；不复制另一账号的登录目录来绕过选择。

`scripts/check-permissions.ts` 可以按需要帮助诊断 Chrome、Bun、剪贴板和系统权限，不作为所有离线任务的前置步骤。工具缺失时说明实际缺项与安装位置需要，不自动切换用户指定路线。