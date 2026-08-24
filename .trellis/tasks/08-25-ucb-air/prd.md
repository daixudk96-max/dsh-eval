# PRD — P1 UCB-Air 多候选并行调度(设计先行)

## 背景
用户确认 UCB-Air(方向 1)要做但放后面;现启动。来源:timwhitez/dsh-self-evolving specs/03-evolution-algorithm.md —— expand-vs-evaluate 多臂老虎机调度:阈值 `(N + P_eval)^α >= T`(α=0.6)决定 expand 或 evaluate;UCB 分数 = 平均收益 + 探索项 `sqrt(2 ln N / n)`;候选失败聚类由 proposer 完成,trusted code 只做 schema 过滤。

当前平台现状:单轮驱动 —— dsh-evolve.js 一次一个候选(proposer 单假设或 --candidate 目录),seal 后单个评测,gates 通过即 promote。无并行、无选择、无预算分配。

前置缺口(本任务范围):
1. **多候选生成**:proposer 一次输出 W_p 个候选(不同主 hypothesis),语义去重(已有 proposal-check 的假设上限 3 与内容 hash 去重,需扩展为多候选产出)。
2. **多候选并行评测**:N 个候选并行跑 benchmark(子进程隔离,信任域不变)。
3. **UCB 调度器**:expand(生成新候选)vs evaluate(评测已有候选)的预算分配;选择哪个候选继续评测。

## 需求
- R1: `proposer.proposeMultiple({ count, runJson, baselineFiles, logicalId, llm, redactValues })` → 候选数组(每候选 {hypothesis, evidence, mutations, candidateFiles}),互为主假设(不同 hypothesis),内容 hash 互异;数量 ≤ MAX_HYPOTHESES(3)。单候选 propose() 保留兼容。
- R2: dsh-evolve.js `--candidates <n>`(默认 1)模式:生成 n 个候选 → 全部 seal → 并行评测(n 个子进程,Promise.all)→ 每候选跑 Code Gate(baseline 相同)→ UCB 选择或直接取最高分 → ACCEPTED + --approve → promote。评测失败候选如实记录,不伪造。
- R3: `lib/ucb.js`(新):`ucbScore(mean, n, totalN)` = mean + sqrt(2 ln(totalN+1)/n);`shouldExpand({expanded, evaluated, alpha=0.6})` = `(expanded + evaluated)^alpha >= expanded` 的等价判定(照 dsh-self-evolving 语义:expand 预算 = evaluated 预算,阈值控制节奏)。纯函数,无状态。
- R4: 多候选评测的 budget 记账:每候选 attempt 记账(复用 BudgetLedger);超预算立即停止新评测。
- R5: 文档:design.md 记录 UCB-Air 与 HGM Thompson 的取舍(吸收 UCB-Air 思路;HGM Thompson/wave-synchronous 因单机串行评测不吸收,理由入 design)。

## 验收(AC)
- AC1: proposeMultiple 单测:3 个互异候选;count 超上限截断;LLM 返回不足 count 时如实返回实际数;redact 生效。
- AC2: ucb.js 单测:score 单调性(n 同 mean 高者分高;mean 同 n 小者分高);shouldExpand 在预算边界行为符合 α=0.6 语义。
- AC3: dsh-evolve --candidates 2 真实闭环(clipa):2 候选 seal + 并行评测 + 双 gate 结果入 out/ 目录(gate-<i>.json),至少 1 个 ACCEPTED;--approve 后 promote 成功,审计含多候选记录。
- AC4: 预算受限(limit 覆盖 1 次评测)时第 2 候选评测被拒,错误明确。
- AC5: 全量回归:evolution-controller node:test 全绿;dsh-evolve 既有单候选模式行为不变。

## 范围外
- HGM Thompson clade parent 选择(不吸收)。
- wave-synchronous 并发控制(评测为独立子进程,天然隔离)。
- sealed 揭盲仪式/预算 ledger 分桶细化(已有 budget 记账,不扩桶)。
