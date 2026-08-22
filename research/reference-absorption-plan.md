# 参考吸收清单(Reference Absorption Plan)

> 目的:把 DSH 生态 + 通用 Agent 生态的可借鉴点逐条列清,每条标注**借鉴关系**并对应到本项目落地文件。
>
> ## 借鉴关系定义(每个参考点必须标注其一)
>
> | 关系 | 含义 | 本项目使用 |
> |---|---|---|
> | 🔧 **在基础上重改** | 直接 fork 上游代码库或在其上修改 | **零项**——承诺不 fork(上游只读、升级覆盖、场景不同) |
> | 💡 **借鉴思路** | 参考对方的抽象/流程/架构,自己写实现 | 绝大多数 |
> | ⚙️ **借鉴代码原理** | 读懂对方代码/算法机制,用自己的代码重现(不复制) | fail-closed normalizer、budget ledger 落地时 |
> | ✅ **印证已有设计** | 我们已有同款语义,对方只是交叉验证 | data/control plane 分离、approval 人审 |

> 更新:2026-08-22(基于 dsh-self-evolving 源码精读 + 生态多轮核验 + 9 仓库克隆)

## 0. 仓库状态(含借鉴关系)

| 参考仓库 | 状态 | 与我们的关系(逐项见 §2) |
|---|---|---|
| timwhitez/dsh-self-evolving | ✅ 已 clone(326 文件) | 💡 借鉴思路为主(proposer 协议/fail-closed/预算概念) |
| hccccc01333/dsh-eval | ✅ 已 clone(40 文件) | 💡 借鉴思路 + **接口格式兼容**(benchmark.yaml 对齐),实现自研 |
| ZK-Andy/dsh-continual-evolve | ✅ 已 clone(142 文件) | 💡 借鉴思路(数据模型对比) |
| lmzhen/dsh-evolution | ✅ 已 clone(242 文件) | 📄 印证已有(plane 分离我们已有) |
| Lhy723/dsh-self-evolution | ✅ 已 clone(105 文件) | 💡 待精读(Profile 闭环参考) |
| csyangwen/dsh-memory-evolve | 📄 文档已研 | 💡 思路参考(记忆/技能,低优先) |
| william-jin-cmu/dsh-evolve | ✅ 已 clone(31 文件) | 💡 思路参考(热挂载,对比用) |
| dmsobtl/dsh-skill-evolve | ✅ 已 clone(10 文件) | 💡 思路参考(skill 沉淀,低优先) |
| GraySilver/dsh-evolve-modes | ✅ 已 clone(45 文件) | 💡 思路参考(人审 Web 面板,对比) |
| jason215/dsh-continual-harness | ✅ 已 clone(65 文件) | 💡 思路参考(持续 refine,低优先) |
| model-registry-pro(调研) | 📄 调研记录 | ✅ 印证已有(六原语语义,我们已自研同款) |

## 1. 已吸收(落地完成)

