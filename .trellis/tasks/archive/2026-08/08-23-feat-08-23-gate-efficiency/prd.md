# gate 效率维度: 同质量+步骤减少算提升

## Goal

用户定调: 「我实现同一个目标, 效率提升肯定算提升」。
给 Code Gate 增加效率维度: 候选与 baseline 质量相同(无回归)但步骤显著更少 → 效率增益计入判定,
  PASS 不再要求 overall 增益。

## Requirements

1. **R1 gate.js 效率判定**: `evaluateGate` 接受 `candidate.steps` / `baseline.steps`(可选):
   - 两者都提供时计算 `efficiencyGain = 1 - candidate.steps / baseline.steps`
     (候选更少 → 正; 更多 → 负);
   - 效率回归(候选更慢)→ FAIL(`efficiency regression`);
   - 质量无增益但效率增益 ≥ minEffect → PASS(决策含 efficiency 证据);
   - 无 steps 输入时行为完全不变(向后兼容)。
2. **R2 质量回归仍优先**: correctness/safety/verification 回归 FAIL 的优先级
   高于效率通过(质量下降不能用效率掩盖)。
3. **R3 finish 脚本**: evolution-p2.mjs finish 从 run.json metrics 映射 steps 进 baseline/candidate。
4. **R4 真实闭环重跑**: 小样本 baseline(63 步)/ candidate(37 步) →
   效率增益 0.413 ≥ minEffect 0.05 → PASS → 用户提供 approvalId 后 promote。
5. **R5 测试**: gate 三态(效率提升 PASS / 无提升 INCONCLUSIVE / 更慢 FAIL)+ 回归优先。

## Acceptance Criteria

- [x] **AC1**: gate 单测: 同质量+效率提升 → PASS; 同质量+无效率差 → INCONCLUSIVE; 候选更慢 → FAIL
- [x] **AC2**: 质量回归 + 效率提升并存 → FAIL(质量优先)
- [x] **AC3**: 无 steps 输入 → 行为与旧版一致(回归测试全绿)
- [x] **AC4**: finish 真实闭环: PASS + approvalId → promote(指针更新到候选 revision)
- [x] **AC5**: current 指针 = evaluate-ab63a9b7, 指针带 gateRunId(evr-mt4lwb75-w2td4x) + approvalId(user-approved-efficiency-2026-08-23)

## Notes

- 轻量任务 PRD-only; 依赖 P2 已归档代码与 research/evolution-p2.mjs。
- 诚实原则: 效率证据来自真实 run.json metrics(steps), 不伪造。
