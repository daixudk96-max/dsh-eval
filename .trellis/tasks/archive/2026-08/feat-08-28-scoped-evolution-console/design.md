# Feature Design

status: approved   # draft | approved(用户已批准)
execution_lane: standard   # quick | standard

## 目标与非目标

**目标**:「进化」conversation.view 从固定展示 evaluate 链,改为**默认绑定当前会话 preset**,并且**快照数据按该 preset 作用域化**(audit 记录经事件归属过滤,不串链);无 preset 或无链 → 明确空状态;有链 → 仅展示该 preset;三个版本级动作语义清晰(查看内容 / 同步为新会话可选版本 / 回滚 current 指针);promote 不可从 UI 触发。

**非目标**:跨 preset 全局管理(另案);promote 上线;会话热切换(recompose);wire 协议变更;registry/evolution-controller 库改动;旧审计数据迁移。

## 方案

### 边界

- **Host 层(本轮新增)**:
  - `audit.ts` 或 adapter helper:新增纯函数 `scopeAuditEntries(audit, logicalId)` — 把全量 ledger 记录按 logical preset 作用域化。
  - `host-service.ts`:`snapshot(logicalId?)` 读全量 `auditAll`,令 `snapshot.revision = auditAll.length`(兼容全局 SSE revision;内部 `this.revision` 计数同样用 `auditAll.length`),但传给 `buildSnapshot` 的 `audit` 用 `scopedAudit = scopeAuditEntries(auditAll, logicalId)`;timeline 随之只含该 preset。
- **Client 层**:`EvalConsoleView.tsx`(scoped 状态机 + 空状态 UI)、`VersionSelect.tsx`(复用 session-preset hook)、新增 `useSessionPreset` helper(或 `client/session-preset.ts`)、`locales.ts`(空状态文案键)、`host-api.ts`(无需改,接口已够)。
- **协议层**:`protocol.ts` 不新增 kind,不变更 wire 形状(host-api 接口签名不变;仅 Host 内部 snapshot 逻辑与 helper 改变)。
- 无 registry / evolution-controller 改动。

### 数据流

```text
(会话切换/标签打开)
  → EvalConsoleView 挂载
  → useSessionPreset(sessionId):
       GET /eval/session-preset?sessionId=<id>
       → {presetId: string|null}
         · sessionPersistence.inspect(sessionId) 解压 zstd 会话
         · 倒序找最后一个 agent-preset/selected 事件 data.agentPreset(newest wins)
         · 否则 meta.agentPreset;否则 null
  → 状态机分支:
       presetId === undefined(解析中) → loading
       presetId === null(无预设)      → no-preset
       presetId !== null:
         GET /eval/state?logical=<presetId>
           → Host:精确 logical 无链时 baseLogicalId 归一回退(仅对 <id>-<digest8>)
           → Host snapshot:auditAll 读全量 ledger
             → scopedAudit = scopeAuditEntries(auditAll, logicalId)
             → buildSnapshot({..., audit: scopedAudit, revision: auditAll.length})
           → snapshot: current + history + columns + timeline(仅该 preset)
           → current===null && history.length===0 → no-chain
           → 否则 → ready(snapshot)
   → ready 渲染:当前版本条 + 六列 + 时间线 + 详情 modal(仅该 preset 行)
  → SSE /eval/events(revision delta):
       帧 revision ≠ 本地 ref → 重新 GET /eval/state?logical=<presetId>(scope 不变)
  → 动作:
       查看内容:POST /eval/action {kind:'detail', revisionId} → modal 文件展示
       同步为新会话版本:POST /eval/action {kind:'switch-revision', revisionId}
           → Host:digestForRevision → revisionContent → 读取 manifest.mutations →
             syncRevision(changeNote) → 写 .agent-presets/<logical>-<digest8>/
             (owner 标记 .dsh-preset-owner.json,原子提交,幂等)
           → 审计 append switch-to-revision | current 指针不变
       回滚 current:POST /eval/action {kind:'rollback', logicalId, revisionId, confirm}
           → Host:parseActionEnvelope 校验 confirm === ROLLBACK:<revisionId>
           → registry.rollbackContent(detectConflicts:true, force:false,
               gateRunId/approvalId = eval-console-<requestId8>)
           → 新 current revision 写入 + 审计 | promote 不在此路径
  → error(网络/计时/解析失败) → error 状态,重试按钮 → refresh
```

