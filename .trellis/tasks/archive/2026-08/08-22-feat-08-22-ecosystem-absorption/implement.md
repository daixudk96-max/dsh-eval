# 执行清单 —— 生态基座吸收与 rubric 两层判定

> 每步完成后勾选; 验证命令与验收标准见 prd.md(AC1..AC8)。
> 顺序: P0(rubric) → P1(评测工程化) → P2(进化侧) → P3(治理, 可选)。

## P0 rubric 集成(本任务主体)

- [x] **P0-1** 新增 `packages/dsh-eval/src/rubric.ts`(TS 源; 构建产物在 lib/rubric.js):
      `encryptRubric/decryptRubric/deriveKey/resolveRubricKey/isEncryptedRubric/rubricKeyFilePath`
      — 照 `research/dsh-continual-evolve/src/rubric.ts` 改写。
      头部注释 `# absorbed-from: ZK-Andy/dsh-continual-evolve/src/rubric.ts`。
      密钥解析 4 级: configKey → env DSH_EVOLVE_RUBRIC_KEY → <baseDir>/evolve/rubric.key(0600 自动生成) → dev key(warn)。
      信封: `v1:<base64url(iv)|base64url(tag)|base64url(data)>` AES-256-GCM, key=sha256(passphrase)。
- [x] **P0-2** 新增 `packages/evolution-controller/lib/aggregate.js`(CJS):
      `aggregate(cells)`(失败 cell 排除于均值, 全失败 case 无均值, 顶层展开 case 键 + 显式 perCase 对象)
      + `entryFromCells` + `decide`(strictly-higher overall + 逐 case 回归容差 + 失败 cell 协议)
      + `flagMaterialDrift`(caseHash 漂移 → 重标 failed) + `decisionReport`。
      `# absorbed-from: ZK-Andy/dsh-continual-evolve/src/score.ts`。
- [x] **P0-3** `packages/dsh-eval/src/types.ts` 增量: `BenchmarkJudge.rubricText? / rubricCipher?`(明文/加密双输入面)。
- [x] **P0-4** `packages/dsh-eval/src/benchmark.ts` 增量: judgeSchema 增 `rubricText`/`rubricCipher`(互斥 refine,
      至多其一); parseBenchmark/loadBenchmark 增 opts(RubricKeyOptions); rubricCipher 加载时解密 → 统一输出 `judge.rubric` 明文。
- [3] **P0-5** `packages/dsh-eval/src/judge.js` → judge.ts: **零改动** — buildJudgePrompt 已有 rubric 钩子
      (system += ['Rubric:', judge.rubric]), 明文直通。
- [3] **P0-6** `packages/evolution-controller/lib/gate.js` 增量: evaluateGate 增 `rubricScore/rubricMinScore/rubricRegressions`;
      `rubricScore < rubricMinScore → FAIL`; `rubricRegressions.length > 0 → FAIL`; 无 rubric 输入时跳过(向后兼容);
      PASS 分支携带 rubric 证据返回。
- [3] **P0-7** `packages/evolution-controller/lib/controller.js` 增量: `evaluate(runId, {baseline, candidate, gateOverrides, rubric})`;
      rubric 透传进 gate + 审计 ledger 记录 `{score, minScore, regressions}` + run.rubric 证据。
- [x] **P0-8** 测试全绿:
      - dsh-eval(TS src, vitest): **159/159 通过**(含 rubric.spec.ts 12 项: 加解密往返/随机 IV/篡改/明文透传/key 解析/本地 key 文件/benchmark 集成 rubricText+rubricCipher+互斥+错误 key fail-loud)
      - typecheck ✅ build ✅ 经 prepare-sdk.mjs 全流程(mirror 内 pnpm install → tsc → vitest → npm pack, DSH checkout 未变)
      - aggregate 9/9 / gate-rubric 5/5 / controller-rubric 2/2 / controller 全量回归 ✅(node:test)
- [x] **P0-9** 真实闭环(第 4 轮, research/evolution-rubric.mjs):
      变异 = persona 补「结论必须点名失败/风险」; baseline/candidate 由 evaluate-preset-rubric-baseline/candidate.yaml
      真实运行(taskSuccess 均 1.0, 24 vs 35 steps); runner 内 judge 因 host 无 llm 服务未执行(verdict null) →
      独立 LLM judge 脚本 research/rubric-score.mjs 按 rubric 对 REPORT.md 真实打分(clipa deepseek-v4-flash):
      **baseline 90/100, candidate 80/100**——两份 REPORT.md 实质相同, 变异无真实提升。
      结果: Gate = **INCONCLUSIVE**(overall gain 0.000 ≤ minEffect 0.05) + rubric 证据入审计
      `{score:80, minScore:60, regressions:["final-answer quality"]}`; 不 promote, current 不动。
      ✅ 证明两层判定真实工作: 无改进候选被诚实拒绝, 未伪造 promote。
      产物: run-rubric-baseline.json / run-rubric-candidate.json / *.rubric.json / 审计 ledger 4 事件(created→candidate-created→sealed→gate)。

## P1 评测侧工程化(下一阶段)

- [ ] benchmark.yaml `split: dev|guard` 字段 + runner 按 split 过滤 case
- [ ] runner.js fail-closed: 缺失/损坏/超时默认 FAIL, 仅 allowlist infra classifier 重试(≤2)
- [ ] dev/guard 双集真实跑通(现有 case 集切分)

## P2 进化侧(再下一阶段)

- [ ] `lib/budget.js`: ledger(proposal/solver/辅助/failed), 不信候选自报
      — 照 `dsh-self-evolving/packages/dsh-self-evolving/src/budget/ledger.ts` 改写
- [ ] `lib/proposer.js` 或 research/evolution-proposer.mjs: 失败簇 → hypothesis+evidence+preservation tests;
      多假设(W_p=3)不同主 hypothesis; 拒 no-change/test-only/comment-only
      — 照 `dsh-self-evolving/packages/dsh-self-evolving-proposer/src` 协议改写
- [ ] registry.promote 近重复检测 — 照 `continual-evolve/src/promotion.ts` 改写
- [ ] evolution-real 第 4 轮: 真实失败簇 → proposer → 候选 → rubric+gate → promote

### P3 治理(可选)

- [ ] 失败类聚合 `lib/failure-clusters.js` — 照 `continual-evolve/src/failures.ts`
- [ ] 审查脱敏 — 照 `dsh-evolution/packages/evolution-review/src/redact.ts`

## 验证命令(每步后)

```bash
# 单测(沙箱注意: 单进程模式)
node test\judge.test.js   # 或对应 node:test 单文件
node packages/evolution-controller/test/gate.test.js
node packages/evolution-controller/test/aggregate.test.js

# 真实运行
node E:\github\dsh\apps\cli\lib\bin.js --profile eval run E:\github\dsh-eval\eval\benchmarks\fix-multiply-benchmark.yaml --out <out>.json
node research/evolution-real.mjs   # 或新 research/evolution-rubric.mjs
```

## 收尾

- [ ] research/evolution-plan.md §5 状态表勾选与实施一致
- [ ] 全部被吸收模块头部 `absorbed-from` 注释存在
- [ ] git commit(任务内分批), 提交后跑 /trellis:finish-work
