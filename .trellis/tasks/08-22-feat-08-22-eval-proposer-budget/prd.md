# 进化侧工程化（proposer + budget ledger + 近重复检测）

## Goal

把 evolution-controller 进化侧补上三个缺口(照 dsh-self-evolving 的 proposer 协议 / budget ledger,
与 dsh-continual-evolve 的 promotion 近重复检测落地到 CJS 同语言层):
候选不再凭空生成——必须绑定失败证据与可证伪假设;预算有账本不靠自报;promote 前拒绝近重复。

## Requirements

1. **R1 候选质量门槛(proposal check)**: createCandidate 的 mutations 必须过确定性代码判定:
   - 拒绝 no-change(内容与 sourceRevision 完全一致)、test-only、comment-only 候选;
   - 候选必须携带 `hypothesis`(可证伪机制断言)与 `evidence`(引用 triggerEvaluationRunId 的失败簇),
     缺失即拒绝;
   - 同一 run 内最多 W_p=3 个不同主 hypothesis, 语义 diff 相同(归一化后内容一致)去重。
2. **R2 budget ledger**: 新 budget ledger(append-only JSONL, 独立于 registry ledger),
   分桶 proposal / attempt / failed; 成本由外部注入, 不信候选自报; 超预算的 newRun 被拒。
3. **R3 promote 近重复检测**: promote 前比对目标 revision 与历史(含 current)的
   normalized 内容 hash, 近重复即拒绝(默认开启, 可 gateOverrides 关闭)。
4. **R4 真实闭环**: 用现有 evaluate preset 做一轮带 proposer 约束的真实进化
   (无 approvalId 被拒 → 带 approvalId promote), 近重复候选被拒演示。

## Constraints

- 同语言(CJS 零依赖)直接改 evolution-controller/preset-registry; 新文件头部加
  `# absorbed-from` 追溯(dsh-self-evolving specs/03 §9 proposer 协议 + budget ledger;
  dsh-continual-evolve src/promotion.ts 近重复)。
- 信任域分离不变: 评测只读、进化只写; gate 仍是代码判定。
- 真实验证为准; 不伪造证据。

## Acceptance Criteria

- [ ] **AC1**: proposal-check 拒绝 no-change / test-only / comment-only / 缺 hypothesis / 缺 evidence
- [ ] **AC2**: 单 run 最多 3 个不同 hypothesis; 语义相同去重
- [ ] **AC3**: budget ledger 分桶记录; 超预算 newProposal 被拒
- [ ] **AC4**: promote 近重复被拒(默认), 可显式关闭
- [ ] **AC5**: 真实进化一轮: 有证据的候选通过并 promote, 近重复候选被拒

## Notes

- 复杂任务: 补 design.md + implement.md 后 start。
