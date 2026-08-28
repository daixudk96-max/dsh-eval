# Feature PRD

## 背景

dsh-eval-console 的「进化」conversation.view 标签(已装在 web profile)当前**固定展示 `evaluate` 链**:`EvalConsoleView.tsx` 的 `useEvalState(transport)` 调用 `transport.state()` 无 `logical` 参数,Host 端落到配置的默认 `logicalId='evaluate'`。这意味着:

- 任何会话打开「进化」标签都看到 evaluate 的完整链历史,与该会话实际使用的 preset 无关;
- system-evolver / system-evaluator / deep-mindmap 等其它已安装并已进化的 preset 在控制台里看不到自己的链;
- 会话无 preset 时仍展示 evaluate 链,误导用户以为「当前 presets 的版本」。

会话头部版本下拉(VersionSelect)已经先行绑定会话 preset(经 `/eval/session-preset?sessionId=<id>` 解析 + `/eval/state?logical=<presetId>` 查链,无链时不渲染),但「进化」标签仍是全局固定链——两者行为不一致。

用户批准的方向:进化标签改为**默认绑定当前会话 preset**;无 preset 或无链时显示**明确空状态**(而非整块消失或展示别人的链);有链时仅展示该 preset;严格区分三个版本级动作(查看内容 / 同步为新会话可选版本 / 回滚 current 指针);promote 仍不可从 Web UI 触发;跨 preset 全局管理另案。

**关键审查发现(必须纳入范围)**:只改 Client `state(preset)` 传参不够。`adapter.ts` 的 `buildRows(history, audit, ...)`(`adapter.ts:163-210`)与 `timelineEvents(audit)`(`timeline.ts:85-90`)消费**全量 evolution-audit 记录**;真实 ledger 中绝大多数旧事件**没有 `logicalId`**(见下)。因此 Host 必须先把审计记录按 logical preset 作用域化,否则 scoped 快照会把其他 preset 的 audit-only candidates 与时间线事件混进来。

## 范围

### In Scope
- **Host 审计作用域化(新增,核心)**:
  - 新增纯函数 `scopeAuditEntries(audit: AuditEntry[], logicalId: string): AuditEntry[]`(可置于 `audit.ts` 或 adapter helper):
    1. 显式 `entry.logicalId === logicalId` 的事件 → 保留;
    2. `revisionId` / `targetRevisionId` 以 `${logicalId}-` 前缀开头的事件 → 记录其 `runId` 归属;
    3. 保留上述归属 runId 的**全部事件**(created / candidate-created / gate / promoted / budget 等),使旧事件通过 runId 关联回该 preset;
    4. 其余事件 → 排除(无法归属的事件默认不展示)。
  - `EvalConsoleHostService.snapshot(logicalId?)`:`readAuditEntries` 读全量 `auditAll`;`revision` 与内部计数器**仍用 `auditAll.length`**(兼容全局 SSE revision 语义);传给 `buildSnapshot` 的 `audit` 用 `scopedAudit = scopeAuditEntries(auditAll, logicalId)`;`timeline` 随之只含该 preset。
- EvalConsoleView 改为 scoped:解析当前会话 preset → 以 `{logical: preset}` 拉取快照 → 仅渲染该 preset 的链(当前版本条 / 六列卡 / 时间线 / 详情 modal)。
- 新增 client 侧 `useSessionPreset` helper(从 VersionSelect 的解析逻辑抽取复用),EvalConsoleView 与 VersionSelect 共用。
- scoped 状态机:`loading`(解析 preset 中)→ `no-preset`(会话元数据确实无 agentPreset)→ `no-chain`(preset 有 id 但 registry 无链)→ `ready`(有链快照)→ `error`(拉取失败,可重试)。
- 空状态 UI:no-preset / no-chain 显示明确文案(不渲染版本卡片、无回滚按钮),文案中英文 locale 键。
- 动作语义落地(现有能力,本轮接线/文案 + 验证):
  1. **查看内容** — 详情 modal(detail action,只读);
  2. **同步为新会话可选版本** — 版本下拉 switch-revision(仅同步 agent-presets 安装目录,不移动 current,非回滚/热切换);
  3. **回滚 current 指针** — EvalDetail 回滚按钮(仅历史链 previous revision,confirm 短语门禁)。
- SSE `/eval/events` 继续订阅,revision delta 触发 scoped 快照重拉(与现有行为一致)。
- 测试:新增 scopeAuditEntries 跨 logical 单测(columns / history summaries / audit-only candidates / timeline 不串链;旧无 logicalId 事件经 runId 关联保留);新增 helper 与 scoped 状态机测试;现有全量回归;typecheck + build。

### Out of Scope
- **跨 preset 全局管理**:一个界面管理所有 registry 链(另案)。
- promote 未从 Web UI 触发(promote 永远留在 CLI `--approve` 路径)。
- 会话热切换(recompose)已有会话即时生效 — 不支持,同步版本仅影响新会话。
- wire 协议(`/eval/state` / `/eval/action` / `/eval/events` 的 JSON 形状)不变;baseLogicalId 归一化 / canRollback — 已实现,本轮不改协议。
- registry / evolution-controller 库改动。
- 新增加 sink/处理风格变化:保持现有 controller-driven Transport 模式。
- 审计数据迁移:不为旧 ledger 补写 logicalId(纯推断,不改历史)。

