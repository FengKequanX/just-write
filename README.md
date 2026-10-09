# just-write

> 那就开写吧——把你的想法变成可发布的文章。AI 辅助但不代替：思路是你的，表达也是你的。

Just Write 是面向 Claude Code 与 Codex 的中文内容创作插件。信息充分时直接完成写作；也支持按需协作、润色排版、本地素材及有明确授权的平台操作。

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

v1.6.0 改为按需确认、作者规则检查、v2恢复状态及明确的平台操作结果；保留统一阅读排版和最多18张的完整轮播。

```bash
codex plugin marketplace add .
codex plugin add just-write@just-write-local
```

如果仅将技能安装到项目的 `.agents/skills/`，同步时需同时将 `plugins/just-write/lib/` 复制到 `.agents/lib/`，保留两者的相对目录结构；不要复制 `node_modules`，依赖使用各脚本目录内的锁文件安装。

## 使用方式

自然描述当前任务即可。信息充分就交付；有实质歧义或明确要求协作时才确认，不需要精确口令。

```text
依据这些材料写一篇文章，不进入平台流程
只润色这篇文章，标题、数字和引语保持原样
只排版，不补标题和摘要
为这篇文章生成小红书轮播和配文，封面使用第一张图
把认可的排版稿保存到微信公众号草稿
先校验这组图片的抖音文案
```

主模块处理请求组合；子模块独立调用时完成自己的交付。写稿、标题编辑、元数据准备和平台操作分别启用。轻润色可以无需修改；不强制生成分析、材料卡或阶段报告。

## 写作与编辑

材料充分性按核心主张和文类判断，没有统一条数、篇幅或事件链门槛。概念解释可以没有亲历；机制分析可以从同一证据展开。内容始终区分事实、归因、推断及真实不确定性。

`STYLE.md` 按项目、XDG、用户目录的既有顺序读取。没有画像时使用正向中文指南，不自动推断作者性格或创建个人画像。真实或认可样本最多读取两个相关篇目。

通用句式和词形是编辑提示，不能证明文章有问题。作者明确禁令可配置为机器规则；引语、必要术语及指定内容使用绑定原稿的例外。检查器只报告，不改稿，不验证事实。

```bash
bun plugins/just-write/skills/humanizer-zh/scripts/check-prose.ts article.md --json
bun plugins/just-write/skills/humanizer-zh/scripts/check-prose.ts article.md --rules PROSE_RULES.json --exemptions exemptions.json
```

退出0表示没有未豁免作者规则错误，1表示明确规则错误，2表示运行或配置错误。`--strict` 保留一轮兼容但不升级通用提示。配置详见 [检查器规则](plugins/just-write/skills/humanizer-zh/references/checker-config.md)。

## 文章目录与状态

```text
<article-dir>/
├── <title>.md
├── <title>-formatted.md
├── imgs/
│   ├── cover.png
│   └── cover-xhs.png
├── xhs/
│   ├── 01-cover.png
│   ├── 02-content-*.png
│   ├── caption.md
│   ├── preview.html
│   └── render-report.json
├── douyin/
│   └── douyin-caption.md
└── .just-write/
    └── workflow.json
```

只在续作、跨阶段或多平台管理时启用状态。v2区分导入产物、实际执行、标题保护和平台结果；源稿变化只提示下游可能过期，不抹掉真实旧回执。

```bash
bun plugins/just-write/skills/just-write/scripts/workflow-state.ts init <article-dir> --mode xhs_materials
bun plugins/just-write/skills/just-write/scripts/workflow-state.ts show <article-dir>
bun plugins/just-write/skills/just-write/scripts/workflow-state.ts verify <article-dir> --for xhs
```

`show`始终只读。v1在显式migrate或下一次状态写入前备份；保留旧标题编辑锁，但不冒认历史确认。旧发布声明变为待核验，不重发平台。旧版不能读取v2。详见 [状态与迁移](plugins/just-write/skills/just-write/references/workflow-state.md)。

## 排版与本地预览

纯排版保留原稿，输出独立排版稿，不默认生成标题和摘要。严格保真时关闭引号和空格自动改写；Markdown标记、转义和空白允许规范化，但标题值、引语、数字、代码及链接目标必须保持。

阅读语义继续统一：普通折行属于同段，空行是新段，两个行末空格、反斜线或`<br>`表示显式换行。加粗不自动增加底色；`<mark>`表示高亮。详见 [阅读排版](plugins/just-write/skills/baoyu-format-markdown/references/reading-layout.md)。

