# 执行清单 —— 评测侧工程化（split + fail-closed）

> 每步完成后勾选; 验证命令与验收标准见 prd.md(AC1..AC5)。
> 构建/测试经 prepare-sdk.mjs 全流程(mirror 内 pnpm install → tsc → vitest → npm pack)。

## P1-1 split 切分

- [x] **P1-1a** `src/benchmark.ts`: `benchmarkCaseSchema` 增 `split: z.enum(['dev','guard']).default('dev')`;
      `resolveCase` 透传 split; `parseBenchmark` 增可选 `splitFilter?: 'dev'|'guard'`,
      过滤 cases; 空子集报错 `benchmark has no cases in split "<x>"`。
- [x] **P1-1b** `src/types.ts`: `BenchmarkSplit` 类型; `BenchmarkCase.split?`;
      `EvalRun.split?`(benchmark 运行写入, import 不写)。
- [x] **P1-1c** `src/command.ts` + `src/index.ts`: CLI `--split <dev|guard>` 解析(非法值报错);
      `executeEval` loadBenchmark 过滤 + runOptions.split 透传。
- [x] **P1-1d** 测试(benchmark.spec.ts +5): 默认 dev / 显式 guard 过滤 / 空子集报错 /
      非法值拒绝 / loadBenchmark 同语义。
- [x] **P1-1e** `# absorbed-from: timwhitez/dsh-self-evolving`(split 概念)注释(头部 + README)。

## P1-2 runner fail-closed

- [x] **P1-2a** `src/runner.ts`:
      - 缺 session log → 保持 error;
      - trace parse 失败 → `status:'failed'` + error, run 继续;
      - 超时且有 trace → `status:'failed'` + timedOut:true(超时无 trace 仍 error);
      - infra allowlist(`RATE_LIMITED|OVERLOADED|CONNECTION_RESET`)重试,
        最多 INFRA_MAX_ATTEMPTS=3 次 spawn, 重试用 `-r<n>` 目录后缀;
      - 模块级 `INFRA_RETRYABLE` 常量。
- [x] **P1-2b** 测试(runner.spec.ts):坏 trace failed / 超时有 trace failed /
      infra 重试(attempt 文件断言 2 次 spawn) / 非 infra 不重试(断言 1 次)。

## P1-3 真实双集运行

- [x] **P1-3a** `eval/benchmarks/split-demo-benchmark.yaml`(dev/guard 各 1 case);
      fix-multiply-benchmark.yaml 显式 `split: dev`。
- [x] **P1-3b** 真实跑 dev + guard(clipa):
      run-split-demo-dev.json(split=dev, fix-multiply-dev, taskSuccess 1.0),
      run-split-guard.json(split=guard, fix-multiply-guard, taskSuccess 1.0);
      另真实验证超时 fail-closed(evaluate 任务两次超时 → status=failed, timedOut=True)。
- [x] **P1-3c** dsh-eval README 更新(--split 小节 + Fail-closed trial outcomes 小节)。

## 验证命令

```bash
# 全流程(mirror 内 typecheck + build + vitest + pack)
node packages/dsh-eval/scripts/prepare-sdk.mjs --dsh E:\github\dsh

# 真实双集
node E:\github\dsh\apps\cli\lib\bin.js --profile eval run eval\benchmarks\fix-multiply-benchmark.yaml --out run-dev.json --split dev
node E:\github\dsh\apps\cli\lib\bin.js --profile eval run eval\benchmarks\fix-multiply-benchmark.yaml --out run-guard.json --split guard
```

## 收尾

- [ ] evolution-plan.md 勾选 P1 状态
- [ ] git commit(分批), 然后 /trellis:finish-work