## 验收标准

- [ ] AC1 打开「进化」标签时,会话有预设且该预设 registry 有链 → 展示**该 preset 的链**(当前版本条 + 六列 + 时间线;时间线与 audit-only 卡片不混入其他 preset);不再固定展示 evaluate 链。
- [ ] AC2 会话 preset 为 **cordis / standard**(有 preset id 但 registry 无链)→ 标签显示 **no-chain** 空状态文案(提示该预设未纳入版本管理),无版本卡片。
- [ ] AC3 会话元数据确实无 agentPreset(no-preset)→ 标签显示 **no-preset** 空状态文案;`no-preset` 与 `no-chain` 是两种独立状态,文案不同。
- [ ] AC4 有链会话:版本下拉(header actions)显示该预设链,含当前行 ✓ + 时间戳 + 变更摘要;点击 previous 行 → switch-revision 同步,提示目标目录,current 指针不变(审计出现 switch-to-revision 记录)。
- [ ] AC5 详情 modal:任一历史链 previous 版本显示「回滚」按钮且需输入 `ROLLBACK:<revisionId>` 短语;current 行与 audit-only(REJECTED/INCONCLUSIVE/SEALED)行无回滚按钮。
- [ ] AC6 promote 不可从控制台触发:无任何 UI 路径调用 promote action(协议无 promote kind,parseActionEnvelope 拒绝非法 kind)。
- [ ] AC7 测试通过:console 全量测试(现有)+ 新增 scopeAuditEntries 跨 logical 测试 + scoped/helper 测试;typecheck 0 错误;build 成功。
- [ ] AC8 真实 GUI 验证:重启后 evaluate 会话显示 evaluate 链(当前完整链,时间线只含 evaluate 事件);cordis 会话显示 no-chain;deep-mindmap 会话显示 no-chain;无 preset 会话显示 no-preset。

## 约束与风险

- 不改 E:\github\dsh(DSH 本体);仅改 packages/dsh-eval-console。
- 诚实原则:不伪造分数;现有数据(registry/audit)只读展示,唯一写路径 = switch-revision(安装目录同步)与 rollback(current 指针,confirm 门禁)。
- **旧 ledger 推断风险**:大多数旧事件(created/candidate-created/gate/budget)没有 logicalId,仅凭 runId 关联 sealed/promoted 的 revisionId 前缀归属;若某 run 的 sealed 事件缺失(理论边界),该 run 的其余事件将无法归属而被排除。缓解:scopeAuditEntries 的归属规则文档化 + 跨 logical fixture 测试;无法归属事件默认排除(宁可少展示不串链)。
- 错误状态检测:只改 `logical` 参数但遗漏 Host scoping 是主要回归点——AC1 明确要求「audit-only 卡片与时间线不串链」并在实现步骤强制先做 scopeAuditEntries。
- `conversation.view` PropsRuntime **已核实**提供 sessionId(`ConvViewProps = PropsRuntime<'conversation.view'>`,slots.ts:447,注释明确 session-scope view 提供 sessionId/useSessions),无需实施时再核实。
- Host 改动需要重启 GUI 生效;client bundle 只需刷新(web profile node_modules 是 symlink 指向源目录)。
- 版本目录 id 归一化已实现(`evaluate-0c3922a0` → `evaluate`),scoped 查询无需新协议。

## 相关代码/文档

- `packages/dsh-eval-console/src/audit.ts`(新增 scopeAuditEntries 的候选位置;现有 readAuditEntries/appendAuditLine)
- `packages/dsh-eval-console/src/domain/adapter.ts`(buildRows 163-210 / buildSnapshot 消费 audit;RevisionFacts/AuditEntry 类型)
- `packages/dsh-eval-console/src/domain/timeline.ts`(timelineEvents 85-90 消费 audit)
- `packages/dsh-eval-console/src/host-service.ts`(snapshot 158-188:auditAll → scopedAudit → buildSnapshot;revision 保持 auditAll.length)
- `packages/dsh-eval-console/src/client/EvalConsoleView.tsx`(本轮主改点:useEvalState 无 logical)
- `packages/dsh-eval-console/src/client/VersionSelect.tsx`(复用参考:sessionPreset 解析 + state(preset) + SSE)
- `packages/dsh-eval-console/src/client/host-api.ts`(`state(logical?)` / `sessionPreset(sessionId)` 已支持)
- `packages/dsh-eval-console/src/client/EvalDetail.tsx`(回滚按钮已按 canRollback 门禁)
- `packages/dsh-eval-console/src/domain/protocol.ts`(EvalAction 三 kind: detail / switch-revision / rollback;canRollback 字段)
- `packages/dsh-eval-console/src/host-routes.ts`(baseLogicalId 归一化;/eval/session-preset)
- `packages/dsh-eval-console/src/client/locales.ts`(新增空状态文案键)
- 任务:08-25-feat-08-25-preset-version-selector(版本选择器,canRollback/归一化的来源)
- `research/evolution-scope-design.md`(作用域化设计文档 §7 三入口形态)
