# Feature Design

status: draft   # draft | approved
execution_lane: standard   # quick | standard

## 目标与非目标

- 目标: 基于生态已有 Web GUI 改造出进化控制台, 不重写。
- 非目标: UI 内直接 promote; 移动端; 主题定制。

## 方案

### 边界

- P4-0: 调研(克隆 dsh-web-ui, 读 slot 注册 + webServer 通道 + 看板实现)。
- P4-1/2: 新包 packages/dsh-eval-console(Cordis 插件: Host src/index.ts + Client src/client/index.tsx + cordis.patch.yml)。
- P4-3: 数据通道 webServer: GET /eval/state、POST /eval/action、GET /eval/events(SSE)。

### 数据流

```text
Client conversation.view 标签(order:20) → fetch GET /eval/state → 当前版本条+六列看板渲染
→ POST /eval/action {action: rollback|detail, ...} → Host 调 registry/controller(只读动作)
→ GET /eval/events SSE → ledger 增量 → 审计时间线实时更新
```

### 契约变更

- 新 Cordis 插件包(packages/dsh-eval-console), 宿主侧 require preset-registry/evolution-controller。
- 注册 conversation.view slot(id: evolution, order: 20)。

### 取舍

- 第一版只读动作(展示/回滚/详情); promote 写动作保持 CLI 审批语义。
- 数据通道选 webServer(富结构化数据, 同 dsh-web-ui 模式)vs sessionProjections(只读投影): 按基底结论定, 默认 webServer。
- 若 dsh-web-ui 的看板组件可直接复用(许可证允许), 优先复用而非自绘。

## 风险与回滚

- dsh-web-ui 依赖/许可证/架构不可用 → 回退 dsh-evolve-modes 或原型(记录结论)。
- DSH GUI 版本兼容: 需确认当前 GUI 版本支持 conversation.view 标签注册。
- 插件卸载即净(ctx.effect 生命周期)。

## 验证计划

- 基底选择结论文档(AC1)。
- 插件注册后 GUI 打开验证(AC2/3/4)。
- 只读动作真实执行验证(AC5)。

## 人审检查点

- [ ] 设计已获用户确认（status=approved）后再进入实现
