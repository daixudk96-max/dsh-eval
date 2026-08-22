# 设计文档 —— 评测侧工程化（split + fail-closed）

## 1. 模块边界

```
packages/dsh-eval/src/
├── benchmark.ts   # schema: cases[].split?: 'dev'|'guard'(默认 dev); parseBenchmark 增 split 过滤参数
├── types.ts       # BenchmarkCase.split?; EvalRun.split
├── runner.ts      # fail-closed gradeTrial/runCaseTrial; 缺 trace/坏 trace/超时 → failed
├── command.ts     # CLI: --split <dev|guard> 参数 → runBenchmark 透传
└── index.ts       # executeEval: 解析 --split, 过滤 cases, run.json 写 split
```

依赖方向不变: index → command → benchmark/runner;评测只读域。

## 2. split 切分数据流

```
benchmark.yaml cases[].split (默认 'dev')
        │
        ▼
parseBenchmark(text, baseDir) → cases 原样保留 split 字段
        │
        ▼
CLI: run <benchmark.yaml> --split <dev|guard>   # command.ts 增选项
        │
        ▼
executeEval: 按 split 过滤 cases → runBenchmark(effectiveBenchmark, ...)
        │
        ▼
run.json 顶层增 "split": "dev"|"guard"   # EvalRun.split
```

- **默认 dev**: 未写 split 的 case 视为 dev(向后兼容, 老 benchmark 全部算 dev)。
- **guard 集用途**: 候选锁定前不可见; 进化闭环中 guard 集单独跑, 不进变异 prompt(对应 dsh-self-evolving 的 SEALED 揭盲简化版)。

## 3. fail-closed 协议

现状(runner.js 检查): 缺 session log → `status:'error'`; 超时 → `timedOut:true` 但 status 仍 completed; 损坏 trace → parse 抛错。
改造:

| 情形 | 现状 | 改为 |
|---|---|---|
| 无 session log | `status:'error'` | 保持 error(已 fail-closed) |
| trace 损坏(parse 失败) | 抛错中断整个 run | 该 trial `status:'failed'`, notes 记原因, run 继续 |
| 超时(timedOut) | status:'completed' | `status:'failed'`, timedOut:true 保留 |
| check 命令失败 | grade taskSuccess:false | 保持(语义正确) |
| infra 型错误(模型限流等) | 试一次 | allowlist 重试 ≤2 次, 其余不重试 |

- **allowlist**: `RATE_LIMITED` / `OVERLOADED` / `CONNECTION_RESET`(照 dsh-self-evolving infra classifier 简化)。
- 重试计数: runCaseTrial 内循环, 每次重试用新 trialDir; 超过 2 次记 failed。

## 4. 状态与兼容

- 老 benchmark(无 split 字段) → 全部 dev, 行为不变。
- run.json 增 `split` 字段(老 run 文件无此字段, report/compare 读取时按 undefined 处理, 兼容)。

## 5. 权衡

| 取舍 | 选择 | 理由 |
|---|---|---|
| split 默认 | dev | guard 是「隐藏真值」, 默认不该全跑 |
| 超时记 failed 而非 error | failed | 语义: 任务未完成, 与缺 log(error)区分 |
| infra 重试上限 | 2 次 | 防无限循环, 与 self-evolving 一致 |
| allowlist 放常量 | 模块级 const | 零配置; 后续可进 schema |

## 6. 风险

- **重试语义**: 重试只针对 infra 错误(trial 未真正跑), 不重试任务失败; 单测覆盖。
- **guard 集泄露**: 本轮只做切分与记录, 不进进化闭环的 prompt 拼接——P2 才接入。