### 审计作用域化(核心,关键设计)

**动机**:`adapter.ts buildRows`(163-210)与 `timeline.ts timelineEvents`(85-90)消费全量 audit;真实 `C:\Users\daixu\.dsh\evolution-audit\ledger.jsonl` 中绝大多数旧事件**没有 `logicalId`**:

```text
{"op":"audit","runId":"evr-mt45oajj-912pd0","event":"created","state":"DRAFT"}          # 无 logicalId
{"op":"audit","runId":"evr-mt45oajj-912pd0","event":"candidate-created","candidateId":…} # 无 logicalId
{"op":"audit","runId":"evr-mt45oajj-912pd0","event":"sealed","revisionId":"evaluate-c60321bb",…}  # revisionId 带前缀
{"op":"audit","runId":"evr-mt45oajj-912pd0","event":"gate","from":…,"to":"ACCEPTED",…}  # 无 logicalId
{"op":"audit","runId":"evr-mt45oajj-912pd0","event":"promoted","revisionId":"evaluate-c60321bb",…}  # revisionId 带前缀
{"op":"audit","event":"switch-to-revision","logicalId":"evaluate",…}                    # 显式 logicalId(新事件)
```

只改 Client `state(preset)` 会让 audit-only candidates 与 timeline 混入其他 logical preset(如 system-evolver 的 SEALED/REJECTED 卡片出现在 evaluate 快照)。**必须**在 Host 侧先把 audit 按 preset 过滤。

**scopeAuditEntries(audit, logicalId) 规则**:

1. 收集归属 runId 集合:
   - 显式 `entry.logicalId === logicalId` → 归属;
   - `entry.revisionId` / `entry.targetRevisionId` 前缀为 `${logicalId}-` → 归属,并记录其 `runId`;
   - 注意 `targetRevisionId` 出现在 rollback 事件(`rollback-applied`),也要匹配前缀。
2. 保留「显式 logicalId 匹配」的事件与「归属 runId 集合内 runId 匹配」的全部事件(created / candidate-created / gate / promoted / budget / proposal-rejected / promote-near-duplicate / sealed / resample / switch-to-revision 等)。
3. 排除其他 logical presets 的事件(如 `system-evolver-` 前缀、`system-evaluator-` 前缀、无归属 runId 的无主事件)。
4. 无法归属的事件默认排除(宁可少展示,不串链)。

**契约说明**:wire 协议不变(快照仍是同一 `EvalSnapshot` 形状、`schemaVersion` 不变);但 Host 内部 snapshot 组装逻辑改变(全量 audit 读取 → 作用域化后 buildSnapshot),且 `revision` 计数器**保持 `auditAll.length`**(全局 SSE 帧的 revision 语义不变,避免跨逻辑快照的 revision 漂移;SSE 触发重拉仍按该全局计数,重拉时再按当前 preset 作用域)。

**SSE 语义**:`/eval/events` 帧仍为全局 audit revision delta,不按 preset 过滤(server 端不维护多连接按 logical 过滤;数据量小,scoped 重拉成本可接受);client 收到 delta 后以**当前 scope 的 logical** 重拉快照。

### 会话 preset 解析(关键)

沿用 VersionSelect 已验证的路径(不要重造):

