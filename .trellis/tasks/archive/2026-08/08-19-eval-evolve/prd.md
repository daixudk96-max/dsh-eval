# 评测与自进化系统（Eval + Evolution）落地 —— 父任务 PRD

> 本任务为**父任务**：持有完整需求集（R1–R10）、跨子任务验收标准与集成验收。技术决策见 `design.md`（含 ADR D1–D9），执行编排见 `implement.md`。实现工作拆分到 6 个子任务。

## Goal

在 DeepSeek Harness（DSH）上落地「评测（只读）→ 进化（只写 Candidate）→ 同 Frozen Epoch 验证 → Code-owned Gate → 用户确认 Promote」的自进化闭环；正式 Preset 采用 **Logical Preset + Immutable Revision + Current Pointer** 版本模型，用户日常只见稳定 Preset 名（coding/review/…），系统内部管理不可变 Revision 并原子切换 current pointer。

## Background（已核验的事实）

- 2026-08-19 版架构文档引用的 18 个仓库 + arxiv 2608.16859 全部真实存在（GitHub API/HTML 逐一核验）。
- 生态现状（README 实证）：
  - `hccccc01333/dsh-eval`：benchmark YAML、headless 执行、trace 指标、A/B、replay、cross-harness import、token/latency/cost/tool 指标 —— **最匹配统一评测真值底座**（M1 需做兼容性 go/no-go）。
  - `ZK-Andy/dsh-continual-evolve`：prompt/memory/skill/subagent 四类 entry 版本化 mutation、确定性 rollback、approval、benchmark 驱动 code-owned 验收 —— 适合做 **entry 级 mutation 引擎**，非整 Preset 版本骨架。
  - `Lhy723/dsh-self-evolution`：冻结 benchmark + Candidate + 严格接受(>)/回滚 + 单调版本快照 —— **最接近 Profile 级版本闭环骨架**，参考其循环范式。
  - `ZTCNO0NE/dsh-loom`：独立 verifier、isolation、applyWithRollback、ledger —— 治理参考。
  - `lmzhen/dsh-evolution`：Host + Evolution Preset 权限分层 —— 权限分层参考。
  - `MirroS-Lab/HarnessEval-W`：**视觉世界评测** —— 只能借鉴范式（后置），不能直接评测 DSH Agent。
  - `PerryLink/dsh-auto-review`：**主职是 approval 第二模型审查器**（fail-closed）—— 借鉴 reviewer 机制，不作评测核心。
- DSH 官方 packages 中 **无** ctx.eval / ctx.evolution / presetRegistry（源码 grep 零命中）→ 必须自研为插件。
- DSH `AgentPresets` Service 提供 list/resolve/read/copy/remove/mount/recompose/composeFrom/serviceFor/defaultId；**standing mounts 按 file-stamp 分 generation：运行中 Session 保留已挂载 generation，文件编辑只影响之后新建 Session** —— 与「current pointer 只控制新 Session」语义天然兼容。
- DSH 用户 preset 根 `~/.dsh/.agent-presets` 当前未创建；web profile 组合为「空根 + bundles/patch 叠加」。

## 实现仓库边界（本任务决策）

- **决定**：`E:\github\dsh-eval` 为独立实现仓库；所有自研插件（preset-registry / eval-adapter / evolution-controller / 系统 Preset / 业务 Preset 收窄）以独立包落在此仓库，经 profile bundle + cordis patch 集成进 DSH。
- `E:\github\dsh` 仅用于**只读**：读取 AgentPresets Service 接口、验证兼容性；**不修改 DSH monorepo**（避免侵入主仓库，便于独立版本化与回滚）。
- M1 兼容性 spike 若发现 dsh-eval 无法作为依赖集成，fallback 为自研最小 runner（决策物写入 `design.md` ADR D2）。

## Requirements

- **R1 信任边界**：评测系统只读（不能改业务 Preset/Candidate/Rubric/Benchmark/Gate）；进化系统只写 Candidate（不能改 Eval Core/Rubric/Gate/current pointer）；Controller 独占 promote/rollback。真正的权限检查在 Host Service 内执行，不依赖 Preset 名称字符串。
- **R2 入口**：业务 Agent 只暴露 `request_evaluation` / `request_evolution` 两个窄工具；`system-evaluator`（只读工作台）与 `system-evolver`（只写 Candidate）为专用 Preset。
- **R3 Candidate-first**：Candidate 独立于正式版本；Baseline 与 Candidate 在**同一 Frozen EvaluationEpoch** 下执行可比验证；失败 Candidate 可丢弃/归档，正式版本不受影响。
- **R4 EvaluationEpoch 六重锁**：Benchmark / EvalPlan / SkillRegistry / Rubric / Evaluator(模型+Prompt+采样+工具) / AggregationPolicy 版本化并冻结；Evaluator 升级必须新建 Epoch。
- **R5 版本模型**：Logical Preset → Immutable Revision（封存后禁止原位修改）→ current pointer 原子切换；新 Session 强制 `resolveCurrent(logicalId)`，老 Session 不自动升级。
- **R6 Code-owned Gate**：accept 需 overall 提升 AND 关键维度（correctness/safety/verification）非回归 AND criticalAssertions 全过 AND criticalFailures==0 AND perCaseRegression 容差 AND canary 通过 AND digest 验证 AND Epoch 未变。LLM 的 self-check 仅 advisory。
- **R7 统计与防过拟合**：Gate 需 paired runs + minImprovement 阈值；引入 blind holdout 集（Evolver 不可见，服务级隔离）；决策结果含 `PASS / FAIL / INCONCLUSIVE / INVALID`（INCONCLUSIVE 不 Promote，可加采样重跑）。
- **R8 Promote 事务**：CAS（expectedCurrentRevision + targetRevision + candidateDigest + gateRunId + approvalId），原子写 + 审计；避免 TOCTOU。
- **R9 审计与可复现**：EvaluationRun / EvolutionRun / PresetRevision 全量 append-only；SessionHeader 固化 logicalPreset + revision + digest + epochId，任意历史 Session 可重建。
- **R10 GC 安全**：GC 必须保护 current revision、rollback 保留窗口、被任何 SessionHeader 引用的 revision、运行中的 Run 引用。