| 点 | 来源 | 借鉴关系 | 落地文件 |
|---|---|---|---|
| benchmark YAML schema | hccccc01333/dsh-eval | 💡 思路+格式兼容(接口对齐,实现自研) | eval/benchmarks/*.yaml + packages/dsh-eval/lib/benchmark.js |
| 会话日志 import(report 指标表) | hccccc01333/dsh-eval | 💡 思路 | packages/dsh-eval/lib/import.js |
| compare 命令 | hccccc01333/dsh-eval | 💡 思路 | packages/dsh-eval/lib/compare.js |
| 内容寻址不可变 revision + 指针 + CAS promote | 自研(语义参考 model-registry-pro) | ✅ 印证已有(对方是参考系,非来源) | packages/preset-registry/lib/registry.js |
| Code Gate 确定性判定(无 LLM 自证) | 自研 | ✅ 印证已有(dsh-self-evolving 的 TCB 也同思路) | packages/evolution-controller/lib/gate.js |
| promote 强制 approvalId 人审 | 自研 | ✅ 印证已有(dsh-continual-evolve 全局写默认 approval 同思路) | packages/evolution-controller/lib/controller.js |
| WAL 审计 + 崩溃恢复 | 自研 | ✅ 印证已有(dsh-self-evolving 的 hash-chain journal 同思路,更重) | packages/preset-registry/lib/fs-store.js |

## 2. 待吸收(每项标注借鉴关系)

### P0 —— 补上「失败归因/聚类」缺口(用户确认的方向)

| # | 点 | 来源 | 借鉴关系 | 落地文件(目标) |
|---|---|---|---|---|
| 1 | 归因交给变异 agent:proposer 读失败证据 → hypothesis + evidence + preservation tests | dsh-self-evolving specs/03 §9 | 💡 思路(机制照搬,代码自研) | 新 research/evolution-proposer.mjs + 改造 evolution-real-fix2.mjs;mutations 元数据 |
| 2 | 候选质量门槛:拒 no-change / test-only / comment-only | dsh-self-evolving specs/03 §9 | 💡 思路 | packages/evolution-controller/lib/gate.js 或新 lib/proposal-check.js |
| 3 | 多 hypothesis(W_p=3):一次展开 ≥2 个不同主假设,语义 diff 去重 | dsh-self-evolving specs/03 §9 | 💡 思路 | 进化脚本 createCandidate 一次 2-3 条 mutations + 去重 |
| 4 | 数据切分 dev-observed / dev-guard:guard 不进变异 prompt | dsh-self-evolving specs/04 §3 | 💡 思路(简化:两级切分,不做 sealed 仪式) | eval/benchmarks/ guard 子集 + benchmark.yaml split 字段 |

### P1 — 评测/门禁工程化(从 dsh-self-evolving 借鉴)

| # | 点 | 来源 | 借鉴关系 | 落地方式 |
|---|---|---|---|---|
| 5 | fail-closed normalizer:缺失/损坏/超时默认 FAIL,不丢弃 trial | dsh-self-evolving specs/04 §5-6 + normalizer.ts | ⚙️ 代码原理(读其 normalizer 实现,自研等价物) | packages/dsh-eval/lib/runner.js gradeTrial 分支 |
| 6 | 预算 ledger(proposal/solver 分账) | dsh-self-evolving specs/04 §12 + budget/ledger.ts | ⚙️ 代码原理 | 新 packages/evolution-controller/lib/budget.js |
| 7 | 崩溃恢复 replay 测试(进程 kill → 重放) | dsh-self-evolving specs/03 §15 + 测试 | ⚙️ 代码原理(测试手法) | packages/preset-registry/test/crash-replay.test.js |
| 8 | sealed 一次性揭盲(候选锁定后冻结评测集) | dsh-self-evolving specs/04 §8-9 | 💡 思路(简化:候选锁段) | 进化脚本加 candidate-lock 段 |

### P2 — 治理/记忆增强(低优先,可选)

| # | 点 | 来源 | 借鉴关系 | 落地方式 |
|---|---|---|---|---|
| 9 | data/control plane 分离(模型只产 proposal) | lmzhen/dsh-evolution | ✅ 印证已有(controller 唯一 writer) | 文档化 docs/evolution-architecture.md |
| 10 | Sediment→Proposal→Guard→Approval→Apply→Rollback 对比 | ZK-Andy/dsh-continual-evolve | ✅ 印证已有(我们的 DRAFT→SEALED→EVALUATING→ACCEPTED→PROMOTED 同构) | research/continual-evolve.md 结论追加 |
| 11 | 成功会话提炼 skill | dmsobtl/dsh-skill-evolve | 💡 思路 | 可选:成功后沉淀 REPEAT.md |
| 12 | session 内热挂载插件(evolve_add/remove) | william-jin-cmu/dsh-evolve | 💡 思路 | 对比 promote 后导出 vs 热加载 |

## 3. 落地顺序建议

1. P0-1(归因给变异 agent)—— research/evolution-proposer.mjs,真实数据演示
2. P0-2/P0-3(候选门槛 + 多 hypothesis)—— 确定性检查 + 单测
3. P0-4(guard 切分)—— benchmark.yaml split 字段
4. P1-5/6/7(评测工程化)
5. P2 视需要

## 4. 明确不吸收(有理由)

- 🔧 在基础上重改:零项,所有参考均为借鉴/印证,不 fork
- HGM Thompson / UCB-Air / wave scheduler:💡 思路也不吸收(要 Ubuntu+Docker+Bubblewrap,单轮驱动不需要)
- Harbor/Terminal-Bench 适配:不吸收(自有 benchmark)
- sealed 揭盲仪式(29 task 加密切分):简化成 guard 两级