1. Host `sessionPresetOf(sessionId)`:requires `sessionPersistence.inspect(sessionId)`(Cordis 服务,处理 zstd 多帧);返回 events 倒序最后一个 `{type:'agent-preset/selected', data:{agentPreset:string}}`;无事件 → `meta.agentPreset`;都无 → null。**注意**:传 sessionId 原样(带 `session-` 前缀,DSH 会话 header id 就是带前缀的;剥离会导致 inspect 找不到)。
2. Client:对同一会话,`conversation.view` 与 `conversation.session.header.actions` 的 PropsRuntime **均提供 `sessionId`**(已核实:`ConvViewProps = PropsRuntime<'conversation.view'>`,slots.ts:447,注释明确 session-scope view 提供 sessionId/useSessions;VersionSelect 从 header.actions 的 PropsRuntime 解构 sessionId 已工作)。直接解构 sessionId 即可,无需注入 face。

### 状态机定义(区分两种空状态)

| 状态 | 判定 | UI |
|---|---|---|
| `loading` | preset 解析中(undefined) | 加载面板 |
| `no-preset` | 会话元数据确实无 agentPreset(meta 与事件都无) | 空状态:「此会话未绑定预设」 |
| `no-chain` | 有 preset id(cordis/standard/deep-mindmap/…)但 registry 无链(current 空 + history 空) | 空状态:「预设 <id> 尚未纳入版本管理」 |
| `ready` | 有链快照(current 或 history 非空) | 版本条 + 六列 + 时间线 |
| `error` | 拉取失败 | 错误面板 + 重试 |

**纠正(重要)**:cordis/standard 属于**有 preset id 但 registry 无链** → 归 `no-chain`,而非 `no-preset`;`no-preset` 仅会话元数据确实无 agentPreset(极少数 legacy/手动会话)。

### 契约变更

- `protocol.ts`:**无新增 kind**。三个动作已存在:`detail` / `switch-revision` / `rollback`(rollback 需 `logicalId + revisionId + confirm=ROLLBACK:<id>`);`EvalStatusRow.canRollback` 已存在(history 链非 current = true;current/audit-only = undefined/false)。
- `host-api.ts`:**无签名变更**(`state(logical?)`、`sessionPreset(sessionId)` 已支持)。
- `host-routes.ts`:**无变更**(baseLogicalId 归一化已实现)。
- `host-service.ts`:**内部变更**(snapshot 加 scopeAuditEntries 接线;新 export `scopeAuditEntries` 或从 helper 模块 export;EvalConsoleHostOptions 不变)。
- `audit.ts`(或新 helper 模块):**新增** `scopeAuditEntries(audit, logicalId)` 纯函数 + 类型导出。
- `client` 新增:空状态 locale 键 + `useSessionPreset` hook(纯复用,无新协议)。

### 取舍

- **不全面开放(默认仅当前会话作用域)**:跨 preset 全局管理另案。理由:控制台的首要职责是「当前 preset 的进化病历」;全局管理需要新的筛选/多链视图,风险与范围都超本任务;用户已明确「跨 preset 全局管理不在本任务」。
- **空状态 vs 整块消失**:版本下拉选了「无链即不渲染」(紧凑头部);进化标签是内容型视图,选择「明确空状态」——用户打开标签知道「当前预设没有版本链」,而非看到空白或 evaluate 链。二者行为差异合理(heading strip vs content view)。**cordis/standard 归 no-chain**(与 VersionSelect「无链不渲染」不同——标签是内容视图,给出明确说明)。
- **SSE 行为沿用**:`/eval/events` 是全局 audit revision delta;scoped 快照重拉只改 `?logical=` 参数不变,不增加按 preset 过滤的 SSE(避免 server 端维护多连接按 logical 过滤;数据量小,重拉成本可接受)。
- **changeNote**:switch-revision 时读取 manifest.mutations → 装饰同步目录 preset.yml(`name: 评测 · 0c3922a0` + `description: …本版变更: …`),已有能力,本轮只验证接线。
- **回滚自动 approvalId**:现状 `eval-console-<requestId8>` 由 Host 生成——这是本平台的已知简化(UI 回滚绕人审,CLI promote 仍强制 approvalId)。本轮**不动它**(变更会扩大范围),但作为风险列出。

