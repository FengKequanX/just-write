---
name: humanizer-zh
description: 编辑已写中文文本中的空泛、重复、绕句和套路表达，同时保留事实、作者语气及必要术语。用于局部修稿或表达审阅；初稿写作使用 writing-style。
metadata:
  trigger: 编辑或审阅已有中文文本
  source: Wikipedia Signs of AI writing、blader/humanizer、hardikpandya/stop-slop、KKKKhazix/human-writing（MIT）
---

# 中文表达修稿

找到实际影响理解的片段，做相称修改。通用模式只是线索，不能证明文本来自 AI，也不能代替内容审阅。未发现具体问题时保留原文。

## 处理顺序

1. 读当前任务和全文，确定是保真润色、重写还是只读审阅。
2. 检查空泛抬高、含混归因、重复解释、绕句和不合语境的表达。按需读 [分类问题表](references/patterns.md)。
3. 只修改确有问题的片段；核对数字、限定、来源、因果、原话和作者声音。
4. 有规则冲突时读 [共用内容契约](../just-write/references/content-contract.md)。需要正向写法时读 [中文散文](../writing-style/references/chinese-prose.md)，不凭空加“人味”。
5. 交付修订文本或审阅建议。只报告影响结果的改动；不默认打分或再跑一套文章全审计。

对比句、三项列举、短句、连接词和破折号按实际作用判断。真实三步不可为了句型变化改成两步或四步；必要术语、真实引语、有材料支撑的简洁判断可以保留。自然节奏不依赖句长变化配额。

改句难以判断是否守住内容时，读 [保真示例](references/examples.md)。示例只能提供编辑方法，不得移用其中事实或细节。

## 作者规则与检查器

通用词形、句式和标点扫描默认仅提示。作者明确禁令严格约束自创正文；真实引语、必要术语和指定保留片段的例外必须有依据，不能只因带引号就豁免。

长稿保存后、用户要求机器检查或存在作者规则时，可以运行：

```text
bun <本技能目录>/scripts/check-prose.ts <稿件.md> [--rules <规则.json>] [--exemptions <例外.json>] [--json]
```

先读 [检查器配置](references/checker-config.md)，只传明确规则。无需把通用提示全部清零。`--strict` 仅保留兼容弃用提示，不升级风格命中；检查成功不证明事实核验或“去 AI”成功。

---

问题识别思路参考 Wikipedia Signs of AI writing、blader/humanizer、hardikpandya/stop-slop，以及 KKKKhazix/human-writing（MIT）。按中文编辑任务重新组织，删除形式配额和不保真的示例。