## Acceptance Criteria（跨子任务）

- [ ] 用户选择 `coding` 时无需知道 revisionId；新 Session 总能解析到 current Revision（`resolveCurrent('coding') → coding-rN`）。
- [ ] current 更新后，老 Session 仍可 resume/replay，且保持原 revision + digest（DSH standing-mount generation 语义生效）。
- [ ] 自进化 Candidate 失败不改变正式 current；失败 Candidate 可删除但 EvolutionRun 记录仍可查。
- [ ] Candidate PASS 后只有 Controller + 用户确认能 Promote；system-evolver 无 current 写权限（Host 层强制，非仅工具面隐藏）。
- [ ] Baseline 与 Candidate 的 Validation 使用同一 EvaluationEpoch / Frozen EvalPlan / Rubric / Evaluator / AggregationPolicy（Epoch 六重锁生效且可校验）。
- [ ] 每个正式 Revision 不可原位修改；一切变更只能走 新 Candidate → seal → promote。
- [ ] Gate 为代码判定（exitCode/schema/digest/tool error/非回归/成本指标），无 LLM 自证；支持 PASS/FAIL/INCONCLUSIVE 三态。
- [ ] 任意 Session 可通过 header 的 logicalPreset/revision/digest 重建当时 Harness。
- [ ] Rollback 只切 current pointer，O(1)，与 Revision 内容大小无关。
- [ ] Evaluator 升级建立新 EvaluationEpoch，不影响旧 EvolutionRun 可复现性。
- [ ] 业务 Preset 中不存在任何 evolve_* 写工具（仅 request_* 两个入口）。

### AC → 子任务映射

| 父验收 | 子任务 | 说明 |
|--------|--------|------|
| AC1/AC2 resolveCurrent + 老 Session 固定 | preset-registry | generation 语义 + SessionHeader |
| AC3/AC4 Candidate-first + 仅 Controller promote | preset-registry + evolution-controller | staging + CAS + Host capability |
| AC5 Epoch 六重锁 | eval-adapter-spike + evolution-controller | 数据契约 + Gate epoch 校验 |
| AC6 不可原位修改 | preset-registry | 只读区 + digest |
| AC7 Code Gate 三态 | evolution-controller | ruleSet + 四态 |
| AC8 Session 重建 | preset-registry | SessionHeader 固化 |
| AC9 Rollback O(1) | preset-registry | pointer 切换 |
| AC10 Epoch 升级可复现 | evolution-controller + eval-adapter-spike | Epoch 绑定 |
| AC11 仅 request_* | request-api-integration + system-presets | 工具面收窄 + capability |

## Out of Scope（MVP 不做）

- HarnessEval-W 风格的动态 Eval Planner / 多 Skill 分解 / 完整 Evidence Tree（范式后置；先做确定性 EvalPlan + 指标）。
- 自动 Failure Clustering / RCA / 进化建议生成（先手工选择 FailureCluster）。
- 高级 Web UI（Revision history / Candidate 管理页可后置，先 CLI/事件可见）。
- 全自动 GC 策略（MVP 只清理 rejected candidate）。
- 跨进程/跨主机分布式锁（单机互斥即可）。

## 子任务清单

| 子任务 | 里程碑 | 依赖 |
|--------|--------|------|
| 08-19-eval-adapter-spike | M1 评测闭环 go/no-go | 无 |
| 08-19-preset-registry | M2 版本骨架 | M1 |
| 08-19-evolution-controller | M3 治理核心 | M1, M2 |
| 08-19-system-presets | M4 系统 Preset | M2, M3 |
| 08-19-request-api-integration | M5 入口收窄 | M3, M4 |
| 08-19-security-hardening | M6 强化 | M2, M3 |

## Notes

- 参考文档：本仓库 `final-report.md`（核验与评估全文）、`findings.md`（证据明细）、`research/`（8 仓库 README）。
- 技术设计（含 ADR D1–D9 与运行时契约）见 `design.md`；集成编排与验收测试映射见 `implement.md`。
