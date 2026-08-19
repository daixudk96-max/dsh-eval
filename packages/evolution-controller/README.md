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

- `newRun({ source, triggerEvaluationRunId, selectedFailureClusters })`
- `createCandidate(runId, { logicalId, sourceRevisionId, mutations })` — staging
- `seal(runId)` — DRAFT → SEALED（不可变 revision）
- `evaluate(runId, { baseline, candidate, gateOverrides })` — 四态判定
- `resample(runId)` — INCONCLUSIVE → EVALUATING
- `promote(runId, { logicalId, approvalId })` — 仅 ACCEPTED + approvalId；CAS 经 registry

## 保证

- Controller 不生成语义评测结论；Gate 为代码。
- 每个决策 append 审计（created/candidate-created/sealed/gate/promoted/resample）。
- Promote 前置校验：状态=ACCEPTED、approvalId 存在、CAS expectedCurrent 匹配、digest/epoch 一致。
- 错误决策只写审计，不自动改 current。

## 测试

```powershell
node --test
```
覆盖：状态机合法/非法迁移、Gate 四态、完整 happy path（seal→PASS→promote）、
INCONCLUSIVE 不可 promote 且可重采样、approvalId 必填、审计 append、CAS 竞态拒绝。
