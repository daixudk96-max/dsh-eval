# P3 治理: 审查脱敏 + 进化命令面 — Implement

## P3-1 redact.js(新增)
- [ ] 建 packages/evolution-controller/lib/redact.js: redactSecrets/redactCredentials/redactPaths/redactSessionIds/redactReviewText
- [ ] 头部注释 `# absorbed-from: lmzhen/dsh-evolution/packages/evolution-review/src/redact.ts (TS→CJS rewrite)`

## P3-2 controller.js 集成
- [ ] constructor 增可选 `redactValues: string[]`
- [ ] createCandidate: evidence/hypothesis 审计与存储前 redactReviewText

## P3-3 测试
- [ ] test/redact.test.js(形状/路径/session/已知值/组合)
- [ ] test/controller-redact.test.js(审计不残留原串)
- [ ] 全量 node:test 回归

## P3-4 bin/dsh-evolve.js
- [ ] CLI 参数解析(--key value / --key=value)
- [ ] 闭环: current→候选→seal→评测×2→evaluate→promote/拒绝
- [ ] 产物写 --out(baseline.json/candidate.json/gate.json/result.json)
- [ ] --help 文本

## P3-5 真实验证
- [ ] 无 --approve 跑一轮 → 拒绝路径正确
- [ ] 带 --approve 跑一轮 → promote + 指针/审计/产物
- [ ] grep 审计 ledger 无凭证残留(AC2)
- [ ] 全量回归通过(AC5)

## P3-6 收尾
- [ ] evolution-plan.md §5 P3 打 ✅
- [ ] git commit 分批; task.py archive; journal
