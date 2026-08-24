# Feature Design

status: draft   # draft | approved
execution_lane: standard   # quick | standard

## 目标与非目标

- 目标: 评测工具覆盖面补到生态同级(加权/replay/导入/status/生命周期/机械校验/反馈)。
- 非目标: frozen 契约(P0)、LLM-judge 模板、预算联动。

## 方案

### 边界

- P1-1: packages/dsh-eval/src/metrics.ts + benchmark.ts(weight 解析与聚合)。
- P1-2: packages/dsh-eval/src/runner.ts(replay.dir 记录)+ 可选 replay 重放路径。
- P1-3: packages/dsh-eval/src/import.ts(import codex|claude-code 分支)。
- P1-4: evolution-controller/bin/dsh-evolve.js status 子命令(读 registry)。
- P1-5/6: packages/dsh-eval/src/benchmark.ts(caseMeta + lifecycle + checkProblems)。
- P1-7: evolution-controller/lib/feedback.js(新)。

### 数据流

```text
P1-1: caseSchema.weight → parseBenchmark → aggregate(加权均值) → run.json grading
P1-2: run 时写 replay.dir/<case>-<trial>/session.log → 重跑 --replay <dir> 挂 dsh-llm-replay
P1-3: import codex|claude-code <session.jsonl> --out <trial.json> --case-id <id>
P1-4: dsh-evolve status → resolveCurrent/history/漂移(digest 比对) → 文本一览
P1-5: benchmark.yaml case.lifecycle draft|calibrating|frozen + caseMeta → 迁移校验(仅 frozen 参与 gate)
P1-6: caseCheckProblems(statement/rubric/meta) → parse 时拒绝坏 case(报错不静默)
P1-7: run.json grading → feedback.js quality_score/quality_warn → usage 日志
```

### 契约变更

- caseSchema: weight?(默认 1)、lifecycle?(默认 draft)、meta?(capability/distinguisher/shortcuts/calibrationHistory)。
- benchmarkSchema: replay?: {dir}。
- run.json: grading 加权聚合标记。
- dsh-evolve: status 子命令。
- import: 支持 codex/claude-code 源。

### 取舍

- replay 先记录后重放: 官方包不可用则降级记录(诚实原则)。
- case 生命周期默认 draft 不阻塞; 只有 frozen case 参与 gate 统计。
- 机械校验在 parse 时报错(早失败), 不改 benchmark 不静默跳过。

## 风险与回滚

- replay 包不可用: 如实记录, 功能降级(不重放); 不伪造 CI 结果。
- 加权聚合默认 weight=1 与现等权一致(向后兼容)。
- 生命周期字段可选, 老 benchmark 不受影响。

## 验证计划

- P1-1: 单测(weight 2 vs 1 结果差异)。
- P1-2: replay 记录 + 重跑尝试(记录结论)。
- P1-3: 真实 codex/claude 格式样例导入。
- P1-4: 真实 registry status 输出。
- P1-5/6: 生命周期迁移单测 + 坏 case 拒绝。
- P1-7: feedback 单测。
- 全量回归: evolution-controller node:test + dsh-eval vitest mirror。

## 人审检查点

- [ ] 设计已获用户确认（status=approved）后再进入实现
