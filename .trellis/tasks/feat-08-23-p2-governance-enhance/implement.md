# Feature Implement Plan

## 有序步骤

1. P2-1: registry.js rollbackContent + evolution-controller/lib/rollback.js(逆编辑)+ 单测。
2. P2-2: 冲突检测(diff current↔target 交集)→ 单测。
3. P2-3: evolution-controller/lib/threat.js + createCandidate 挂载 + 单测 + 真实 block 演示。
4. P2-4: dsh-evolve failures 子命令 + 真实 run.json 验证。
5. P2-5: compare --delta decisionReport + 验证。
6. 全量回归全绿。
7. evolution-plan.md 勾选 P2 + git 提交 + archive + journal。

## 验证

- node packages/evolution-controller/test/<file>.test.js(单进程)
- node packages/dsh-eval/scripts/prepare-sdk.mjs --dsh E:\github\dsh(mirror)
- 真实 registry 逆编辑回滚演练

## Review / 验证门

- [ ] 已按项目质量门验证（`trellis-check`），证据记录在本文件与 review.md。
- [ ] 若仅文档改动：注明无需运行验证。

## 回滚点

- rollbackContent 为新增 API, 不影响既有 rollback(指针级)。
- threat 扫描默认 true 可关; 误报只 block 不删数据。
