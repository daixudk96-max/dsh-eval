# P1: 评测工程化(加权聚合/replay/import codex/status/case 生命周期)

## 背景

差距清单 P1 七项(第 5-11 项), 评测侧的工程化补全。P0 打通「两层判定」后, 本任务把评测工具的覆盖面补到生态同级:
case 加权聚合、keyless CI replay、外部会话导入、状态命令、case 生命周期标定、机械校验、质量反馈。

## 范围

### In Scope
- P1-1: case weight 加权聚合(caseSchema 增 weight?: number 默认 1; aggregate 加权均值)。
- P1-2: keyless replay(benchmark.replay.dir 记录 trial session log; 重跑挂 @deepseek-ai/dsh-llm-replay 无密钥重建模型流; 需先确认官方包在本机可用)。
- P1-3: import codex|claude-code(session.jsonl → trial; 现有 import dsh 同构扩展)。
- P1-4: dsh-evolve status 命令(版本/哈希/漂移/快照一览; 参考 self-evolution evolution_status)。
- P1-5: case 生命周期 draft→calibrating→frozen + CaseMeta(capability/distinguisher/shortcuts/calibrationHistory)。
- P1-6: 无 LLM 机械校验(caseCheckProblems: statement≥20 字符/rubric 合法 JSON/meta 非空)。
- P1-7: 质量反馈(feedback→quality_score/quality_warn→usage; 吸收 evolution-feedback)。

### Out of Scope
- frozen 契约本身(P0-3 已做; 此处只做 case 级生命周期状态迁移)
- LLM-judge 模板重写、评测预算联动

## 验收标准

- [ ] AC1: weight 生效(加权 vs 等权结果不同, 单测覆盖)。
- [ ] AC2: replay 目录记录 + 重跑无密钥成功(或记录「官方 replay 包不可用」诚实结论)。
- [ ] AC3: import codex/claude-code 至少一种真实会话格式导入成功。
- [ ] AC4: dsh-evolve status 输出 registry 指针/历史/漂移(真实 registry 验证)。
- [ ] AC5: case 生命周期状态迁移单测 + 机械校验拒绝坏 case。
- [ ] AC6: 全量回归全绿。

## 约束与风险

- 上游只读, absorbed-from 头注; dsh-eval ESM vitest / evolution-controller CJS node:test。
- replay 依赖官方 @deepseek-ai/dsh-llm-replay 包, 若不可用则如实记录并降级为「记录 replay.dir 但不重放」。
- import codex 格式以 dsh-eval-src 的 import.ts 为基准(同构直接改)。

## 相关代码/文档

- research/feature-union-gap.md(P1 第 5-11 项)
- research/dsh-eval-src/packages/eval/src/import.ts / runner.ts(replay.dir)
- research/dsh-continual-evolve/src/benchmark.ts(case 生命周期)
- research/dsh-evolution/packages/evolution-feedback(质量反馈)
