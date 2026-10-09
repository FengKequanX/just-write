# 工作流状态 v2

用于需要续作、跨步骤或多平台管理的文章项目。脚本位于本技能 `scripts/workflow-state.ts`，状态写在文章目录 `.just-write/workflow.json`。一次性小段编辑不用创建状态。

## 初始化与只读核对

```text
bun <本技能目录>/scripts/workflow-state.ts init <文章目录> --mode <mode>
bun <本技能目录>/scripts/workflow-state.ts show <文章目录>
bun <本技能目录>/scripts/workflow-state.ts verify <文章目录> --for <format|wechat|xhs|douyin>
```

mode 沿用 `full / polish / format / wechat_publish / xhs_materials / douyin_sync`。初始化只登记已发现文件，不推断阶段完成、标题确认或平台成功。有多个正文候选时，显式传入 `--draft <相对路径>` 或 `--formatted <相对路径>`，不要猜测。

`show` 始终只读，包括旧版本状态。`verify` 只核对当前动作依赖，返回缺失 `missing`、变化 `changed`、未核验 `unverified`：

- 缺失依赖先定位或补齐，再执行相关动作。
- 衍生产物依赖发生变化，重建或核对后登记新证据。
- 导入产物没有完整历史不等于必须重生成；检查当前用途和内容即可。
- 哈希漂移不撤销历史回执，也不产生新平台授权。

## 登记实际工作

```text
bun <本技能目录>/scripts/workflow-state.ts artifact <文章目录> --name <产物名> --path <相对路径> --origin <imported|generated> [--input <相对路径> ...]
bun <本技能目录>/scripts/workflow-state.ts title <文章目录> --kind <article|douyin> --value "<标题>" --lock --confirmation-source <user_instruction|user_confirmation>
bun <本技能目录>/scripts/workflow-state.ts advance <文章目录> --stage <阶段> [--complete <已实际完成阶段>]
bun <本技能目录>/scripts/workflow-state.ts platform <文章目录> --name <wechat|xhs|douyin> --status <实际状态> --result-file <结果JSON>
```

阶段沿用 `topic → draft → polish → format → assets → publish → complete`，直接任务可以从相关阶段进入。完成记录只描述实际执行的操作，不用现成文件补造全过程。

标题记录保存对应值、编辑锁和确认来源。只有用户明确换标题或解锁时使用 `--replace-locked`；普通写入不覆盖锁。来源区分 `user_instruction / user_confirmation / legacy_unverified`。`--confirmation-source` 记录本次实际确认来源，`--lock` 缺省使用 `user_confirmation`；不能用自动导入冒充用户确认。

管理产物路径须在文章目录内，拒绝绝对路径、`..` 或解析后越界。证据只快照实际管理文件及输入，不递归扫描整个目录。生成的排版稿、封面和轮播登记文章标题依赖；独立抖音文案登记已有的抖音标题依赖。显式换标题后，相关衍生产物须重新核对或生成，再用 `artifact` 登记，旧平台回执仍保留。

## 平台结果

| 平台 | 状态 |
|---|---|
| 微信 | `not_started / ready / manual_handoff / draft_saved / outcome_unknown / failed` |
| XHS | `not_started / ready / generated / failed` |
| 抖音 | `not_started / ready / dry_run / manual_handoff / published / outcome_unknown / failed` |

最近结果包含动作、账号、时间、输入摘要、回执和验证状态。验证状态为 `not_required / verified / unverified / mismatch`，与操作结果分开。微信拿到草稿 ID 但读回失败，仍记录 `draft_saved`，验证为 `unverified`；不得再次创建草稿。

浏览器只预填记为 `manual_handoff`；没有足够回执不能把进程退出成功写成 `published`。未知结果先核对。状态中不放凭证、令牌或聊天全文。

## v1 迁移

```text
bun <本技能目录>/scripts/workflow-state.ts migrate <文章目录>
```

显式迁移或首次实际写入前保存不可覆盖的 `workflow.v1.backup.json`。旧完成记录和平台声明进入 `legacy`，不转成已验证完成。旧锁保持编辑保护，确认来源为 `legacy_unverified`；旧 `published` 转为 `outcome_unknown`。

迁移只处理状态，不调用平台或重写文章。重复迁移 v2 无副作用。旧版脚本拒绝读取 v2，不自动降级。不能对真实文章批量迁移，除非本次任务已经要求该范围。
