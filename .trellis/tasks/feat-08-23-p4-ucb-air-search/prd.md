# P4: UCB-Air 多候选搜索调度(后备)

## 背景

差距清单第 24 项。用户 2026-08-23 问「UCB-Air 这个是啥呀」后确认要做, 排最后。
UCB-Air = expand(生成新候选)vs evaluate(继续评测已有候选)的多臂老虎机调度: 每动作分数 = 平均收益 + 探索项 √(2 ln N/n); 调度阈值 (N+P_eval)^α ≥ T(α=0.6) 决定扩还是测。当前单轮驱动架构用不上, 仅在未来做「多候选并行 + 自动连续进化」时引入。

## 范围

### In Scope
- P4-1: 前置条件确认(多候选并行 + 自动连续进化场景出现)后才开工; 否则保持后备。
- P4-2: lib/search-scheduler.js(新): UCB 分数计算 + expand-vs-evaluate 决策(吸收 dsh-self-evolving specs/03 搜索算法, 仅 UCB-Air 一项)。
- P4-3: 与 BudgetLedger 联动(评测预算分配)。

### Out of Scope
- clade Thompson sampling(放弃: 需要大规模并行作业场)
- wave-synchronous scheduler(放弃: 冻结快照+固定 RNG 流, 与单轮驱动不符)

## 验收标准

- [ ] AC1: UCB 分数计算单测(利用/探索权衡, 参数 α 可配)。
- [ ] AC2: 调度决策单测(预算约束下扩/测选择)。
- [ ] AC3: 与 BudgetLedger 联动单测(评测花费计入预算)。
- [ ] AC4: 真实多候选场景演示(或记录「前置条件未满足, 保持后备」结论)。

## 约束与风险

- 前置条件(多候选并行)不满足则不开工——本任务可能长期处于 planning。
- 只吸收 UCB-Air, 不引入 self-evolving 的 Linux 绑定组件。

## 相关代码/文档

- research/feature-union-gap.md 第 24 项
- research/dsh-self-evolving/specs/03-evolution-algorithm.md(search 算法)
- packages/evolution-controller/lib/budget.js(联动)
