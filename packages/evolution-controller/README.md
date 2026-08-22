# evolution-controller

DeepSeek Harness **Eval + Evolution** 系统的治理核心（M3）：
Candidate 生命周期状态机、**Code-owned Gate**（PASS/FAIL/INCONCLUSIVE/INVALID 四态）、
经 preset-registry 的 CAS promote（绑定用户 approvalId）、append-only 审计 ledger。

纯 CommonJS、零外部依赖、node:test 测试（`node --test`）。

## 状态机

```
DRAFT → SEALED → EVALUATING → ACCEPTED → PROMOTED
                          ↘ REJECTED | INCONCLUSIVE (→ EVALUATING) | INVALID
```

## Code Gate（`lib/gate.js`，纯函数）

```js
accept = candidate.overall > baseline.overall + minEffect
    AND correctness/safety/verification 非回归
    AND criticalAssertionsPassed AND criticalFailures == 0
    AND perCaseRegression <= tolerance AND canaryPassed AND blindHoldoutPassed
    AND digestOk AND epochSame
```

无 LLM 自证；确定性事实全由代码判定。`INCONCLUSIVE` 不 Promote（可采样重跑）。

## Controller API（`lib/controller.js`）

- `newRun({ source, triggerEvaluationRunId, selectedFailureClusters })` — 超预算时拒绝
- `createCandidate(runId, { logicalId, sourceRevisionId, hypothesis, evidence, mutations, readCandidateFiles })`
  — staging；过 proposal-check 才写
- `seal(runId)` — DRAFT → SEALED（不可变 revision）
- `evaluate(runId, { baseline, candidate, gateOverrides, rubric })` — 四态判定
- `resample(runId)` — INCONCLUSIVE → EVALUATING
- `promote(runId, { logicalId, approvalId, nearDuplicateCheck })` — 仅 ACCEPTED + approvalId；
  CAS 经 registry；默认近重复拒绝

## Proposal 质量门槛（`lib/proposal-check.js`，P2）

候选必须绑定可证伪 `hypothesis` + `evidence`（引用失败簇）；确定性拒绝：
**no-change**（与 source 归一化内容一致）、**test-only**、**comment-only**、
同一 run 超过 **W_p=3** 个不同主假设、语义重复（归一化内容 hash 与 run 内已有候选一致）。
吸收自 timwhitez/dsh-self-evolving 的 proposer 协议（失败证据→多假设候选）。

## Budget ledger（`lib/budget.js`，P2）

append-only JSONL，分桶 `proposal` / `attempt` / `failed`；金额由外部注入（如评测 costUsd），
不信候选自报；`newRun` 在预算耗尽时拒绝。构造：`new EvolutionController({ registry, auditDir, budget: { dir, limitUsd } })`。

## 近重复检测（`lib/near-dup.js`，P2）

promote 前把候选归一化内容与全部历史 revision 比较；命中即拒（审计事件 `promote-near-duplicate`）。
吸收自 ZK-Andy/dsh-continual-evolve 的 `promotion.ts`。默认开启，`nearDuplicateCheck: false` 显式关闭。

## 保证

- Controller 不生成语义评测结论；Gate 为代码。
- 每个决策 append 审计（created/candidate-created/sealed/gate/promoted/resample/proposal-rejected/budget/promote-near-duplicate）。
- Promote 前置校验：状态=ACCEPTED、approvalId 存在、CAS expectedCurrent 匹配、digest/epoch 一致、非近重复。
- 错误决策只写审计，不自动改 current。

## 测试

```powershell
node test/controller.test.js        # 回归（7）
node test/proposal-check.test.js    # 门槛 11 项
node test/budget.test.js            # 账本 6 项
node test/controller-p2.test.js     # 集成 6 项（budget 拦截 / 近重复拒绝 / proposal 拒绝）
```
覆盖：状态机合法/非法迁移、Gate 四态、完整 happy path（seal→PASS→promote）、
INCONCLUSIVE 不可 promote 且可重采样、approvalId 必填、审计 append、CAS 竞态拒绝、
proposal 质量门槛、预算耗尽、近重复拒绝。
