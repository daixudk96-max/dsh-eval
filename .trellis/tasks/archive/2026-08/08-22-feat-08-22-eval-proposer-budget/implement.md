# 执行清单 —— 进化侧工程化（proposer + budget ledger + 近重复检测）

> 每步完成后勾选；验证命令与验收标准见 prd.md（AC1..AC5）。
> evolution-controller 为 CJS 零依赖，测试用 node:test 单进程模式（`node test/<file>.test.js`，
> 避开 spawn EPERM）。

## P2-1 proposal-check（新 lib/proposal-check.js）

- [x] **P2-1a** `normalizeText(text)`：去 BOM/首尾空白/空行/`#` 注释行；`normalizeFiles(files)`。
- [x] **P2-1b** `proposalCheck({ logicalId, sourceRevisionId, mutations, hypothesis, evidence, existingCandidates })`
      → `{ ok, reasons[] }`：结构 / no-change / test-only / comment-only / 假设上限 3 / 语义去重。
- [x] **P2-1c** `registry.js` 增 `revisionContent(digest)`（读 revisions/<digest>/ → { files, text }）。
- [x] **P2-1d** `controller.js` createCandidate 接门槛：先 proposal-check（失败 throw 不留 staging），
      通过后 registry.createCandidate + patchCandidate；`_revisionFiles(logicalId, revisionId)`
      经 history 解析 digest8 → 完整 digest。
- [x] **P2-1e** 测试 proposal-check.test.js（11 项：结构/缺 evidence/no-change/test-only/comment-only/
      假设上限/重复假设/语义重复/常量）——全部通过。

## P2-2 budget ledger（新 lib/budget.js）

- [x] **P2-2a** `BudgetLedger({ dir, limitUsd })`：spend(bucket, amountUsd, meta) /
      spent() / remaining() / canAfford()；append-only JSONL（同 registry WAL 模式）。
- [x] **P2-2b** controller 构造接 `budget`；newRun 检查 remaining>0；`spendBudget` 转发 + 审计事件。
- [x] **P2-2c** 测试 budget.test.js（6 项）+ controller-p2.test.js 2 项（AC3：超预算 newRun 被拒）——通过。

## P2-3 近重复检测（新 lib/near-dup.js）

- [x] **P2-3a** `nearDuplicate(history, readRevision, candidateFiles)`：
      归一化内容 hash 比较；返回 { isDup, of }。
- [x] **P2-3b** controller.promote 增量：默认检查（AC4），`nearDuplicateCheck:false` 可关；
      审计事件 `promote-near-duplicate`。
- [x] **P2-3c** 测试 controller-p2.test.js 近重复/新内容两条 + controller-rubric 回归——通过。

## P2-4 真实闭环（AC5）

- [x] **P2-4a** 基于 current evaluate-8b9b3f03 做一轮: 变异(失败簇输出指令)→ proposal-check 通过
      (hypothesis+evidence)→ seal evaluate-5dab277e → 真实评测(clipa)超时(65 步/83 工具调用全成功
      但 590s>600s 预算)→ gate FAIL(regression in: correctness, verification)→ REJECTED,
      current 不动(诚实拒绝, 无伪造提升)。**顺带修 gate 顺序 bug: 回归优先于 minEffect**。
- [x] **P2-4b** 近重复候选(内容=最旧 previous evaluate-dab4f200)→ ACCEPTED 后 promote 被拒
      (near-duplicate of evaluate-dab4f200)。
- [x] **P2-4c** budget 演示: spend 到 limit(1 USD)→ newRun 被拒(evolution budget exhausted)。
- [x] **P2-4d** evolution-plan.md 勾选 P2; README 增 Proposal/Budget/Near-dup 三节;
      absorbed-from 注释内嵌(proposal-check←dsh-self-evolving; near-dup←dsh-continual-evolve;
      budget←dsh-self-evolving)。

## 验证命令

```bash
node packages/evolution-controller/test/proposal-check.test.js
node packages/evolution-controller/test/budget.test.js
node packages/evolution-controller/test/controller-p2.test.js
node packages/evolution-controller/test/controller.test.js   # 回归
node research/evolution-p2.mjs                                # 真实闭环（新脚本）
```

## 收尾

- [ ] git commit 分批；/trellis:finish-work
