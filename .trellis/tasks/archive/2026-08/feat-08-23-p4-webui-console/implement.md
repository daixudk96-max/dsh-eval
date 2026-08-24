# Feature Implement Plan

## 有序步骤

1. P4-0: 克隆 dsh-web-ui + 调研(slot 注册/webServer 通道/看板实现) + 对比 dsh-evolve-modes → 基底结论文档。
2. P4-1: packages/dsh-eval-console 骨架(src/index.ts Host + src/client/index.tsx Client + cordis.patch.yml + tsdown 构建)。
3. P4-2: Host webServer 三端点(/eval/state /eval/action /eval/events SSE)。
4. P4-3: Client conversation.view 注册(order:20) + 看板渲染(当前版本条/六列/审计时间线)。
5. 真实 registry 数据接入验证(GUI 打开, 展示 evaluate 6 代历史)。
6. 只读动作验证(回滚带确认)。
7. evolution-plan.md 勾选 P4 + git 提交 + archive + journal。

## 验证

- GUI 打开验证(DSH GUI http://127.0.0.1:3080, 新会话选择视图标签)。
- curl GET /eval/state 与 SSE 验证。
- 全量回归: 既有 node:test + vitest 不受影响(新包独立)。

## Review / 验证门

- [ ] 已按项目质量门验证（`trellis-check`），证据记录在本文件与 review.md。
- [ ] 若仅文档改动：注明无需运行验证。

## 回滚点

- 新包独立, 卸载插件即恢复(不影响既有功能)。
- 若基底不可用, 停在调研文档阶段。
