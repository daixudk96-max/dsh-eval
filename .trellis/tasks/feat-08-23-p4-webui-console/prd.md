# P4: Web UI 进化控制台(基于已有 GUI 改)

## 背景

差距清单第 23 项。用户 2026-08-23 定调: 「WebUI 如果已经人已经有了, 我们就在这的基础上改为」——不重写, 先调研生态已有 Web GUI, 选基底改造。
之前阶段: 面板调研确认 conversation.view slot 是最佳注册点(order:20 标签环); 原型 docs/evolution-console-prototype.html v2 已模拟(六列看板 + 审计时间线 + 当前版本条)。

## 范围

### In Scope
- P4-0: 克隆 dsh-web-ui(★5.4k)调研: slot 注册方式、数据通道(webServer+SSE)、多列看板实现; 对比 dsh-evolve-modes(已克隆, React slots + storage domain); 产出基底选择结论。
- P4-1: 选定基底的改造: 进化控制台页面(当前版本条: revision/digest/gateRunId/approvalId; 六列看板 SEALED/EVALUATING/ACCEPTED/PROMOTED/REJECTED/INCONCLUSIVE; 审计时间线)。
- P4-2: 数据通道: 宿主侧 webServer 暴露 GET /eval/state、POST /eval/action、GET /eval/events(SSE); 或复用选定基底的数据模式。
- P4-3: 只读优先: 第一版只展示 + 回滚/查看详情等只读动作; promote 等写动作仍走 CLI/审批(不在 UI 直接执行, 除非用户要求)。

### Out of Scope
- 在 UI 内直接执行 promote(写动作保持审批语义)
- 移动端适配、主题定制

## 验收标准

- [ ] AC1: 基底选择结论文档(两个候选的 slot/数据通道/改造量对比, 明确选谁)。
- [ ] AC2: 控制台页面在 DSH GUI 会话视图中注册(conversation.view 标签)并可打开。
- [ ] AC3: 页面展示真实 registry 数据(current 版本条含 gateRunId/approvalId; 历史链)。
- [ ] AC4: 审计时间线来自真实 ledger。
- [ ] AC5: 回滚按钮触发真实 registry.rollback(带确认)或只读演示(记录)。

## 约束与风险

- 用户此前「Webui, 放下吧」是当时语境; 本次以「基于已有改」为原则, 不重写。
- 若 dsh-web-ui 不可用(依赖/许可证/架构), 如实记录并回退到 dsh-evolve-modes 或原型。
- Cordis 插件形态: src/index.ts(Host)+ src/client/index.tsx(Client)+ cordis.patch.yml; React 18; 需 DSH GUI 版本兼容确认。

## 相关代码/文档

- docs/evolution-console-prototype.html(v2 原型)
- research/feature-union-gap.md 第 23 项
- research/dsh-evolve-modes/(已克隆, React slots)
- dsh-web-ui(待克隆, ★5.4k, DSH Web GUI 全家桶)
