# Feature Implement Plan

## 有序步骤

1. 前置条件确认(多候选并行场景出现; 否则停在 planning, 不实施)。
2. P4-2: lib/search-scheduler.js(ucbScore/decideAction)+ 头注 absorbed-from dsh-self-evolving specs/03。
3. P4-3: budget.js BUCKETS 增 'search' + 联动。
4. 单测(AC1/2/3)。
5. 真实多候选演示(AC4, 条件满足时)。
6. evolution-plan.md 勾选 P4 + git 提交 + archive + journal。

## 验证

- node packages/evolution-controller/test/search-scheduler.test.js(单进程)
- 全量回归

## Review / 验证门

- [ ] 已按项目质量门验证（`trellis-check`），证据记录在本文件与 review.md。
- [ ] 若仅文档改动：注明无需运行验证。

## 回滚点

- 纯新增模块, 与既有 API 正交; 不引入即无风险。
