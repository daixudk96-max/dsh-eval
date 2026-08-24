# P2: 进化治理增强(逆编辑回滚/威胁扫描/failures/decisionReport)

## 背景

差距清单 P2 五项(第 12-16 项): 治理侧从「指针级回滚」深化到「内容级确定性回滚」, 补写前威胁扫描(与事后 redact 互补), 失败类聚合与对比视图增强。

## 范围

### In Scope
- P2-1: 确定性逆编辑回滚(rollbackRejectedCandidate: 从已应用内容重建逆编辑, 无 LLM 重猜) + autoRollbackOnReject 选项。
- P2-2: partial 回滚冲突检测(回滚时检测中间变更冲突, 参考 self-evolution snapshot)。
- P2-3: 写前威胁扫描(lib/threat.js: prompt-injection/exfiltration/secret 扫描, 写前 block; 与 redact.js 事后脱敏互补; 吸收 evolution-threat)。
- P2-4: failures 失败类聚合命令(dsh-evolve failures: 聚合失败类门禁+benchmark 视图, 参考 continual-evolve failures.ts)。
- P2-5: decisionReport 逐 case before→after delta(compare 视图增强)。

### Out of Scope
- 热挂载/内容记忆域(P3)、Web UI(P4)

## 验收标准

- [ ] AC1: 逆编辑回滚单测(编辑→回滚→内容还原, 无 LLM 参与)。
- [ ] AC2: partial 冲突检测单测(中间变更 → 冲突报错不盲目回滚)。
- [ ] AC3: threat.js 三类威胁扫描单测 + 写前 block 真实演示。
- [ ] AC4: dsh-evolve failures 输出失败类聚合(真实 run.json 验证)。
- [ ] AC5: decisionReport delta 输出(compare 增强)。
- [ ] AC6: 全量回归全绿。

## 约束与风险

- 上游只读 + absorbed-from 头注; CJS node:test 单进程。
- 逆编辑基于 registry revisions 内容(有 manifest/mutations 记录), 无 LLM 重猜。
- 威胁扫描是代码级模式匹配, 不是安全边界(与生态同定位)。

## 相关代码/文档

- research/feature-union-gap.md(P2 第 12-16 项)
- research/dsh-continual-evolve/src/rollback.ts / failures.ts
- research/dsh-self-evolution/src/snapshot.ts(partial 冲突)
- research/dsh-evolution/packages/evolution-threat(写前扫描)
