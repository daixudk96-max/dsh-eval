# 实战复盘: system-evolver 驱动真实进化闭环(2026-08-25)

> 任务: .trellis/tasks/08-25-system-evolver-field
> 对象: `evaluate` logical preset(registry `C:/Users/daixu/.dsh/preset-registry`)
> 原则: 诚实记录——评测受限/失败如实标注, 不伪造分数, 不为 promote 而伪造。

## 1. 配置覆盖度盘点(P3-1)

### 1.1 system-evolver(packages/system-presets/presets/system-evolver/agent.cordis.yml, 34 行)

**定位: 设计稿, 不是可运行预设。** 无 preset.yml; 声明的 4 个 `evolution.*` 工具
(evolution.propose/mutate/candidate/run)在真实平台**不存在**——平台实现是
`packages/evolution-controller/bin/dsh-evolve.js` CLI + 库 API。forbidden 语义
(preset.promote/rollback/current、evaluation.*、holdout.*)依赖未实现的 Host
capability 层。

| 声明能力 | 真实平台对应 | 覆盖度 |
|---|---|---|
| evolution.propose(RCA→Proposal) | `lib/proposer.js propose()`(LLM 读失败证据) | ✅ 有, 经 CLI `--auto` |
| evolution.mutate(entry 级 mutation) | `createCandidate` mutations + 候选目录物化 | ✅ 有, 经 `--candidate` |
| evolution.candidate(staging 隔离区) | registry staging/ + proposal-check 门槛 | ✅ 有 |
| evolution.run(提交进 Frozen Epoch 验证) | `seal` + 双 run 评测 + Code Gate | ✅ 有, 经 CLI 闭环 |
| forbidden: preset.promote/rollback/current | promote 强制 approvalId; rollback 需 approvalId | ⚠️ 代码级强制, 非 capability 层 |
| forbidden: evaluation.* / holdout.* | 评测走只读子进程; 无 holdout 实现 | ⚠️ 进程边界, 非 capability 层 |

### 1.2 system-evaluator(packages/system-presets/presets/system-evaluator/agent.cordis.yml, 31 行)

同样为设计稿: 声明 evaluation.run/status/report/failures 4 个只读工具, 真实平台
对应 dsh-eval CLI(run/report/compare/import)+ `dsh-evolve failures` 聚合。
职责边界(评测只读 vs 进化只写)与实现一致, 但工具面未接线。

### 1.3 实战结论

- 进化 agent 的**意图**(RCA→Proposal→Mutation→Candidate, 只写候选)可完整落地,
  载体是 CLI 而非声明的工具面。
- 头号缺口: system-presets 工具面与真实平台能力脱节(设计稿未实现)。

## 2. 真实闭环(P3-2/P3-3)

### 2.1 失败证据与候选(P3-2)

- 证据: `eval/benchmarks/run-evalpreset-p2-2026-08-22.json`(真实超时失败,
  taskSuccessRate 0)。
- 候选(proposer LLM 独立产出, 非手工): `eval/presets/candidates/evolve-field-2026-08-25/`
  - hypothesis: persona 默认模式强制交互式 session pick, 无人值守评测中 agent
    ask-user 后停止; 加显式指令: 任务已提供 session 路径时直接用, 跳过 listing/asking。
  - mutations: agent.cordis.yml Default mode 段顶部加 unattended-mode 指令。
  - proposal.json 移出候选目录(避免污染 revision 内容集) →
    `eval/presets/candidates/evolve-field-2026-08-25.proposal.json`。

### 2.2 闭环运行(P3-3)

- 基准: `evaluate-field-baseline-benchmark.yaml` / `evaluate-field-candidate-benchmark.yaml`
  (同名 `evaluate-field` 保证 epoch 一致; 被测内容差异经 workspace/command 注入)。
- 第一轮(2026-08-25): baseline 45 步 / candidate 38 步, 均 taskSuccess 1.0;
  **gate INVALID — evaluation epoch changed**(两 yaml 曾用不同 name → digest 不同)。
  修复: 两 yaml 同名后重跑。← 真实 gate 正确拒绝不可比 epoch 的证据。
- 第二轮(2026-08-25, 同名后): **评测引擎外部故障**——clipa 上游(火山引擎 ark)
  返回 `InvalidSubscription: Your account (2125384065) does not have a valid
  CodingPlan subscription, or your subscription has expired`(HTTP 400):
  - candidate run: 第 1 步即 400 → 0 tokens, 651ms, taskSuccess 0;
  - baseline run: 前 17 步正常(24 toolCalls 全成功, 349K tokens), 第 18 步
    TRANSPORT 错误后重试, 最终同样撞上 InvalidSubscription → check 失败。
  - gate 判定: **FAIL — regression in: verification**(真实判定, 但证据被引擎
    故障污染, 不构成对候选的否定)。
- 结论: 本轮**不 promote**(诚实原则: 引擎故障期间不强行推进; 第一轮完整证据
  显示候选效率 45→38 步, 但 epoch 校验未过, 需订阅恢复后重跑确认)。

## 3. 缺口清单(≥3 条)

1. **system-presets 工具面未实现**(影响: 进化 agent 无法按声明工具工作; 建议:
   把 CLI 能力封装为 evolution.* 工具, 或把 preset 改为引用 CLI 的说明型组合)。
2. **--benchmark 必填校验过严**(影响: --benchmark-baseline/--benchmark-candidate
   双覆盖合法用法被拒; 建议: 已修复——任一来源存在即可, 均缺才报错)。
3. **epoch 语义易误用**(影响: baseline/candidate yaml 不同名 → 误判 INVALID;
   建议: 文档明确「同名同 case, 内容差异走 workspace」; 已在本轮修复并验证)。
4. **评测引擎外部依赖无降级路径**(影响: clipa 上游订阅失效时闭环整体不可用,
   且失败被 gate 如实记录为 FAIL; 建议: 增加 provider 健康探测/多 provider 回退,
   引擎故障时标注 `engine-fault` 而非计入候选判定)。

## 4. 结论

- system-evolver 的**意图**可完整落地(proposer 独立产出候选 → CLI 闭环 → gate
  判定), 但**工具面是设计稿**, 与真实平台能力脱节——这是头号工程缺口。
- 真实 gate 行为验证: epoch 不一致 → INVALID(第一轮); 引擎故障 → 如实 FAIL,
  不 promote(第二轮)。诚实原则贯穿。
- 候选本身(45→38 步, 效率增益 0.156)在订阅正常的第一轮有完整证据, 但 epoch
  校验未过; 需订阅恢复后重跑确认后再 promote。
