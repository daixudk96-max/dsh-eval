# M2 preset-registry —— 实施计划

## 实施顺序

1. 初始化目录结构 + `logical/` 索引读写。
2. `resolveCurrent(logicalId)`（读 pointer → agentPresets.resolve）。
3. `createCandidate` / `patchCandidate`（staging + MutationRecord）。
4. `sealRevision`（digest、revisions/ 只读区、manifest）。
5. `promote` CAS 事务（锁 + WAL + 双校验）+ `rollback` + `history`。
6. 崩溃恢复（ledger 重放）。
7. agent factory setup 钩子 + SessionHeader 固化。
8. GC 保护规则 + `gcCandidates` / `gcRevisions`。

## 验证命令

- 单元测试（vitest，沿 `agent-presets` spec 风格）：`pnpm vitest run <包>/test/preset-registry`
- 集成：`dsh --profile web --dump-config | grep -iE 'preset-registry|resolveCurrent'`
- 手工冒烟：`resolveCurrent('coding')` → 返回 revisionId；`promote` 并发两次仅一次成功。

## 检查点 / 回滚点

- 检查点 1：resolveCurrent + staging 可用（先于任何 promote 语义）。
- 回滚点：registry 数据目录可整体删除重建（无存量，无污染主 profile）；代码层面回退到上一 Package（动态插件 update/rollback）。

## AC→验证映射（对应 prd.md）

- resolveCurrent 稳定 → 单测 + 冒烟
- 封存不可篡改 → digest 校验单测 + 只读区文件检查
- 并发 promote 单成功 → 并发单测
- 崩溃恢复 → 模拟 write 中断 + 重放单测
- GC 保护 → 引用计数单测（current/窗口/Session/run）
- rollback O(1) 不删历史 → history 单测
- 老 Session 固定 → 集成（generation 语义）
