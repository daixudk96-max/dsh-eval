# Feature Design Review

status: passed   # missing | passed | blocking

## 审查范围

- prd.md / design.md / implement.md 三件套(逐条核对)
- 相关实现:packages/dsh-eval-console/src/{audit.ts, host-service.ts, host-routes.ts, domain/adapter.ts, domain/timeline.ts, domain/protocol.ts, client/EvalConsoleView.tsx, client/VersionSelect.tsx, client/host-api.ts}
- 真实数据:`C:\Users\daixu\.dsh\evolution-audit\ledger.jsonl`(154 行,事件分布 created 37 / candidate-created 34 / sealed 32 / gate 31 / promoted 7 / budget 5 / promote-near-duplicate 4 / proposal-rejected 3 / switch-to-revision 1;仅 1 条带 logicalId)
- DSH 契约:`E:\github\dsh\packages\client\ui-conversation\src\client\contract\slots.ts`(ConvViewProps / conversation.view)

## 发现

| 级别 | 问题 | 建议 |
|------|------|------|
| info | 核心动机成立:当前 `adapter.ts:82-143 buildRevisionFacts` / `buildRows:163-210` / `timeline.ts:85-92 timelineEvents` 消费传入的整份 audit;`host-service.ts:158-188 snapshot()` 直接 `audit: auditAll`。真实 ledger 仅 1/154 条带 `logicalId`(switch-to-revision),其余只带 runId 或 revisionId。只改 client 传 `state(preset)` 会让 audit-only candidates 与 timeline 混入其他 preset。**Host 侧作用域化必要**。 | 按 design §审计作用域化实现 scopeAuditEntries。 |
| info | `scopeAuditEntries` 两遍规则正确:第一遍显式 logicalId 或 `revisionId/targetRevisionId` 前缀匹配并记录 runId;第二遍按归属 runId 保留全部事件。真实数据上 sealed(revisionId+runId) 桥接 runId → gate/created/candidate-created/promoted;promoted 无 runId 也由 revisionId 前缀直接命中。 | 归属规则无需修改;测试 fixture 覆盖 runId 桥与 targetRevisionId 前缀。 |
| info | 未发现问题。revision = `auditAll.length` 保持全局计数正确 —— SSE 帧是全局 delta,scoped 计数会漂移导致 client `revisionRef` skip 误跳。`host-service.ts:185 this.revision` 须同步改。`digestForRevision` 保持全量。 | 实现时 `this.revision = auditAll.length`;pollOnce/digestForRevision 保持全量。 |
| info | `conversation.view` PropsRuntime **确实提供 sessionId**(slots.ts:447),EvalConsoleView 可直接解构,状态机五态(loading/no-preset/no-chain/ready/error)设计正确;cordis/standard 归 no-chain 而非 no-preset(design §状态机「纠正」正确)。 | 按 design 实现。 |
| info | 动作语义接线正确:detail(只读)/ switch-revision(指针不动)/ rollback(canRollback 门禁 + confirm 短语)/ promote 无 UI 路径(parseActionEnvelope 枚举拒绝)。 | 无需改动。 |
| warn | **role 归属理论边界**:一个 run 从未 sealed(proposal-rejected 即弃),其 created/proposal-rejected 事件无 logicalId 且无 runId 桥 → 归属不到任何 preset → 被排除。design §约束与风险已记录(宁可少展示不串链)。 | 认可;保持默认排除,不做数据迁移。 |
| warn | **useSessionPreset 抽取语义**:VersionSelect.tsx:78-92 catch → null(未读会话/无 sessionPersistence 也归 null)。共享 hook 须保持同一语义,否则 VersionSelect 与 EvalConsoleView 行为漂移;无 sessionPersistence 的 Host 所有会话都显示 no-preset(已有行为,非本轮回归)。 | 抽取时逐字保持 catch→null;hook 传 transport 参数以复用实例。 |
| warn | **SSE scope 判断**:`eventPayload.logicalId` 字段可能来自当前 session preset,client 若用它做 scope 判断会漂移。设计「SSE 帧全局 delta;client 以当前 scope logical 重拉」正确。 | client 用自己的 preset 做 scope,不信任 eventPayload.logicalId 字段。 |
| warn | **scopeAuditEntries 须保序**:第二遍保留顺序与原 ledger 一致(不排序),保证 timeline 的 `evt-<index>` id 与 buildRevisionFacts 稳定。 | 实现时勿 sort;测试断言顺序稳定。 |
| info | 已核实:`host-routes.ts:81-105` baseLogicalId 归一化已实现;`EvalDetail.tsx:157-166` canRollback 门禁已实现;`protocol.ts` parseActionEnvelope 已枚举三 kind。 | 无新增协议,wire 形状零变更。 |

## 结论

- [x] 通过,可进入实现
- [ ] 阻塞,需改 design

## 实现注意事项(已并入上述 findings)

1. `host-service.ts:158-188`:auditAll → scopedAudit → buildSnapshot({revision: auditAll.length, audit: scopedAudit});`this.revision = auditAll.length`;pollOnce/digestForRevision 保持全量。
2. scopeAuditEntries 第二遍保持原顺序(不排序)。
3. useSessionPreset:失败 → null;传 transport 实例。
4. client 的 SSE 重拉用自己持有的 preset,不信任 eventPayload.logicalId。
5. 测试 fixture 覆盖 rollback-applied 的 `targetRevisionId` 前缀归属。
6. 现有 service.test.js / adapter.test.js 若有 timeline/audit-only 行数断言,fixture 只应含一个 logical;否则改用作用域化后的 audit。
7. 文档机械修正(本轮已改):prd.md `Audittry`→`AuditEntry`;prd/design/implement 三处「8 代」→「当前完整链」。
