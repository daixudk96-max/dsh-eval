# M6 强化（security-hardening）

## Goal

在 M3/M2 基础上补齐强化项：**blind holdout 服务级隔离**（Evolver 不可见）、**paired 统计**（minEffect / INCONCLUSIVE 采样重跑）、**GC 保护规则**完整落地、trace 泄漏清理与 judge prompt-injection 防护；范式后置项（HarnessEval-W 动态 EvalPlan、自动 RCA、UI）作为可选延伸。

## Requirements

- **R1 blind holdout 隔离（服务级）**：system-evolver 无法读取 holdout 原始 case / 答案 / evaluator 内部 Prompt；仅在 Gate 阶段以聚合结果消费 holdout 指标。靠 Host capability 边界，而非 Prompt 约定。
- **R2 trace 清理**：EvaluationRun trace 默认做密钥、用户数据、答案泄漏清理。
- **R3 不可信输入防护**：Candidate 输出作为不可信输入处理，防 judge prompt-injection（结构化提取、约束、fail-closed）。
- **R4 paired 统计**：Gate 使用 paired runs + `minEffect` 阈值；统计不显著 → INCONCLUSIVE，支持加采样重跑。
- **R5 GC 保护完整实现**：current / rollback 窗口 / SessionHeader 引用 / running Run 引用全部保护（父 R10）。
- **R6 （后置可选）**：HarnessEval-W 风格动态 EvalPlan / Evidence Tree；自动 FailureCluster / RCA；Revision history / Candidate 管理 UI。

## Acceptance Criteria

- [ ] 集成测试：system-evolver 会话无法访问 holdout 文件/数据（文件系统与 Service 两层验证）。
- [ ] 生成的 trace 中无密钥 / 用户数据 / 答案泄漏（泄漏扫描通过）。
- [ ] judge prompt-injection 注入尝试被拒绝（fail-closed）。
- [ ] paired 统计显著性与 INCONCLUSIVE 判定正确（构造数据单测）。
- [ ] GC 保护规则全部生效（current / rollback 窗口 / Session 引用 / running run）。
- [ ] 后置项为可选项：MVP 完成时至少不回归已有 Gate 行为。

## Out of Scope

- Gate 基础四态与状态机（M3 已交付）。
- CAS promote / registry（M2 已交付）。

## Dependencies

- 依赖 `evolution-controller`（Gate 接口与 holdout 预留位）。
- 依赖 `preset-registry`（GC 保护、SessionHeader 引用）。

## 参考

- 父任务 `design.md` §2.4（Gate）、§5（风险与缓解）、ADR D8；`final-report.md` 的 HarnessEval-W 范式结论。
