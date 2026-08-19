# Host Capability 边界（M4/M5 权威）

> Preset 名称**不是**安全边界。真正的权限检查必须在 Host Service 方法签名级
> 执行（调用者 fiber/身份），Preset 工具面只负责「可见性」。

## 能力表

| 组件 | 可调用 | 禁止（Host 层拒绝） |
|------|--------|----------------------|
| Business Agent | `request_evaluation` / `request_evolution`（+ status/result） | 一切 `evaluation.*` / `candidate.*` / `preset.promote|rollback|current` / `evolve.*` 底层能力 |
| system-evaluator | `evaluation.*`（只读） | `candidate.*`、`preset.*`、`evolve.*`、Rubric/Benchmark 自修改 |
| system-evolver | `candidate.*`、`evolution.*`（只写 Candidate） | `preset.promote|rollback|current`、`evaluation.*` 真值、`holdout.*` 原始数据 |
| Controller | `preset.promote|rollback`（CAS + approvalId）、`gate.*` | 生成语义评测结论 |
| 用户 | 确认 Evolution / Promote、手工 Rollback | — |

## 实现要点

- 每个 Service 方法入口先解析调用者 capability（fiber/身份 → 角色），不匹配即抛权限错误并写审计。
- `promote` 仅 Controller 可调用，且必须携带 `approvalId`（approval/asked → decided 绑定）。
- blind holdout：evolver 在 Host 层与文件系统层都不可达 holdout 原始数据（M6）。
- 双保险：Preset 工具面隐藏 + Host capability 强制；任何单层绕过都被另一层拦截。

## 验证（集成时）

```powershell
# 业务 Preset 工具清单断言：仅 request_*（无 evolve_*/promote/rollback）
# Host 层拒绝：以 evolver 身份调 promote → 权限错误
# 文件系统：evolver 工作区无 holdout 文件
```
