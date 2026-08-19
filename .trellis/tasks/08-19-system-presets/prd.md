# M4 系统 Preset（system-evaluator / system-evolver）

## Goal

落地两个专用系统 Preset：`system-evaluator`（只读评测工作台）与 `system-evolver`（只写 Candidate 的进化工作台）。两者均无正式 Preset / current pointer 写权限；真正的权限边界在 Host Service capability 层强制，Preset 工具面只负责可见性。

## Requirements

- **R1 system-evaluator**：只读评测工具面（读 EvaluationRun/Evidence/Report；可发起 Discovery/Validation 评测），不可写业务代码、Candidate、Rubric/Benchmark 自修改。
- **R2 system-evolver**：只写 Candidate 的工具面（RCA → Proposal → Mutation → Candidate 目录），无 Source Revision / Eval Core / Gate / current pointer 写权。
- **R3 Host capability 强制**：Service 方法签名级 capability 检查（调用者 fiber/身份），非 `presetId === 'system-evolver'` 字符串判断。
- **R4 挂载**：`~/.dsh/.agent-presets/system-evaluator/` 与 `system-evolver/` 的 `agent.cordis.yml`；`agentPresets.list()` 可见；新 Session 可选。

## Acceptance Criteria

- [ ] `ctx.agentPresets.list()` 可见两个 system preset；新 Session 可选择挂载。
- [ ] system-evolver 工具清单无 promote/rollback/current 写工具。
- [ ] Host capability 层集成测试：越权调用（如 evolver 尝试写 current）被拒绝，而非仅工具面隐藏。
- [ ] system-evaluator 只读：对业务 Preset / Candidate / Rubric 的写调用被拒绝。
- [ ] 旧 Session 不受影响（DSH standing-mount generation 语义，preset 只影响新 Session）。

## Out of Scope

- 治理逻辑本身（M3）。
- request_* 业务入口收窄（M5）。

## Dependencies

- 依赖 `preset-registry`（存在可挂载的 revision / Candidate staging 工具）。
- 依赖 `evolution-controller`（evolver 提交的 Candidate 由 controller 接管 gate/promote）。

## 参考

- 父任务 `design.md` §2.5（权限与信任边界）、§3（DSH 集成）、ADR D4。
