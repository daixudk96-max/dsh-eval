# M2 preset-registry —— 技术设计

> 以父任务 `design.md` §2.1 / §3 / §4 为权威；本文件只列本子任务范围内的实现要点。

## 1. 目录布局

```
~/.dsh/preset-registry/
├── logical/<logicalId>.json        # current/previous/candidates 索引
├── revisions/<digest>/             # 内容寻址、只读（seal 后 chmod/校验）
│   └── manifest.json               # composition/skills/managed assets/lock 依赖 + digest
├── pointers/<logicalId>.current.json  # { revisionId, digest, updatedAt, gateRunId, approvalId }
├── staging/<candidateId>/          # 隔离区，seal 前可写
├── ledger/                         # append-only：createCandidate/seal/promote/rollback/gc
└── locks/                          # 单机互斥（promote 串行化）
```

## 2. 关键实现决策

- **指针原子写**：写 `pointers/*.tmp` + `fs.rename` 覆盖 `.current.json`；任何写前先 append ledger（WAL 语义），崩溃恢复按 ledger 重放。
- **CAS promote**：进程内互斥锁 + 读回 expectedCurrent 比对（revisionId + digest 双校验）；不匹配即失败返回，绝不覆盖。
- **内容寻址**：`digest = sha256(canonical(composition + manifest))`；seal 后目标目录标记只读并记录 digest，任何读到的不一致 → INVALID。
- **resolveCurrent**：读 pointer → `ctx.get('agentPresets').resolve(physicalRevisionId)`；Logical Preset 仅是产品层 ID。
- **Session 集成**：agent factory setup 钩子注入 `resolveCurrent(logicalId)`；把 revision+digest 写入 SessionHeader。老 Session 由 DSH standing-mount generation 语义天然固定，不额外迁移。
- **GC 保护**：引用计数来源 = current + rollback 窗口 + SessionHeader 索引 + running Run；只有 rejected candidate 可清理（MVP）。

## 3. 数据契约

见父 `design.md` §4 `PresetRevision` / `SessionHeader`；本任务新增 `pointer` 结构如上。

## 4. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `agentPresets.copy` 无防覆盖 | staging 命名约定 + 目录锁 |
| pointer 写中途崩溃 | WAL（先 ledger 后 rename）+ 重放 |
| 并发 promote | 进程内锁 + CAS 双校验 |
| GC 误删被引用 revision | 引用计数保护（R7） |
