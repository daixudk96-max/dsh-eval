# M3 治理核心（evolution-controller）

## Goal

自研确定性治理核心：Candidate 全生命周期状态机、**Code-owned Gate**（PASS/FAIL/INCONCLUSIVE/INVALID 四态）、经 `preset-registry` 的 CAS promote、用户确认绑定、append-only 审计。Controller 独占 promote/rollback；不生成语义评测结论。

## Requirements

- **R1 状态机**：`DRAFT → SEALED → EVALUATING → ACCEPTED | REJECTED | INCONCLUSIVE → PROMOTED | FAILED`；`DRAFT` 可写、`SEALED` 后内容与父 Revision 不可改、非法迁移拒绝。
- **R2 Epoch 绑定**：Candidate 绑定 EvaluationEpoch id；Gate 判定时校验 Epoch 未变。
- **R3 Code Gate**（无 LLM 自证，代码判定）：
  ```
  accept = candidate.overall > baseline.overall + minEffect
      AND correctness/safety/verification 非回归
      AND criticalAssertionsPassed AND criticalFailures == 0
      AND perCaseRegressionWithinTolerance
      AND canaryPassed AND digestVerified AND epochUnchanged
      AND blindHoldoutPassed            // M6 接入，本任务预留接口
  ```
  结果：PASS / FAIL / INCONCLUSIVE / INVALID（协议失败，如 digest 漂移）。
- **R4 Promote 事务**：调用 `preset-registry.promote()` 的 CAS 事务；`approvalId` 绑定用户确认事件（`approval/asked → decided`）；pre-commit 重新校验 Candidate digest 与 baseline revision。
- **R5 审计**：每个决策 append 到 `ledger/`（before/after、理由、证据 refs、gateRunId、approvalId）。
- **R6 规则版本化**：Gate ruleSet 版本化并绑定 Epoch；禁止静默改规则（改动 → 新 ruleSet + 新 Epoch）。
- **R7 canary**：用 benchmark 子集先跑（dsh-eval），canary 失败不 Promote。

## Acceptance Criteria

- [ ] 状态机全路径单测通过（含非法迁移被拒绝）。
- [ ] Gate 四态判定正确（构造 baseline/candidate 伪 run 的单元测试）。
- [ ] 统计不显著 → INCONCLUSIVE，不 Promote（可加采样重跑）。
- [ ] promote 前置校验 digest/epoch/approvalId 全部一致才放行；任一不一致拒绝。
- [ ] 每个决策 append 审计 ledger，含 before/after 与证据 refs。
- [ ] evolver 无 current 写权限（经 Host capability 层强制，集成测试）。

## Out of Scope

- 评测执行本身（M1 eval-adapter 提供 run）。
- blind holdout 完整隔离与 paired 统计（M6 接入接口，本任务只预留）。

## Dependencies

- 依赖 `preset-registry`（CAS promote/rollback、Candidate staging）。
- 依赖 `eval-adapter-spike`（Validation run 输入）。

## 参考

- 父任务 `design.md` §2.4（evolution-controller）、§2.3（evolution-core mutation）、ADR D8、数据契约 `EvolutionRun`。
