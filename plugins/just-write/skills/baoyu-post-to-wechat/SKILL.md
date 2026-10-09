---
name: baoyu-post-to-wechat
description: 将已有 Markdown、HTML 或贴图内容准备到微信公众平台并按授权保存草稿，核对账号、素材和实际结果。支持离线预览、API 草稿及浏览器预填；保存草稿与公开发布分开报告。
---

# 微信草稿与预览

处理已有内容，不默认重写文章或标题。用户已经授权保存到指定账号草稿箱时直接推进；只有目标、操作或内容有实质歧义时确认，不要求固定口令。事实和指定保护项遵循 [共用内容契约](../just-write/references/content-contract.md)。

## 选择当前动作

| 动作 | 入口 | 默认 |
|---|---|---|
| 离线手机预览 | `scripts/wechat-preview.ts` | 不需要账号或凭证，不调用 API |
| API 保存文章／图文草稿 | `scripts/wechat-api.ts` | 为兼容默认保存草稿；仅已有明确草稿授权时执行 |
| 浏览器文章预填 | `scripts/wechat-article.ts` | 只预填；`--save-draft` 才保存 |
| 浏览器贴图预填 | `scripts/wechat-browser.ts` | 只预填；`--save-draft` 才保存 |

保存草稿不代表公开发布。浏览器预填本身也是外部操作，必须属于当前请求。API `--dry-run` 为离线解析预览；执行草稿保存时显式传 `--save-draft`，兼容默认不能当作授权来源。

- 初次配置或缺少当前动作的必需项：读 [首次设置](references/config/first-time-setup.md)。无 EXTEND 不强迫设置，离线预览不需要凭证。
- 长文 API／浏览器操作：读 [文章处理](references/article-posting.md)。
- 多图短文／贴图：读 [贴图处理](references/image-text-posting.md)。
- 登录、白名单、保存或核验问题：读 [错误恢复](references/troubleshooting.md)。

## 核对输入与账号

读取首个存在的 EXTEND：项目 `.baoyu-skills/baoyu-post-to-wechat/EXTEND.md` → XDG（未设置时 `~/.config`）→ 用户 `~/.baoyu-skills/baoyu-post-to-wechat/EXTEND.md`。

显式 `--account` 必须有效。唯一账号或唯一默认账号可以沿用；实际操作有多个候选且无默认时必须选定。重复别名、多个默认及未知别名报错。无账号列表时兼容 legacy 单账号；离线预览可以不选账号。

已选账号使用本账号的完整凭证来源，不回退另一账号的全局凭证。密码与令牌不回显、不写入产物或状态。浏览器账号采用独立登录配置，并在操作前核对界面目标。

字段优先级为 CLI → frontmatter → 账号默认 → 全局默认 → 程序默认。作者、主题、颜色及评论字段只在适用入口使用，不提前填默认遮盖配置。路由由用户选择或已存在默认决定；未指定时可以优先 API，API 失败不自动切换浏览器。

## 准备与本地阅读检查

唯一现有标题可沿用，用户指定标题原样保留；frontmatter 与 H1 冲突时先解决。摘要从已有字段或正文准确概括，不新增事实，不静默截断。缺字段时按 [元数据准备](../baoyu-format-markdown/references/metadata.md) 处理，保护整稿则使用独立文件或显式参数。

API 文章封面依次取显式 `--cover`、frontmatter 封面字段、`imgs/cover.png`，没有指定封面时才考虑首张正文图。用户指定第一张就使用该张，不能优化替换；不拿 `cover-xhs.png` 代替。正文图片必须完整可用。

新稿或排版有变化时运行：

```text
bun <本技能目录>/scripts/wechat-preview.ts <稿件.md> --out <预览.html> [--theme <主题>] [--color <颜色>] [--no-cite]
```

遵循 [手机阅读规则](../baoyu-format-markdown/references/reading-layout.md)，在 360／390／430px 检查文字、背景、字体、段落、强调、图注及长图可读性。报告 warning 帮助定位，不能授权改写正文。预览不模拟客户端全部过滤，真实草稿仍需读回核对。

## 执行与结果

传入 Markdown 让平台脚本完成转换、图片上传和替换，不把本地预览 HTML 当成已完成的发布输入。`--submit` 是浏览器 `--save-draft` 的兼容别名。平台脚本可用 `--json` 提供结构结果，日志写 stderr。

| 结果 | 报告 |
|---|---|
| API 有效草稿 ID | 已保存草稿，随后报告读回验证情况 |
| 浏览器明确保存回执 | 已保存草稿；任意 toast、按钮未找到或等待结束不算成功 |
| 浏览器仅预填 | 已预填待交接 `manual_handoff` |
| 保存是否发生无法判断 | `outcome_unknown`，先核对，不重复创建 |
| 明确拒绝 | `failed`，报告业务错误和当前恢复动作 |

读回核对标题、正文语义和图片／封面身份；失败或不一致保留保存事实，分别标记 `unverified / mismatch`。退出码：0 成功，1 明确业务失败，2 参数／运行错误，3 结果或验证待核验。

交付账号、实际动作、结果、必要回执及文件链接。不要固定使用“发布完成”描述草稿或预填，也不默认拓展到其他平台。