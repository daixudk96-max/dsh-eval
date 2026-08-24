# Feature Design

status: draft   # draft | approved
execution_lane: standard   # quick | standard

## 目标与非目标

- 目标: 治理从指针级回滚深化到内容级确定性回滚; 写前威胁扫描; 失败聚合与对比增强。
- 非目标: P3 内容域、P4 Web UI。

## 方案

### 边界

- P2-1/2: packages/preset-registry/lib/registry.js(rollbackContent)+ evolution-controller/lib/rollback.js(新)。
- P2-3: evolution-controller/lib/threat.js(新, 挂 createCandidate/promote 写前)。
- P2-4: evolution-controller/bin/dsh-evolve.js failures 子命令。
- P2-5: dsh-eval 侧 compare.ts 增量(decisionReport)或 evolution-controller 独立。

### 数据流

```text
P2-1: 被拒候选 sealed 内容 vs 已应用 current 内容 → 逆编辑(diff 反演) → 写回指针(新 revision 或原位)
P2-2: 回滚前 diff current↔target → 中间 revision 有交集变更 → 冲突报错
P2-3: createCandidate mutation 内容 → threat.js(injection/exfiltration/secret 模式) → block + audit
P2-4: dsh-evolve failures → run.json 失败 case 聚类(按错误/超时/检查失败) → 聚合视图
P2-5: compare <baseline> <candidate> --delta → 逐 case before→after 表
```

### 契约变更

- registry: rollbackContent(logicalId, targetRevisionId, {detectConflicts})。
- controller: createCandidate 增 threatScan(默认 true)。
- dsh-evolve: failures、compare --delta。

### 取舍

- 逆编辑基于 revisions 的 mutations/manifest 记录(确定性), 不做 diff 猜测。
- 冲突检测保守: 有任何交集变更即报错(人工决断)。
- 威胁扫描与 redact 分层: 写前 block + 事后脱敏双保险。

## 风险与回滚

- 逆编辑涉及内容写回: 先写审计再动指针, 失败可回滚(registry CAS 语义)。
- 威胁扫描误报: 只 block 候选不删数据。
- 冲突检测保守策略可能误拒合法回滚(可 --force 覆盖)。

## 验证计划

- 单测覆盖 5 项 AC + 真实 registry 演练(逆编辑回滚一轮)。
- 全量回归: evolution-controller node:test + dsh-eval vitest mirror。

## 人审检查点

- [ ] 设计已获用户确认（status=approved）后再进入实现
