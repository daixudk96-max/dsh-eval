# M3 evolution-controller —— 实施计划

## 实施顺序

1. 状态机（纯函数，无 IO）：迁移表 + 非法迁移拒绝。
2. Gate 规则集（ruleSet v1）+ 四态判定（构造数据单测驱动）。
3. 审计 ledger（append-only）。
4. Promote 事务接线（调 preset-registry CAS + approvalId 绑定 + 前置校验）。
5. canary 接口（benchmark 子集）+ blind holdout 预留位。
6. 事件接线：`approval/asked → decided` → promote。

## 验证命令

- 单测：`pnpm vitest run <包>/test/evolution-controller`（状态机 / Gate 四态 / 审计）。
- 集成：构造 baseline/candidate 伪 run → 走通 `gate → promote`；CAS 冲突场景验证失败路径。
- 冒烟：`dsh --profile web --dump-config | grep -iE 'evolution|gate'`

## 检查点 / 回滚点

- 检查点 1：状态机 + Gate 四态单测全绿（无 IO 依赖，先行）。
- 检查点 2：promote 事务集成（依赖 M2 完成）。
- 回滚点：controller 无状态（决策全在 ledger），任何错误决策只写审计、不自动改 current；可整体回退 Package。

## AC→验证映射（对应 prd.md）

- 状态机全路径 → 迁移表单测
- Gate 四态 → 伪 run 单测（PASS/FAIL/INCONCLUSIVE/INVALID 各构造）
- INCONCLUSIVE 不 promote → 单测 + 集成
- 前置校验一致才放行 → 集成测试（digest/epoch/approvalId 各错一项）
- 审计 append → ledger 单测
- evolver 无 current 写权 → Host capability 集成测试（M4 一并验证）
