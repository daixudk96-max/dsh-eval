# preset-registry

DeepSeek Harness **Eval + Evolution** 系统的版本骨架（M2）：实现
**Logical Preset + Immutable Revision + Current Pointer** 模型、Candidate staging、
内容寻址只读存储、CAS 原子 promote、O(1) rollback、WAL 审计 ledger 与 GC 保护。

纯 CommonJS、零外部依赖、node:test 测试（`node --test`）。

## 目录布局（root，默认 `~/.dsh/preset-registry/`）

```
logical/<logicalId>.json        current/previous/candidates 索引
revisions/<digest>/             内容寻址、不可变（digest 校验）
pointers/<logicalId>.current.json  { revisionId, digest, updatedAt, gateRunId, approvalId }
staging/<candidateId>/          DRAFT 候选（SEALED 前可写）
ledger/ledger.jsonl             append-only WAL
```

## API

- `resolveCurrent(logicalId)` → `{ logicalId, revisionId, digest, resolved }`
- `createCandidate(logicalId, { sourceRevisionId, evolutionRunId })` → `candidateId`
- `patchCandidate(candidateId, mutation)` — 仅 DRAFT 可写
- `sealRevision(candidateId)` → `{ revisionId, digest }` — 内容寻址 + 不可变
- `promote(logicalId, { expectedCurrent, targetRevision, candidateDigest, gateRunId, approvalId })` — CAS 事务（WAL 先写 + 原子 rename）
- `rollback(logicalId, oldRevisionId)` — O(1) 切指针，不删历史
- `history(logicalId)` / `gcCandidates()` / `verifyRevisionDigest(digest)`

## 关键保证

- **CAS promote**：进程内互斥 + expectedCurrent（revisionId+digest）比对；并发两个 promote 仅一个成功。
- **崩溃恢复**：原子 rename（`*.tmp`）+ WAL（先 ledger 后指针）；恢复时清 stray tmp、按 ledger 重放缺失指针。
- **GC 保护**：只清理未 seal 的 DRAFT；SEALED（拥有不可变 revision）/current/rollback 窗口/SessionHeader 引用均受保护。
- **老 Session 固定**：通过注入的 `agentPresets` adapter（`resolve/copy/mount`）对接 DSH standing-mount generation 语义。

## 测试

```powershell
node --test
```
覆盖：resolveCurrent 稳定、seal 不可变（digest 篡改检测）、并发 CAS、崩溃恢复、
GC 保护、rollback 历史保留、老 Session pinning、promote 校验。
