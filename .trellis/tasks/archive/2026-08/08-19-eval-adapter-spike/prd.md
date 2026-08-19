# M1 评测闭环 Spike（eval-adapter-spike）

## Goal

验证 `hccccc01333/dsh-eval` 能否作为统一评测真值（`ctx.eval`）的执行底座，产出明确的 **go/no-go** 结论与选型（直接依赖 / 包装 CLI / 抽取核心 / 自研最小 runner fallback）。本子任务只做验证与最小闭环，不做完整版本化/治理（属 M2/M3）。

## Scope

- 在隔离 profile 安装并跑通 `hccccc01333/dsh-eval`（不污染主 profile）。
- 编写最小 `benchmark.yaml`（1 case），headless 执行，验证真实 trace 与指标产出。
- 验证与 DSH 运行版本（rc）的 peer 依赖兼容性、Windows 路径/子进程/stdio 行为。
- 将 go/no-go 结论与选型写回父任务 `design.md`（§2.2 与 ADR D2 更新）。

## Requirements

- **S1 兼容性检查清单**：记录固定 commit SHA（或发布版本）与许可证；验证能否作为依赖被 DSH 插件加载。
- **S2 最小闭环**：`dsh eval run <benchmark.yaml>` headless 跑通，产出 scores/assertions/trace 指标，exit 0 表示全过。
- **S3 输出契约对齐**：映射到 `EvaluationRun { id, subject, mode, evaluationEpochId, planIds, scores, assertions, evidenceTreeRef, failureSignatures, artifacts }` 的字段来源。
- **S4 失败隔离**：验证失败不污染主 profile；可与 `dsh-eval` CLI 的 `dsh eval report` 语义衔接。
- **S5 决策物**：go/no-go 结论 + 选型 + 若 go-no 的自研最小 runner 方案。

## Acceptance Criteria

- [ ] dsh-eval 的固定 commit SHA 与许可证记录在案（`research/` 或 task 目录）。
- [ ] 最小 benchmark.yaml（1 case）headless 跑通，产出 scores/assertions/至少一种 trace 指标。
- [ ] 与 DSH rc 版本的 peer 兼容性确认（隔离 profile 内；主 profile 无残留）。
- [ ] Windows 路径、长路径、子进程退出码与 stdio 行为验证通过。
- [ ] go/no-go 决策 + 选型（含 fallback 方案）写入父任务 `design.md`，被 M2 采用。

## Out of Scope

- EvaluationRun 持久化与 Epoch 六重锁（M2/M3）。
- paired 统计 / minEffect / INCONCLUSIVE（M3/M6）。
- blind holdout（M6）。

## Dependencies

- 无（本任务最先执行）。
- 产出：父任务 `design.md` §2.2 的决策物，供 M2/M3 引用。
