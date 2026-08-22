# P2 验证: 缩小 sample session 重跑闭环

## Goal

上一轮 P2 闭环中, 失败簇变异候选在真实评测里超时(65 步/83 工具调用全成功但 590s > 600s 预算),
gate 诚实拒绝(回归)。本轮缩小评测样本(sample-session.jsonl.zstd 1.6MB → 小样本),
让候选在预算内完成任务, 重跑 baseline/candidate 真实评测, 重新 gate 判定:
- 若候选 PASS → 请用户批准 approvalId 后 promote(有真实证据的提升);
- 若仍 FAIL/INCONCLUSIVE → 如实记录, 不伪造。

## Requirements

1. **R1 缩小样本**: 从现有 sample-session.jsonl.zstd(1.6MB, 会话 span 16.09h)生成小样本
   (目标 <300KB), 保留代表性事件(turn/step/tool-call/tool-result/失败点), 重新 zstd 压缩。
2. **R2 双工作区更新**: evaluate-preset-p2(候选)与 evaluate-preset-p2-baseline(current)都换小样本,
   prompt 引用新文件名; 评测预算维持 600s。
3. **R3 真实重跑**: baseline 与 candidate 各跑一轮(clipa / deepseek-v4-flash)。
4. **R4 gate 判定 + 决策**: 按真实 run.json 数据走 evolution-p2.mjs finish;
   PASS 且用户提供 approvalId → promote; 否则拒绝并记录原因。

## Constraints

- 诚实原则: 不伪造评测分数; 超时/失败如实记录。
- 评测对象不变: 候选 = 带 Failure-clusters 指令的 evaluate preset(sealed evaluate-5dab277e 内容),
  baseline = current evaluate-8b9b3f03。
- 复用 P2 脚本 research/evolution-p2.mjs(prepare/finish)与 wrapper/check 机制。

## Acceptance Criteria

- [ ] **AC1**: 小样本生成(解压→截取→重压), 文件落盘可被 import 正常解析
- [ ] **AC2**: baseline 真实评测 taskSuccess 1.0(小样本预算内完成)
- [ ] **AC3**: candidate 真实评测在 600s 内完成(不再超时)
- [ ] **AC4**: finish 走完整闭环: gate 判定 + (PASS→用户批准 promote / FAIL→拒绝记录)
- [ ] **AC5**: 结果(含 run.json 证据)汇报用户

## Notes

- 轻量任务, 单轮验证; 依赖 P2 已归档的代码与脚本。
