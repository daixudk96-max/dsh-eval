# 基底选型独立评估报告 — 第二轮(新原则)

> 2026-08-23 — 第一轮报告见 base-selection-review.md。委托人在第一轮后
> 给出新原则, 本报告按新原则重新评估。独立 subagent 无上下文, 全读 9 仓
> 核心源码(重点仓: dsh-eval-src 12 文件全读 / dsh-self-evolution 8 文件 /
> dsh-continual-evolve 8 文件 / dsh-continual-harness 4 文件; 其余部分读)。

## 委托人新原则(评估标准最高优先)

1. **代码修改最小化**: 核心问题 = 拿哪个当基底, 到达完整闭环的改动量最小。
2. **平台绑定可以改**: Ubuntu/Docker/Bubblewrap 不设一票否决, 改为评估
   "去 Linux 绑定改到 Windows+Node" 的具体工作量。
3. **LLM-judge 是必要的**: 业务指标(报告质量/分析深度/归因)只能靠
   LLM-judge 按 rubric 打分, 与确定性 check 是两层而非二选一。
4. **LMAB**: 指 LLM Agent Benchmark / Terminal-Bench 类评测基准机制,
   纳入"评测基准机制兼容性"考察。

## 改动量评估表(9 仓)

| 仓库 | 可直接用 | 需小改 | 需重写/删除 | 需新增 | 改动量 |
|---|---|---|---|---|---|
| **dsh-eval-src** | 评测核心全部(runner 派生无头 dsh 子进程+会话日志采集 / metrics 单遍折叠 / **judge LLM-judge 按 rubric 打分** / benchmark YAML 校验 / report markdown / compare / trace / import) | judge rubric 支持 case 级; runner Windows spawn(.cmd/.bat 覆盖) | 无 | 进化治理层(从 self-evolution + continual-evolve 移植) | **中** |
| **dsh-self-evolution** | 进化闭环全部(engine baseline→propose→apply→evaluate→accept/rollback / snapshot sha256 不可变版本 / storage profile 锁+审计 / candidate overfit 检测 / profile 版本化) | 无重大 | **评测核心需重写**(其评测是 LLM-judge 子代理, 无确定性 check 无指标折叠) | 人工审批门 | **大** |
| **dsh-continual-evolve** | 审批门(requireGlobalApproval) / score.decide 非回归接受 / rollback 确定性逆编辑 / rubric AES-256-GCM 加密 / case 生命周期 draft→calibrating→frozen | 进化对象是 harness state 非 agent preset | **评测核心需重写**(两阶段子代理 LLM-judge, 无确定性 check) | 确定性回归检测层 | **大** |
| **dsh-continual-harness** | candidate-delta 证明 / 不可变 base system prompt / refine 冲突检测 / score.decideBenchmark | 审批门默认关需开启 | **评测核心需重写**(A/B LLM-judge) | 确定性回归检测 + 审批门 | **大** |
| **dsh-evolution** | curator skill 生命周期 / memory/skill-store | 无 | **monorepo 绑定致命**(20+ 包需在 DSH monorepo checkout 内) | 评测核心(无) | **大(不可行)** |
| **dsh-evolve** | 无 | 无 | 会话内插件增删, 无评测无治理 | 评测+治理全部 | **大** |
| **dsh-evolve-modes** | 无 | 无 | Web 规则提案, 无评测无版本化 | 评测+治理全部 | **大** |
| **dsh-self-evolving** | 无(平台层不可用) | 无 | **平台致命**(Ubuntu/Docker/Python+Bubblewrap/Harbor/Terminal-Bench, 172 文件重度 Linux 绑定) | 评测+治理全部(且需去 Linux 绑定) | **大(不可行)** |
| **dsh-skill-evolve** | 无 | 无 | 最小技能提取, 无评测无治理 | 评测+治理全部 | **大** |

## 9 仓排序(改动量最小 → 最大)

1. **dsh-eval-src**(中)— 评测核心 100% 直接可用 + Windows+Node 兼容, 已含
   确定性 check + **LLM-judge 两层**, 只需新增进化治理层。
2. **dsh-self-evolution**(大)— 进化闭环最完整(快照/版本/回滚/候选/overfit),
   但评测核心需整体重写。
