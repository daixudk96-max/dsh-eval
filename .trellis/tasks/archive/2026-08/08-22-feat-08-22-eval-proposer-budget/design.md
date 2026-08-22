# 设计文档 —— 进化侧工程化（proposer + budget ledger + 近重复检测）

## 1. 模块边界

```
packages/evolution-controller/lib/
├── proposal-check.js   # 新：候选质量门槛（确定性代码判定）
├── budget.js           # 新：预算账本（append-only JSONL，分桶）
├── near-dup.js         # 新：近重复内容归一化检测
├── controller.js       # 增量：createCandidate 接门槛 + promote 接近重复 + newRun 接预算
└── gate.js             # 不变
packages/preset-registry/lib/
└── registry.js         # 增量：revisionContent(digest) 读修订内容（供近重复比较）
```

依赖方向不变：controller → registry / proposal-check / budget / near-dup；零新依赖（CJS）。

## 2. proposal-check：候选质量门槛（照 dsh-self-evolving specs/03 §9）

`createCandidate(runId, {logicalId, sourceRevisionId, mutations, hypothesis, evidence})`：

| 检查 | 规则 | 拒绝消息 |
|---|---|---|
| 结构 | `hypothesis` 非空字符串，`evidence` 非空数组（引用 run 的 failure clusters） | `proposal needs hypothesis and evidence` |
| no-change | 全部文件内容与 sourceRevision 完全一致 | `proposal is a no-change copy of <revisionId>` |
| test-only | 变化的文件全部匹配 `test|spec` 路径段 | `proposal changes only tests` |
| comment-only | 剔除注释行（trim 后以 `#` 开头）后与 source 一致 | `proposal changes only comments` |
| 假设上限 | run 内已登记 hypothesis 去重后 ≤ W_p=3 | `run already has 3 distinct hypotheses` |
| 语义去重 | 归一化内容（normalizeText）与 run 内其他候选一致 | `duplicate of candidate <id>` |

`normalizeText(text)`：去 BOM、去首尾空白、逐行 trim 后剔空行与 `#` 注释行（.md/.yml 通用），join('\n')。

实现：`proposalCheck({ logicalId, sourceRevisionId, mutations, hypothesis, evidence, existingCandidates })` →
`{ ok, reasons[] }`。其中 sourceRevision 内容与 candidate 内容都从 registry 读取：
- source：`registry.revisionContent(sourceRevisionId)`（revisionId = `<logicalId>-<digest8>`，解析出 digest 后读 revisions/<digest>/）；
- candidate：mutations 在当前 staging/<candidateId>/ 下的文件（与 demo 一致：createCandidate 先建 staging 骨架，内容文件由调用方写入）。

controller.createCandidate 在 registry.createCandidate 前先跑 proposal-check，失败即 throw（run 状态不变）。

## 3. budget ledger

```
lib/budget.js:
  new BudgetLedger({ dir, limitUsd })
  spend(bucket, amountUsd, meta) → 记录 {ts, bucket, amountUsd, runId, meta}（append-only）
  spent() → { proposal, attempt, failed, total }
  remaining() → limit - total
  canAfford(bucket, amount) → boolean
```

- 分桶：`proposal`（候选生成）、`attempt`（一次评测 trial 成本）、`failed`（失败消耗；不计入可用预算但入账）。
- 成本由**外部注入**（run.json 的 costUsd / 调用方显式传入），ledger 永不读取候选自报数字。
- controller 构造 `new EvolutionController({ registry, auditDir, budget: { dir, limitUsdents } })`；
  `newRun()` 时若 `budget.remaining() <= 0` → 拒绝创建 run（`evolution budget exhausted`）。
  controller 提供 `spendBudget(bucket, amountUsd, meta)` 转发到 ledger（审计事件 `budget`）。

## 4. 近重复检测（promote 前）

- **完全重复**：registry 内容寻址天然保证——digest 相同即内容相同；promote 时若
  `candidateDigest` 已存在于历史 revisions（history() 列表）→ 拒绝（`promote is a near-duplicate of <revisionId>`）。
- **近重复**（注释/空白不同）：`near-dup.js` 对 revision 内容做 `normalizeText` 后取 sha256，
  与候选归一化 hash 比较；命中历史任一 revision → 拒绝。
- 默认开启；`promote(runId, {logicalId, approvalId, nearDuplicateCheck: false})` 可关闭（测试/特殊场景）。
- 实现：registry 增 `revisionContent(digest)`（读 revisions/<digest>/ 所有文件 → { files, text }）；
  controller.promote 在 registry.promote 前比较 candidate 内容（staging/<candidateId>/ 已 seal 进 revisions，
  比较对象用 `registry.revisionContent(sealDigest)` 的 files）与历史 digest 内容。

## 5. 权衡

| 取舍 | 选择 | 理由 |
|---|---|---|
| 门槛放 controller 而非 registry | controller | registry 只管存储语义；进化规则在控制器（审计伴随） |
| 近重复默认开 | 开 | 防无用 promote；显式关闭留逃生口 |
| budget 单位 | USD（浮点） | 与 dsh-eval costUsd 对齐；精度够账本用 |
| 语义去重键 | 归一化内容 hash | 与近重复同一工具，规则一致 |

## 6. 风险

- 内容读取路径：revisions/<digest>/ 的文件布局由 seal 决定（manifest + 内容文件），revisionContent 只读不动。
- proposal-check 与 mutation 写入时序：createCandidate 需先拿到 staging 内容——设计为 controller 先
  registry.createCandidate（骨架）+ 写文件 + patchCandidate，然后 proposal-check；check 失败则抛错，
  候选留在 staging 未 seal（可 gcCandidates 清）。
