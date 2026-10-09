# 检查器配置与单次例外

只有运行检查器、作者有机器规则或需要保护特定片段时读取。自然语言 `STYLE.md` 不由脚本自动解析，示例配置也不自动生效。

## 命令与结果

```text
bun <本技能目录>/scripts/check-prose.ts <文件|-> [--rules <JSON文件>] [--exemptions <JSON文件>] [--json]
```

`-` 从 stdin 读取。无规则时形态命中仅为 warning；显式作者规则产生未豁免 error 才阻断。退出码：0 检查完成且无阻断，1 作者规则错误，2 参数／配置／读写错误。没有可检查中文时返回 0，并标记 `scanned:false`。

诊断含 `ruleId`、类别、等级、原文位置、命中片段和处理提示；传统统计字段保留。`--strict` 只发兼容弃用提示。通过不能证明事实、来源或文章效果已核验。

## 作者规则

格式见 [author-rules.example.json](author-rules.example.json)，仅在作者明确提出对应规则后复制并修改：

```json
{
  "schemaVersion": 1,
  "forbiddenTerms": ["赋能"],
  "forbiddenPatterns": ["pivot.not_but"],
  "forbiddenPunctuation": ["—"],
  "allowedTerms": ["闭环控制"],
  "disabledSignals": []
}
```

各列表可以省略。无任意自定义正则。允许词保护完整术语，完全相同的允许与禁止项视为配置冲突。`disabledSignals` 只能关通用提示，不能隐藏作者明确禁令。

可用句式 ID：

| ID | 形态 |
|---|---|
| `pivot.not_but` | 不是……而是…… |
| `pivot.not_rather` | 并非……而是…… |
| `pivot.not_in_but_in` | 不在于……而在于…… |
| `pivot.rather_than` | 与其说……不如说…… |
| `pivot.not_only` | 不只……还／也…… |
| `pivot.surface_actual` | 表面……实际／其实／实则…… |
| `pivot.seems_actual` | 看似……实际／其实／实则…… |
| `phrase.road_sign` | 段落路标短语 |

可关闭提示还包括 `term.jargon / term.hard_stop / term.context_jargon / punctuation.colon / punctuation.dash / signal.soft_markers / signal.left_branch / signal.dense_de / signal.short_paragraph_ratio / signal.short_streak / signal.repeated_opener / signal.metaphor_cluster`。具体命中以脚本诊断为准，不在文档复制整套词库。

## 真实引语和指定保留片段

例外是单次文件，必须绑定原文摘要：

```json
{
  "schemaVersion": 1,
  "documentSha256": "<原文UTF-8内容的SHA-256>",
  "spans": [
    {"start": 20, "end": 38, "kind": "quote", "reason": "用户要求保留的真实引语"}
  ]
}
```

`kind` 为 `quote / term / preserved`。start 包含、end 不包含，按原始文本 UTF-16 索引，不预先改变换行。先从实际原文计算摘要与位置，不直接使用上述模板数值。摘要不符或范围非法返回配置错误；改稿后重新生成例外。

引号与 Markdown 引用块只提示候选，不自动证明是真实引语。例外理由来自明确保留要求、可核验原话或必要术语，而不是为了让检查归零。Frontmatter、代码、URL 等非正文部分按脚本屏蔽，但不能靠把正文包成引用绕过作者规则。