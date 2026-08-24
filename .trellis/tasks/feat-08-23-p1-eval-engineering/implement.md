# Feature Implement Plan

## 有序步骤

1. P1-1: benchmark.ts weight + metrics 加权聚合 + 单测。
2. P1-2: runner.ts replay.dir 记录 + 重跑路径(确认 dsh-llm-replay 可用性, 记录结论)。
3. P1-3: import.ts codex|claude-code 分支 + 样例验证。
4. P1-4: dsh-evolve status 子命令(registry 指针/历史/漂移)+ 真实验证。
5. P1-5: benchmark.ts lifecycle + caseMeta + 迁移校验 + 单测。
6. P1-6: caseCheckProblems 机械校验(parse 早失败)+ 单测。
7. P1-7: evolution-controller lib/feedback.js + 单测。
8. 全量回归全绿。
9. evolution-plan.md 勾选 P1 + git 提交 + archive + journal。

## 验证

- node packages/evolution-controller/test/<file>.test.js(单进程)
- node packages/dsh-eval/scripts/prepare-sdk.mjs --dsh E:\github\dsh(mirror)
- dsh --profile eval run/import/status 真实运行验证

## Review / 验证门

- [ ] 已按项目质量门验证（`trellis-check`），证据记录在本文件与 review.md。
- [ ] 若仅文档改动：注明无需运行验证。

## 回滚点

- weight/lifecycle/replay 字段全可选, 老 benchmark 不受影响。
- status 为新子命令, 不影响既有流程。
