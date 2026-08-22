
## 2026-08-23 · gate 效率维度(同质量+步骤减少算提升)
- 用户定调: 「我实现同一个目标, 效率提升肯定算提升」→ 给 Code Gate 增加效率维度。
- 改动(a97f088):
  - packages/evolution-controller/lib/gate.js: efficiencyGain = 1 - candidate.steps/baseline.steps(两者正数时); 更慢→FAIL(效率回归); 同质量+efficiencyGain>=minEffect→PASS; 无 steps 输入行为不变。
  - 顺带修复 packages/evolution-controller/lib/proposal-check.js normalizeText: 原把 '## ' markdown 标题当注释删除, 导致三代 previous 内容哈希完全相同(f038a29f…), near-dup 检测失效; 改为只删 YAML 注释 /^#(?:\s|$)/。
  - test/gate-efficiency.test.js 8 用例; evolution-p2.mjs finish 映射 run.json aggregate.steps + --approve <id> 真实 promote。
- 真实闭环(第 6 轮): baseline 63 步 vs candidate 37 步, 均 taskSuccess 1.0 → gate PASS(efficiency gain 0.413 >= 0.05)→ 用户批准 → promote evaluate-ab63a9b7(gateRunId evr-mt4lwb75-w2td4x, approvalId user-approved-efficiency-2026-08-23)→ 导出 eval/presets/evaluate-evolved/。
- 历史链 5 代: ab63a9b7(效率) → 8b9b3f03(缩进修复) → ab811c74(标题去重) → c60321bb(compare+闭环) → dab4f200(初始)。
- 全量回归 8 个测试文件通过; near-dup/budget 演示正常。
