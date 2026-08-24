# design — P1 UCB-Air 多候选并行调度

## 1. 吸收范围与取舍(对照 dsh-self-evolving specs/03)

| 上游机制 | 吸收? | 理由 |
|---|---|---|
| UCB-Air expand-vs-evaluate 调度(α=0.6 阈值) | ✅ 吸收思路 | 多候选时决定「生成新候选」还是「评测已有候选」的预算节奏;纯函数可单测 |
| UCB 分数 mean + sqrt(2 ln N / n) | ✅ 吸收 | 选择评测收益最高的候选臂 |
| W_p=3 候选、互异主假设、语义去重 | ✅ 吸收 | 已有 proposal-check 假设上限 3 + 内容 hash 去重,扩展为多候选产出 |
| HGM Thompson clade parent(Beta 采样) | ❌ 不吸收 | 面向长时多轮谱系选择;单轮驱动(每轮人工 approvalId 拍板)下收益不抵复杂度;且我们已有 near-dup 防重复 |
| wave-synchronous 并发 + 固定 RNG 流 | ❌ 不吸收 | 评测是独立子进程(信任域边界),天然隔离,无需冻结快照协议 |
| growing archive 低分节点不删 | ✅ 已印证 | registry 历史链 + GC 只清未 seal DRAFT 已有同语义 |
| budget ledger 分桶 | ✅ 已印证 | BudgetLedger 已有(proposal/attempt/failed),本任务只做多候选记账 |

## 2. 数据流(--candidates n)

```
baseline 评测(run.json, 失败证据)
  → proposeMultiple({count:n, runJson:baseline, baselineFiles:current, ...})
      → n 个 {hypothesis, evidence, mutations, candidateFiles}(proposal-check 逐候选校验, 内容 hash 互异)
  → 每候选: newRun? 否 —— 同 run 多候选: createCandidate×n(hypothesis 互异) → seal×n
  → 并行评测: Promise.all(n × runBenchmark 子进程)  ← 信任域不变(只读子进程)
  → 每候选 evalEvidence + Code Gate(baseline 同源, epochSameOf 校验)
  → 结果表: [candidateId, decision, gain/effGain, rubricScore, steps, costUsd]
  → 选择: 取唯一 ACCEPTED;多个 ACCEPTED → 最高 gain(+效率增益);全拒绝 → exit 1 如实报告
  → --approve → promote(用户拍板, UCB 只做候选排序建议, 不替代人审)
```

## 3. 关键决策

1. **UCB 调度器在 CLI 的落地形态**:R3 的 `shouldExpand` 纯函数先落地并单测;但完整「多轮 expand-vs-evaluate 循环」在 CLI 单轮模型下退化为:首轮 expand n 个候选 → 全部 evaluate → 选择。α 阈值用于:评测预算不足时(n 候选并行会超预算)决定是否收缩 evaluate 轮次。设计上 UCB 层与 CLI 解耦(纯函数 + 结果表),后续若做多轮(UCB 在跨轮候选中选择继续评测谁)可直接复用。

2. **同一 run 多候选 vs 多 run**:同一 evolution run 内多个 candidate(controller.createCandidate 已支持 run.candidates[] 数组,P2 起每候选存 {candidateId, hypothesis, contentHash})。promote 仍按 logicalId 单指针;多 ACCEPTED 时只 promote 选中的,其余留在 run 历史(不碰 current)。

3. **并行评测的资源上限**:子进程并行数 ≤ min(n, 2)——clipa 本地服务单模型,并行 2 已足够;串行兜底(超时保护已由 runner timeoutMs 承担)。Promise.allSettled 收结果,单候选评测失败不影响其他候选。

4. **budget 记账**:每候选 seal 后 attempt 记账(costUsd 从 run.json 读,无则记 0);spend 前查 canAfford,任一候选评测前超预算 → 该候选标注 budget-blocked,跳过评测。

5. **诚实原则**:并行评测失败/超时/无证据的候选如实标注(同 P0 单候选原则),不因「需要至少一个 ACCEPTED」而伪造分数。

## 4. 文件清单
- `packages/evolution-controller/lib/ucb.js`(新,纯函数,头注 absorbed-from: timwhitez/dsh-self-evolving specs/03 §UCB-Air)
- `packages/evolution-controller/lib/proposer.js`(增 proposeMultiple,复用 propose 内部逻辑)
- `packages/evolution-controller/bin/dsh-evolve.js`(--candidates 模式分支)
- `packages/evolution-controller/test/ucb.test.js` + `test/proposer-multi.test.js`(新)
- dsh-evolve.js 单候选路径回归不破坏

## 5. 风险
- clipa 并行请求限流 → 并行 2 + allSettled + 失败如实标注。
- 多候选内容 hash 去重依赖 normalizeText(已修 YAML 注释误删),proposeMultiple 校验沿用。
- CLI 复杂度上升 → 保持单候选路径为默认(--candidates 缺省 1),多候选为显式 opt-in。
