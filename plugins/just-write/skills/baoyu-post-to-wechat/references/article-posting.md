# 微信文章处理

处理 Markdown／HTML 长文草稿时读取。API 专用命令默认保存草稿，执行前必须已有该账号草稿授权；浏览器默认只预填。

## 字段与排版

适用字段采用 CLI → frontmatter → 账号默认 → 全局默认 → 程序默认。CLI 仅传实际覆盖项；不要无条件传 `--theme default` 盖掉已有设置。默认主题为 `default`，颜色未设置时由主题决定。

- 标题来自明确参数、frontmatter 或一致的正文 H1。冲突需解决，不能以首句猜出新标题。
- 摘要接受已有 digest／summary／description 或显式 `--summary`；本地摘要上限 120，超限明确报错，不截断保护内容。
- 作者使用实际字段，不从内容猜身份。
- 评论默认 `need_open_comment: 1`、`only_fans_can_comment: 0`，按适用覆盖值解析并写入 API 载荷。
- API news 草稿需要封面。用户已指定封面时不得替换，缺少可用图片先解决。

Markdown 外部链接默认转换成文末引用；`--no-cite` 保留普通链接内联。引用标题、来源与编号按原有关系保持，不新增不存在的引用编号。已有 HTML 不额外做 Markdown 引用转换。

共用手机阅读规则见 [reading-layout.md](../../baoyu-format-markdown/references/reading-layout.md)。主题样式与图片适应由渲染器承担，不用修改正文来填版面。

## API

```text
bun <本技能目录>/scripts/wechat-api.ts <稿件.md> --dry-run [--account <别名>]
bun <本技能目录>/scripts/wechat-api.ts <稿件.md> --save-draft [--account <别名>] [--theme <主题>] [--color <颜色>] [--cover <封面>] [--summary <摘要>] [--json]
```

`--dry-run` 离线解析并渲染，不加载必需凭证或调用平台。`--save-draft` 明示兼容默认保存动作，两者不能作为重复或歧义操作组合。

脚本自行转换 Markdown，上传正文图片并替换资源，再保存草稿。正文或封面无法准备时不要用不完整内容保存。返回有效草稿 ID 后读回；核对标题、正文语义和图片／封面身份。有效 ID 是已保存证据，读回失败不能触发第二次 `draft/add`。

## 浏览器文章

```text
bun <本技能目录>/scripts/wechat-article.ts --markdown <稿件.md> [--account <别名>]
bun <本技能目录>/scripts/wechat-article.ts --markdown <稿件.md> --save-draft [--account <别名>] [--json]
bun <本技能目录>/scripts/wechat-article.ts --html <稿件.html> [--save-draft]
```

`--submit` 保留为 `--save-draft` 别名。没保存开关时不得点击保存，结果为待交接。保存后只接受明确结果；任意提示、空 toast 或等待一段时间不能认定成功。

平台结果与验收分开：已保存但无法核对为 `draft_saved + unverified`；核对内容不符为 `draft_saved + mismatch`。网络中断且保存可能已发生时为 `outcome_unknown`，先查草稿列表或读回。错误恢复见 [troubleshooting.md](troubleshooting.md)。