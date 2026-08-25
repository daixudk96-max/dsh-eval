# Feature Design

status: draft   # draft | approved
execution_lane: standard   # quick | standard

## 目标与非目标

- 目标: 未来多候选场景的搜索调度模块; 当前保持后备。
- 非目标: clade Thompson / wave scheduler(Linux 绑定与作业场依赖)。

## 方案

### 边界

- P4-2: evolution-controller/lib/search-scheduler.js(新, 纯函数)。
- P4-3: evolution-controller/lib/budget.js 联动(spend 记入 search 桶)。

### 数据流

```text
多候选池(每个: 候选 hash, 已评测次数 n, 平均收益 S)
→ 每轮决策: 对每个候选 UCB = S/n + √(2 ln N / n)
→ (N+P_eval)^α ≥ T ? expand(生成新候选) : evaluate(评测 UCB 最高候选)
→ 评测结果回写 → 预算扣减(budget.spend)
```

### 契约变更

- search-scheduler: ucbScore(n, N, S, alpha?) / decideAction(pool, budget, alpha=0.6)。
- budget.js: BUCKETS 增 'search'(可选)。

### 取舍

- 纯函数实现, 与 controller 解耦; 单测驱动。
- α/T 参数可配, 默认沿用 self-evolving(α=0.6)。
- 不引入任何 Linux 绑定依赖。

## 风险与回滚

- 前置条件不满足 → 任务保持 planning, 不产生代码。
- 若未来引入, 与现有 proposal-check/预算/门禁正交。

## 验证计划

- 单测: UCB 分数、决策、预算联动。
- 真实多候选演示(条件满足时)。

## 人审检查点

- [ ] 设计已获用户确认（status=approved）后再进入实现
