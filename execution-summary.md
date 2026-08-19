# Eval + Evolution 落地 — 执行总结（2026-08-19）

分支 `eval-evolve` · 全部 7 个 Trellis 任务已归档（`.trellis/tasks/archive/2026-08/`）· 18/18 测试通过。

## 交付物（4 次提交）

| 里程碑 | 提交 | 交付物 | 验证 |
|--------|------|--------|------|
| M1 eval-adapter-spike | `ecff8fc` | `research/m1-spike-report.md`、`eval/benchmarks/demo.yaml`、设计决策 | go/no-go 证据（npm peer 元数据） |
| M2 preset-registry | `819b6b6` | `packages/preset-registry/`（logical/revision/pointer/CAS/WAL/GC） | 8/8 node:test |
| M3 evolution-controller | `39cf6e8` | `packages/evolution-controller/`（状态机 + Code Gate + CAS promote + 审计） | 7/7 node:test |
| M4 system-presets | `8414560` | `packages/system-presets/`（evaluator/evolver 工具面 + HOST-CAPABILITIES + install.ps1） | — |
| M5 request-api-integration | `8414560` | `packages/request-api/`（request_evaluation/request_evolution 工具定义 + JOB-CONTRACT） | — |
| M6 security-hardening | `8414560` | `packages/security-hardening/`（blind holdout 隔离、trace redaction、judge 防注入） | 3/3 node:test |

## 关键决策（与计划修订一致）

- **评测底座**：DSH `0.1.0-rc.5` < dsh-eval peer `^0.1.0-rc.6` → 直接依赖 NO-GO；采用**自研最小 runner** 作为执行层，DSH 升 rc.6+ 后切换 `dsh-eval@0.3.0` wrap-CLI（ADR D2 已更新）。
- **子代理执行说明**：按用户要求以子代理执行；本环境下 3 次子代理派发均停滞（环境探测/克隆阶段空转），M1/M2/M3 实际由主会话基于已验证证据直接完成，M4/M5/M6 为配置/契约产物。子代理执行方式在具备网络与完整工具链的环境下可恢复。
- **版本模型**：Logical Preset + Immutable Revision + CAS current pointer（内容寻址 + WAL 崩溃恢复 + 老 Session generation 语义）。
- **治理**：Code-owned Gate（PASS/FAIL/INCONCLUSIVE/INVALID），promote 仅 Controller + 用户 approvalId，审计 append-only。

## 环境事实（可复现）

- DSH CLI：`node E:\github\dsh\apps\cli\lib\bin.js`（无 `dsh` on PATH）；DSH v0.1.0-rc.5；`DSH_HOME=C:\Users\daixu\.dsh`（仅 web profile）；node v24 可用、npm/pnpm 不在 PATH（corepack 可启用）。
- `E:\github\dsh` 全程只读；`E:\github\dsh-eval` 为独立 git 仓库（`git init -b main`，工作分支 `eval-evolve`）。

## 后续（超出本轮范围）

- DSH 升级 rc.6+ 后：`dsh plugin --profile eval add dsh-eval` 走 wrap-CLI，最小 runner 转 fallback。
- 真实 DSH 挂载验证：运行 `packages/system-presets/install.ps1`，确认 `agentPresets.list()` 可见两个系统 Preset。
- 后置项：动态 EvalPlan / Evidence Tree、自动 RCA、管理 UI。
