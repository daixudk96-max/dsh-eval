# M3 evolution-controller —— 技术设计

> 以父任务 `design.md` §2.3 / §2.4 / §4 为权威；本文件只列本子任务范围内的实现要点。

## 1. 状态机

```
DRAFT → SEALED → EVALUATING → ACCEPTED → PROMOTED
                          ↘ REJECTED
                          ↘ INCONCLUSIVE（→ 采样重跑 → 回 EVALUATING）
                          ↘ INVALID（协议失败，如 digest 漂移）
```

- `SEALED` 后：内容 + 父 Revision 引用不可改（预设 registry 只读区保证）。
- 非法迁移（如 DRAFT→PROMOTED）抛错并写审计。

## 2. Code Gate

- 输入：`{ baseline: EvaluationRun, candidate: EvaluationRun, epochId, ruleSetVersion, canaryRun?, holdoutResult? }`。
- 判定纯代码（无 LLM 自证）：
  - overall 提升 > `minEffect`
  - correctness/safety/verification 非回归
  - criticalAssertions 全过 && criticalFailures == 0
  - perCaseRegression 在容差内
  - canary 通过（benchmark 子集）
  - digest 校验（candidate revision == EvaluationRun subject）
  - Epoch 未变
  - holdout 预留位（M6 接入）
- 输出 `PASS | FAIL | INCONCLUSIVE | INVALID`；INCONCLUSIVE 不 promote，可触发采样重跑。

## 3. Promote 事务

- 前置：重新校验 digest / epoch / approvalId（与 CAS 参数一致）。
- 调用 `preset-registry.promote({ expectedCurrent, targetRevision, candidateDigest, gateRunId, approvalId })`。
- 失败（CAS 冲突 / 校验失败）→ 记审计，不重试自动覆盖。

## 4. 用户确认绑定

- `approval/asked → decided` 事件生成 `approvalId`；promote 只在 `decided=approve` 且 approvalId 匹配时进行。
- 半自动可借鉴 PerryLink 第二模型审查，但生产保留 human answerer。

## 5. 审计 ledger

每条决策 append：`{ ts, runId, candidateId, fromState, toState, decision, reason, evidenceRefs, gateRunId, approvalId, ruleSetVersion }`。

## 6. 数据契约

见父 `design.md` §4 `EvolutionRun`（decision 字段覆盖状态机各态）。

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Gate 规则静默变化 | ruleSet 版本化 + Epoch 绑定，改动即新版本 |
| LLM 波动误判 | 确定性事实由代码判定；语义维度才用 LLM（advisory） |
| promote 竞态 | 交给 registry CAS，controller 不再重复实现 |
| approval 丢失 | approvalId 绑定 + 审计，未决不 promote |