## 风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
|---|---|---|
| 旧 ledger 无法归属事件被排除 | 个别历史事件(理论边界:run 的 sealed 事件缺失)可能不显示 | 归属规则文档化 + 跨 logical fixture 测试;默认排除(宁可少展示不串链);审计历史本身完整,数据未损 |
| 只改 client 参数、遗漏 Host scoping | audit-only 卡片/时间线串链(主要回归点) | 实现步骤强制先做 scopeAuditEntries 再改 client;AC1/AC7 明确断言;独立 review 核对 |
| `revision` 计数变化导致 SSE 重拉错乱 | client 拿到旧 scope 数据 | 明确 `revision = auditAll.length` 不变,测试断言(跨 logical 多次 snapshot 的 revision 单调不减) |
| 空状态误判(no-preset vs no-chain) | 显示错误文案 | 状态机判定规则文档化;测试覆盖 cordis(no-chain)/无 meta 会话(no-preset) |
| SSE 全局帧重拉 scoped 快照 | 跨 preset 变更也触发重拉 | 数据量小可接受;实现保留 revision skip(与现状一致) |
| 回滚 approvalId 自动生成 | 绕人审(已知简化) | 本轮保留;后续任务:确认短语 UI 升级为显式人审(detail 文案明确「此操作将移动 current 指针」) |
| 文案/视觉回归 | 空状态与卡片混排 | 新增 `.evc-empty` / `.evc-noState` 复用现有 token;对比截图 |

**回滚点**:本任务全部在 client + Host helper(scopeAuditEntries + snapshot 内部接线);git 提交为单 commit,回滚 = revert 该 commit;协议形状不变,其他插件不受影响;lib 构建产物在 .gitignore,rebuild 即可。

## 验证计划

1. 单测:
   - `scopeAuditEntries`(新):跨 logical fixture —— evaluate run(A) + system-evolver run(B) 交织的 ledger;断言 columns / history summaries / audit-only candidates / timeline 只含 A;旧无 logicalId 事件经 runId 关联保留;显式 logicalId 事件(switch-to-revision)保留;无归属事件排除;`targetRevisionId` 前缀匹配。
   - host-service.snapshot:mock registry + 真实 tempdir ledger,断言 scopedSnapshot 的 columns 不含 B 的行、timeline 不含 B 事件、`snapshot.revision === auditAll.length`(跨 logical snapshot 单调不减)。
   - `useSessionPreset`(fake transport:presetId 解析三种 + 无会话)+ EvalConsoleView scoped 状态机(loading/no-preset/no-chain/ready/error 用 fixture snapshot)在 `test/` 新增;现有全量回归。
2. typecheck(tsconfig.build + tsconfig.client)0 错误;`npm run build`(tsdown)成功。
3. 真实验证(重启 GUI 后):
   - evaluate 会话 → 标注「评测 · 0c3922a0」,控制台显示 evaluate 链(当前完整链),**时间线只含 evaluate 事件(无 system-evolver 的 SEALED/REJECTED)**;
   - 新开 cordis 会话 → 控制台 **no-chain** 空状态;
   - deep-mindmap 会话 → 控制台 **no-chain** 空状态;
   - 无 preset 会话(手动构造或 legacy)→ 控制台 no-preset 空状态(如无法构造,以单测/说明代替并记录);
   - evaluate 会话点版本下拉 previous → 同步成功,审计出现 switch-to-revision,pointer 不变;
   - 详情 modal:非 current previous 有回滚按钮;current 无;REJECTED 无;
   - curl 检查 `/eval/state?logical=evaluate` 与 `?logical=evaluate-0c3922a0`(归一化回退)返回的 columns/timeline 只含 evaluate。
4. 独立 review/check:派 check 子代理核对 AC1-AC8(read-only),记录到 review.md。

## 人审检查点

- [ ] 本设计已获用户确认(status=approved)后再进入实现
- [x] conv.view PropsRuntime sessionId 契约已核实(slots.ts:447;无需再核实)