```bash
bun plugins/just-write/skills/baoyu-post-to-wechat/scripts/wechat-preview.ts article-formatted.md --out wechat-preview.html
```

离线预览支持360/390/430px，不读取公众号凭证。客户端实际样式仍需正式草稿核对。

## 微信草稿

API专用命令为兼容默认保存草稿，agent仅在已有草稿授权下使用；准备阶段使用`--dry-run`或本地预览。浏览器入口默认只预填，`--save-draft`才保存，`--submit`是兼容别名。

```bash
bun plugins/just-write/skills/baoyu-post-to-wechat/scripts/wechat-api.ts article-formatted.md --dry-run
bun plugins/just-write/skills/baoyu-post-to-wechat/scripts/wechat-api.ts article-formatted.md --save-draft --account creator
```

API保存回执与读回核验分开。已返回草稿ID但读回失败时，报告已保存且未核验，不能重复创建。浏览器任意toast不算成功；未知结果需核对。微信模块仅保存草稿。

多账号必须唯一解析目标；未知、重复或多个默认配置报错。已选账号不无声回退全局凭证。无账号列表的旧单账号配置兼容并标注legacy。配置详见 [首次配置与多账号](plugins/just-write/skills/baoyu-post-to-wechat/references/config/first-time-setup.md)。40164按API白名单错误处理，不自动切换浏览器。

## 小红书本地素材

```yaml
# .baoyu-skills/post-to-xhs/EXTEND.md
enabled: true
default_author: 作者名
default_theme: default
default_aspect: "3:4"
default_topic_tags: 缓存,数据一致性
```

只接受上述五键。CLI优先；配置文件按项目、XDG、用户顺序取首个。话题以本文准确性为准，不强凑数量。

```bash
bun plugins/just-write/skills/post-to-xhs/scripts/md-to-xhs.ts article-formatted.md --out <article-dir>/xhs --tags 缓存,TTL --caption-body-file caption-body.txt
```

独立配文文件仅含正文；显式空文件也有效。缺省沿用frontmatter的description或summary，技能流程负责缺失文案，不回写受保护稿件。

加`--json`可输出可供工作流登记的`result`，同时保留原有顶层文件字段；日志写入stderr。生成成功不代表已完成实际视觉检查，也不会操作平台。

渲染先staging再替换受管产物。含封面最多18张，完整内容超限明确失败，不截断、不缩成不可读小字；旧产物及无关文件保留。长窄图按可读宽度连续切片。交付本地PNG、配文、预览与报告。

## 抖音操作

独立文案放在`douyin/douyin-caption.md`：

```markdown
---
publishingAdvice: 确认音乐和发布时间
---
抖音独立标题

正文

#缓存 #TTL
```

建议不上传；旧末行仅明确“发布建议：”才兼容移除，普通破折号正文保留。标题、正文和话题使用既有本地长度限制。

```bash
bun plugins/just-write/skills/sync-to-douyin/scripts/douyin-note.ts <article-dir>/xhs
bun plugins/just-write/skills/sync-to-douyin/scripts/douyin-note.ts <article-dir>/xhs --account creator --draft
bun plugins/just-write/skills/sync-to-douyin/scripts/douyin-note.ts <article-dir>/xhs --account creator --publish
```

默认只校验且不要求账号；交接或上传要求目标账号。显式模式互斥，开关不等于用户授权。`--draft`结果是manual_handoff；上传器退出0没有帖子回执时仍是outcome_unknown。

`--json`提供结构结果；平台退出码0成功，1业务失败，2运行/配置错误，3结果或内容核验待确认。

## 开发与验收

需要Bun 1.3.13及可用Chrome/Edge。依赖按锁文件安装。

```bash
bun run setup
bun run check:contracts
bun run test:unit
bun run test:render
bun run qa:render
```

`bun run test`包含unit及render。CI在Windows/Ubuntu运行结构和单元测试，Ubuntu运行渲染并保留产物。内容对照独立进行，详见 [固定案例](evals/skill-review/README.md)。本地测试不证明插件发现或真实平台成功。

1.6.0 的实施范围、固定对照、测试与视觉结果见 [验收记录](evals/skill-review/RESULTS.md)。

## 上游审阅

```bash
bash update.sh --check --skill humanizer-zh --ref <完整SHA>
```

默认只获取固定revision并生成差异，输出到忽略目录；从不覆盖技能。来源、已审阅revision、本地定制及许可审阅记录见`upstream-sources.json`。历史导入版本不明时如实保留null；人工合并并验证后更新审阅revision。
