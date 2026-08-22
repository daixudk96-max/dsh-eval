# 评测侧工程化（benchmark split + runner fail-closed）

## Goal

把 dsh-eval 评测侧补上两个工程化缺口(照 `dsh-self-evolving` 的 split / fail-closed 思路落地到同语言基座):
评测集可切分 dev/guard,防止候选「看着 dev 集过拟合」;运行失败(缺失/损坏/超时)默认记 FAIL,不静默吞掉。

## Requirements

1. **R1 split 切分**: benchmark YAML 的 case 支持 `split: dev | guard`(默认 dev);
   `dsh --profile eval run <benchmark.yaml> --split <dev|guard>` 只跑对应子集,
   run.json 记录所用 split。
2. **R2 fail-closed**: runner 对缺失 trace / 损坏 trace / 超时 trial **默认判失败**,
   不得记成成功或静默跳过;仅 allowlist 的 infra 型失败(如模型限流)可重试,上限 2 次。
3. **R3 双集真实跑通**: 用现有 benchmark(如 evaluate-preset / fix-multiply)做一次 dev/guard 切分,
   两集各真实跑通一轮,run.json 带 split 字段,验证 R1/R2 端到端。

## Constraints

- 同语言基座(dsh-eval TS src)直接改,不重写主体;头部加 `# absorbed-from` 追溯(来源: dsh-self-evolving 的 split/fail-closed 协议, 概念吸收)。
- 评测只读域不变;上游只读;零新依赖。
- 真实运行为准;沙箱/引擎限制如实记录。

## Acceptance Criteria

- [ ] **AC1**: `parseBenchmark` 接受 `cases[].split`; `--split <dev|guard>` 过滤生效, 默认 dev
- [ ] **AC2**: run.json 顶层含 `split` 字段(所跑子集)
- [ ] **AC3**: runner 缺 trace / 坏 trace / 超时 trial → `status: failed`(默认), 不再被计为 completed
- [ ] **AC4**: 仅 allowlist infra 错误可重试(≤2 次), 其他失败不重试; 单测覆盖
- [ ] **AC5**: dev/guard 双集真实运行一轮成功(两个 run.json, split 字段正确)

## Notes

- 轻量改造为主, 但涉及 public schema + runner 行为, 按复杂任务补 design.md + implement.md。
