# request_* 异步 Job 契约（M5）

> 业务 Agent 只有两个入口：`request_evaluation` / `request_evolution`。
> 每个请求是一个**异步 Job**，由 Controller 调度，结果经 **Session 事件**投递。

## RequestJob 结构

```ts
RequestJob {
  requestId: string;                 // 唯一
  type: 'evaluation' | 'evolution';
  idempotencyKey: string;            // 同键重复 submit → 返回原 job，不重复执行
  status: 'queued'|'running'|'awaiting_approval'|'succeeded'|'failed'|'cancelled'|'timeout';
  createdAt; startedAt?; finishedAt?;
  budget: { maxTokens?; maxRuns?; deadline? };   // Controller 强制执行
  resultRef?: string;                // EvaluationRun / EvolutionRun id
}
```

## 语义

- **查询**：两个工具均支持 `submit` / `status` / `result`（不新增第三个工具）；
  或由 Controller 通过 Session 事件投递最终结果。
- **幂等**：同 `idempotencyKey` 重复 submit 去重。
- **生命周期**：超时 / 取消 / 预算上限 / 并发上限由 Controller 强制执行。
- **重试**：失败允许按 requestId 重试（新 requestId 或同键重试由调用方选择）。
- **隔离**：业务 Agent 拿不到底层 evaluator/controller 能力（Host capability 拒绝，见 M4）。

## Evolution 特有

- `request_evolution` 进入 `awaiting_approval`，用户确认（approval/asked → decided）后才由
  evolution-controller 接管 gate → promote（CAS + approvalId 绑定，见 M3）。

## 集成验证

- 业务 Preset 工具清单断言：仅含 request_*（无 evolve_*/promote/rollback）。
- 幂等去重、超时/取消/预算/并发限制单测或集成测试。
- 完成后收到 Session 事件结果引用。