3. **dsh-continual-evolve**(大)— 审批门/评分决策/回滚/rubric ACL 最成熟,
   但评测核心需重写, 进化对象需适配。
4. **dsh-continual-harness**(大)— candidate-delta 证明/不可变 base 最严谨,
   但评测核心需重写, 审批门默认关。
5. **dsh-evolution**(大, 不可行)— monorepo 绑定, 无法独立运行。
6. **dsh-evolve**(大)— 无评测无治理。
7. **dsh-evolve-modes**(大)— 无评测无版本化。
8. **dsh-skill-evolve**(大)— 无评测无治理。
9. **dsh-self-evolving**(大, 不可行)— 平台致命, 去 Linux 绑定工作量不可接受。

## 冠军改造路径(dsh-eval-src)

- **Phase 0** 基底确认(0.5 人日): 保留全部 packages/eval/src/, 无删除。
- **Phase 1** 评测侧小改(1-2 人日): judge.ts rubric 支持 case 级; runner.ts
  Windows spawn .cmd/.bat 覆盖; 新增 evidence.ts(失败证据导出给进化层)。
- **Phase 2** 移植进化治理(3-5 人日, 从 dsh-self-evolution): snapshot.ts
  (不可变版本+回滚) / storage.ts(审计) / candidate.ts(overfit 检测) /
  profile.ts(内容版本化) / engine.ts 循环骨架(但 evaluateProfile 替换为
  dsh-eval-src 的 runBenchmark —— 移植核心工作量)。
- **Phase 3** 移植审批门+门禁(2-3 人日, 从 dsh-continual-evolve):
  approval.ts(人工审批) / score.ts decide(确定性回归门) / rubric.ts(加密 ACL)。
- **Phase 4** 移植 candidate-delta 证明(1-2 人日, 从 dsh-continual-harness)。
- **Phase 5** 两层门禁接线(1-2 人日): 确定性回归检测 + LLM-judge 业务分。
- **总工作量: 约 8-13 人日(1-2 周)**, 评测侧 1.5-2.5 人日, 进化治理 6-10 人日。

## 诚实声明

1. 无单一仓提供完整闭环; 冠军是「评测核心 + 移植进化治理」的组合, 不是
   "一个仓直接用"。
2. dsh-eval-src 的评测是「派生无头 dsh 子进程重跑 benchmark」模式; 若目标
   是分析已有日志, 走 import.ts 或小改 trace 采集路径。
3. 移植的进化模块依赖 dsh-subagent/dsh-agent peerDeps, 需确认环境可用。
4. **dsh-self-evolving 平台致命**(Ubuntu/Docker/Bubblewrap/Harbor/Terminal-Bench),
   去 Linux 绑定工作量不可接受 —— 委托人认为"可以改", 评估者具体核算后
   判定: 172 文件重度 Linux 绑定 + Python 依赖 + Bubblewrap 沙箱无 Windows
   等价物, 改造量超过在 dsh-eval-src 上加进化层。
5. dsh-evolution monorepo 绑定致命, 不可独立。
6. **LMAB/Terminal-Bench 兼容性**: dsh-eval-src 的 benchmark.yaml(确定性
   check + LLM-judge)Windows+Node 可跑, 最兼容; dsh-self-evolving 的
   Terminal-Bench 绑定 Linux/Docker 不可移植; 其余进化仓 LLM-judge rubric
   A/B 可跑但无确定性 check。

## 与本平台现状对照(第二轮)

| 评估者建议 | 本平台现状 |
|---|---|
| 评测核心 = dsh-eval-src(runner/metrics/judge/benchmark/report/compare) | ✅ packages/dsh-eval 同构吸收(13 文件对照, absorbed-from 注释) |
| judge LLM-judge 按 rubric 打分 | ⚠️ 已实现 buildJudgePrompt rubric 钩子, **但 runner 内嵌 judge 从未真实执行**(host profile 无 llm, verdict 恒 null, 外部 rubric-score.mjs 补分) |
| 进化治理移植(snapshot/storage/candidate/approval/score) | ✅ 自研实现(preset-registry 版本化+WAL / gate 确定性判定+rubric 规则 / promote 强制 approvalId / rollback / proposer / budget / near-dup / redact) |
| 总工作量 8-13 人日 | 已投入等效工作量, 治理层深度超过移植清单(崩溃恢复/效率维度/near-dup/budget) |
