# Feature Implement Plan

## 有序步骤

1. P3-1: lib/skill-extract.js(extractor+generator 吸收)+ 单测 + 真实 session 提炼演示。
2. P3-2: registry 内容对象扩展(entries 按 kind 版本化)+ 单测。
3. P3-3: lib/skill-lifecycle.js(active→stale→archived + restore)+ 单测。
4. P3-4: 热挂载验证(隔离 DSH_HOME, 可行则集成, 否则记录结论)。
5. P3-5: lib/memory.js(MEMORY.md/USER.md 预算+dedup)+ 单测。
6. P3-6: ranked injection 注入形态 + 单测。
7. 全量回归全绿。
8. evolution-plan.md 勾选 P3 + git 分批提交 + archive + journal。

## 验证

- node packages/evolution-controller/test/<file>.test.js(单进程)
- node packages/dsh-eval/scripts/prepare-sdk.mjs --dsh E:\github\dsh(mirror, 若涉 dsh-eval)
- 真实 session 提炼 + 热挂载隔离验证

## Review / 验证门

- [ ] 已按项目质量门验证（`trellis-check`），证据记录在本文件与 review.md。
- [ ] 若仅文档改动：注明无需运行验证。

## 回滚点

- 全部新模块, 不触碰既有 API 语义(registry 增量向后兼容)。
- 热挂载不做则无运行时风险。
