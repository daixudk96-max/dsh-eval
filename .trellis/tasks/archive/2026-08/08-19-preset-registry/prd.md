# M2 版本骨架（preset-registry）

## Goal

自研 `preset-registry` Service：实现 **Logical Preset + Immutable Revision + Current Pointer** 版本模型、Candidate staging、内容寻址只读存储、CAS 原子 promote、O(1) rollback、审计 ledger 与 GC 保护。这是本系统自研核心（DSH 官方无 `presetRegistry`）。

## Requirements

- **R1 目录结构**：`~/.dsh/preset-registry/` 下 `logical/<logicalId>.json`、`revisions/<digest>/`（内容寻址、只读）、`pointers/<logicalId>.current.json`、`ledger/`（append-only）、`staging/`（Candidate 隔离区）。
- **R2 resolveCurrent**：`resolveCurrent(logicalId) → revisionId`，读 pointer 后经 `ctx.get('agentPresets').resolve(revisionId)`。
- **R3 Candidate**：`createCandidate(sourceRevisionId, evolutionRunId)`（`agentPresets.copy()` 到 staging）、`patchCandidate(candidateId, mutations)`（MutationRecord 落盘）、`sealRevision(candidateId)`（生成 revisionId + 内容 digest；复制到 revisions/ 只读区；manifest 记录 composition/skills/managed assets/lock 依赖）。
- **R4 Promote CAS**：`promote(logicalId, { expectedCurrent, targetRevision, candidateDigest, gateRunId, approvalId })`；expectedCurrent 不匹配则失败，不覆盖（防 TOCTOU）；原子写 pointer + 审计。
- **R5 Rollback**：O(1) 切 pointer，不删除历史 revision；`history(logicalId)` 可查。
- **R6 崩溃恢复**：pointer 原子写（临时文件 + rename）；写中途崩溃按 ledger 重放恢复一致状态。
- **R7 GC 保护（父 R10 落地）**：不得删除 current revision、rollback 保留窗口内 revision、任何 SessionHeader 引用的 revision、运行中 Run 引用的 revision；MVP 仅清理 rejected candidate。
- **R8 Session 集成**：agent factory setup 钩子 —— 新 Session 走 `resolveCurrent(logicalId)` 并把 revision+digest 固化进 SessionHeader；老 Session 依赖 DSH standing-mount generation 语义不自动升级。
- **R9 并发**：单机互斥（进程内锁），两个并发 promote 只有一个成功。

## Acceptance Criteria

- [ ] `resolveCurrent('coding') → coding-rN` 稳定解析；新 Session 总能解析到 current。
- [ ] 封存后 revision 内容不可原位修改（digest 校验 + revisions/ 只读区）。
- [ ] 两个并发 promote 只有一个成功（CAS），失败方不改变 pointer。
- [ ] pointer 写中途模拟崩溃后，按 ledger 恢复一致状态。
- [ ] GC 保护规则全部生效（current / rollback 窗口 / SessionHeader 引用 / running run）。
- [ ] rollback O(1) 且不删除历史 revision（history 仍可查）。
- [ ] 老 Session resume/replay 保持原 revision + digest。

## Out of Scope

- Gate 判定与四态决策（M3）。
- 系统 Preset 工具面（M4）。
- 统计/盲测隔离（M6）。

## Dependencies

- 依赖 `eval-adapter-spike` 完成（确认 `agentPresets.copy/resolve/mount` 行为，见父 `design.md` §3）。
- 产出被 `evolution-controller`（promote/rollback 调用）与 `system-presets`（可挂载 revision）使用。

## 参考

- 父任务 `design.md` §2.1（preset-registry）、§3（DSH 集成）、§4（数据契约）、ADR D5/D6/D7。
