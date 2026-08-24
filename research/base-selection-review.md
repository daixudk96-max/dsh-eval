# 基底选型独立评估报告(base-selection-review)

> 2026-08-23 — 由独立 subagent(无本会话上下文、无先入立场)对 research/ 下
> 9 个 DSH 生态克隆仓库逐仓读源码后给出。目的: 检验「哪个仓库最适合做
> 评测+自进化平台的基底」, 回应自研 vs 直接改造的质疑。

## 结论

- **评测侧**: 只有 `dsh-eval-src` 实现了确定性 check 脚本评测(其余进化类
  仓库全部用 LLM-judge 打分)—— 评测能力满分, 依赖仅 commander/js-yaml/zod,
  113 测试 100% 分支/行覆盖。
- **进化侧**: 没有单一仓库提供完整闭环, 三个最强进化仓库各缺一块。
- **推荐基底: dsh-eval-src**(评测核心), 其上补齐进化治理层(借鉴
  dsh-self-evolution 快照/版本/回滚 + dsh-continual-evolve 人工审批/代码门)。

## 9 仓评分表(1–5)

| 仓库 | 评测能力 | 进化治理 | 代码质量可改造 | 平台兼容 | 维护活跃 |
|---|---|---|---|---|---|
| dsh-eval-src | **5** | 1 | **5** | **5** | 4 |
| dsh-self-evolution | 3 | 4 | 4 | 4 | 3 |
| dsh-continual-harness | 3 | 4 | 4 | 4 | 4 |
| dsh-continual-evolve | 3 | **5** | 4 | 4 | 4 |
| dsh-evolution | 2 | 4 | 2 | 2 | 2 |
| dsh-evolve | 1 | 2 | 3 | 4 | 3 |
| dsh-evolve-modes | 1 | 2 | 3 | 4 | 3 |
| dsh-self-evolving | 3 | 4 | 3 | **1** | 3 |
| dsh-skill-evolve | 1 | 1 | 3 | 4 | 2 |

## 逐仓一句话

1. **dsh-eval-src** — 纯评测平台; `dsh eval run benchmark.yaml` 逐 case×trial
   派生无头 dsh 子进程(隔离 DSH_HOME、plain-JSONL、workspace-write/never-approval),
   `expected.check`(exit0=taskSuccess)+ `expected.tool`(子串=toolSelectionAccuracy)
   确定性打分; metrics 单遍折叠 trace; report/compare/import 齐全。
2. **dsh-self-evolution** — 唯一同时含评测+进化闭环的插件; EvolutionEngine:
   冻结 benchmark(frozen:true+sha256)→ Target 子代理 → 私有 Evaluator 子代理
   (仅 rubric)→ Optimizer(仅公开证据)→ `candidate.score > reference.score +
   minImprovement`(严格 >, 平局回滚)→ 快照验证/漂移检测/单 profile 互斥锁。
   **评测是 LLM-judge rubric, 非确定性脚本; 无人工审批门(自动接受)。**
3. **dsh-continual-harness** — 持续自精炼; ESP 协议(harness_state.json +
   refinements.jsonl 追加式), `harness_benchmark` 同轮 A/B, score.ts 代码门
   (regressionTolerance/maxFailedCells), requireGlobalApproval 审批, 确定性回滚;
   评测是 A/B LLM-judge。
4. **dsh-continual-evolve** — 版本化/可审计/可回滚 harness 状态进化; score.ts
   代码门(严格 >、逐 case 回归、失败 cell 协议、flagMaterialDrift 材料漂移),
   benchmark.ts 含 rubric AES-256-GCM 加密、case 生命周期 draft→calibrating→frozen,
   rollbackRejectedCandidate 确定性回滚; requireGlobalApproval true; 527 测试;
   评测是 LLM-judge rubric A/B。
5. **dsh-evolution** — Hermes 式插件家族, 必须跑在 DSH monorepo 内, 不可独立。
6. **dsh-self-evolving** — 重型规格驱动 RSI 引擎; **硬性要求 Ubuntu 24.04/
   Docker/Python+Bubblewrap/Harbor/Terminal-Bench, 平台致命**(Windows 不可用)。
7. **dsh-evolve** — 会话内自增删 cordis 插件; 无评测无治理。
8. **dsh-evolve-modes** — Web 规则提案; 无评测无版本化。
9. **dsh-skill-evolve** — 最小技能提取; 无评测无治理。

## LLM-judge vs 确定性 code gate(选型关键分歧)

| 维度 | 确定性 check(我们的评测核心) | LLM-judge rubric(生态主流) |
|---|---|---|
| 判定对象 | 可机械验证的事实: 任务成功/失败、测试 PASS、文件未篡改 | 业务质量: 报告完整性、回答有用性、归因准确性、风险识别 |
| 可复现 | 完全确定, 同输入同输出 | 概率性, 需 temperature 0 + 重复抽样 |
| 覆盖 | 只覆盖"硬"指标, 业务指标不可表达 | 可表达任意业务维度, 但可能幻觉/偏好 |
| 成本 | 零(脚本) | 每次判定消耗 token |

**结论(本报告立场)**: 两者不是二选一, 是**两层**:
- 确定性 gate = 安全网(回归、失败 cell、效率、篡改检测)—— 防止明显劣化进入;
- LLM-judge = 业务指标层(按 rubric 打业务分: 报告质量/完整性/分析深度)——
  决定"变好了没有"。

纯 code gate 无法回答"业务指标变好了吗"(用户观点, 采纳);
纯 LLM-judge 无法保证安全底线(生态缺陷: self-evolution 无审批自动接受)。
本平台 P0 已按此双层设计实现: `packages/dsh-eval/lib/rubric.js`(AES-256-GCM
rubric 加解密)+ `packages/evolution-controller/lib/aggregate.js`(失败 cell 排除
聚合)+ gate.js rubric 规则(rubricScore<min→FAIL、逐维回归→FAIL)。

## 冠军改造清单(独立评估者给出, 本平台现状对照)

| 评估者建议 | 本平台现状 |
|---|---|
| 候选生成(复用 Optimizer 子代理模式) | ✅ lib/proposer.js(LLM 失败证据→假设+变异) |
| 不可变版本封存(快照+sha256) | ✅ preset-registry(revisions/<digest>/ 内容寻址) |
| 确定性代码门(严格>+逐case回归+失败cell协议+材料漂移) | ✅ lib/gate.js + lib/aggregate.js |
| 人工审批门(requireGlobalApproval) | ✅ promote 强制 approvalId(更强: 代码拒绝) |
| 可审计回滚(逆编辑回滚) | ✅ rollback(O(1) 切指针) + WAL 审计 |
| expected.check 升级为多脚本+效率/质量门 | ✅ 效率维度 gate + benchmark split dev/guard |

## 诚实致命问题(评估者声明)

- dsh-self-evolving: 平台致命(Ubuntu/Docker), 排除。
- dsh-evolution: 不可独立(monorepo 绑定), 排除。
- dsh-evolve / dsh-evolve-modes / dsh-skill-evolve: 无评测能力, 排除。
- dsh-self-evolution / dsh-continual-harness / dsh-continual-evolve:
  评测方式不匹配(LLM-judge), 若选其一需重写评测核心, 改造量大于在
  dsh-eval-src 上加进化层。
