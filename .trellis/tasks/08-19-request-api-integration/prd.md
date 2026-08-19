# M5 入口收窄（request-api-integration）

## Goal

业务 Agent（coding/review/…）只暴露 `request_evaluation` / `request_evolution` 两个窄工具；定义异步任务契约（submit/status/result、requestId、幂等、超时/取消、预算/并发、完成通知）；从业务 Preset 中移除一切 `evolve_*` / promote / rollback 写工具。

## Requirements

- **R1 工具签名**：`request_evaluation` / `request_evolution` 返回 `requestId`（异步）；支持 `status` / `result` 查询（可通过同一工具或 Session 事件，见父 design §A）。
- **R2 幂等**：请求带幂等键，重复提交不重复执行。
- **R3 生命周期**：超时、取消、预算上限、并发上限。
- **R4 完成通知**：Controller 通过 Session 事件投递最终结果（EvaluationRun / EvolutionRun 引用）。
- **R5 工具面收窄**：业务 Preset（coding/standard 的 user 副本）工具清单只含 request_*；无 evolve_* 写工具。
- **R6 隔离**：业务 Agent 拿不到底层 evaluator/controller 能力（Host capability 层拒绝）。

## Acceptance Criteria

- [ ] 业务 Preset 工具清单仅含 request_* 两个入口（无 evolve_*/promote/rollback）。
- [ ] `request_evaluation` 返回 requestId，可查询状态与结果。
- [ ] 幂等键去重：同键重复提交只执行一次。
- [ ] 超时 / 取消 / 预算 / 并发限制生效（单测或集成测试）。
- [ ] 完成后经 Session 事件收到结果引用。
- [ ] 业务 Agent 越权调用 evaluator/controller 能力被 Host capability 拒绝。

## Out of Scope

- 评测/进化内部实现（M1/M3 提供）。
- 系统 Preset 本身（M4）。

## Dependencies

- 依赖 `system-presets`（系统工具面存在）。
- 依赖 `evolution-controller`（异步 job 生命周期与结果投递）。

## 参考

- 父任务 `design.md` §2.5 权限表、§A（异步结果契约）、ADR D1/D4。
