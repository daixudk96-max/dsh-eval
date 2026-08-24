# Web UI 进化控制台基底选型结论（P4-0）

> 2026-08-23 — trellis-research 产出。目标：为 DSH Web GUI 进化控制台（进化控制台）选基底。
> 控制台需求：当前版本栏（revision/digest/gateRunId/approvalId）、六列看板
> SEALED/EVALUATING/ACCEPTED/PROMOTED/REJECTED/INCONCLUSIVE、JSONL 账本驱动的审计时间线；
> `conversation.view` 槽 order:20；Host webServer 数据通道
> `GET /eval/state` + `POST /eval/action` + `GET /eval/events`(SSE)。
> 用户原则：「WebUI 如果已经人已经有了,我们就在这的基础上改为」——不重写。
>
> 候选：① `zhu1090093659/dsh-web-ui`（★~3.7–5k，DSH Web GUI 插件全家桶，npm
> `@linxin666/dsh-web-ui-all`；本次已浅克隆到 `research/dsh-web-ui`）
> ② `research/dsh-evolve-modes`（v0.3.1，已克隆，比较用）
> ③ 兜底：`docs/evolution-console-prototype.html`（我们的静态原型）。

## 结论（TL;DR）

**采纳 dsh-web-ui 中的 `dsh-task-board`（@linxin666/dsh-client-ui-task-board v0.3.2）
作为进化控制台的代码基底（Apache-2.0，按 Apache-2.0 复制/改造并保留声明）。**
它是 DSH 生态中唯一同时具备「`conversation.view` 能力相关的最接近实现 +
Host webServer(HTTP+SSE) 数据通道 + 现成多列看板组件 + revision 状态快照」的参考实现，
且与我们规格要求的 `GET state / POST action / SSE events` 数据通道**同构**。

两点必须诚实说明的差异（本报告全部如实记录）：

1. **dsh-web-ui 全家桶没有任何 `conversation.view` 槽注册**（逐仓 grep 确认）。
   `dsh-task-board` 用的是**中心列 DOM 接管**（`[data-pane="conversation"]/[class*="centerCol"]`
   内挂载 + `data-dsh-taskboard-active`），不是视图标签页环。
   我们规格明确要 `conversation.view` order:20 —— 所以**不照搬其 DOM 接管，
   而是复用其看板组件、controller、transport、Host 路由/协议/CSS 等内部件，
   在我们的插件里自己注册 `conversation.view` 标签页**（注册契约在本仓库 rc.8 已核实存在，
   官方 `ui-trajectory` 即为权威范例，order:10）。
2. **版本错配**：dsh-web-ui 全家桶按 `@deepseek-ai/*@0.1.1-rc.2` SDK 构建，且
   `dsh.engines.dsh = '>=0.1.1-rc.1'`；我们 DSH checkout 是 **0.1.0-rc.8**（client-runtime /
   host-webserver / ui-conversation 均为 0.1.0-rc.8），**低于上游声明门槛，不能直接挂载其 bundle**。
   方案：不挂载上游 bundle，把 `dsh-task-board` 源码按 Apache-2.0 复制进我们自己的插件包，
   用我们 rc.8 的 SDK 构建。API 面（webServer/register、slots/register、centerCol 布局）
   在 rc.8 已逐项核实兼容。

---

## 1. 双候选对比表

| 维度 | ① dsh-web-ui → dsh-task-board | ② dsh-evolve-modes |
|---|---|---|
| 许可证 | **Apache-2.0**（根 + 每包全文本，允许派生/改造，需保留声明与修改标注） | MIT（更宽松） |
| 包形态 | pnpm monorepo；独立 Cordis bundle 包；`cordis.patch.yml` 单行 `{id: ui-task-board}`；`dsh.client.inject=[dsh-client-runtime, dsh-client-connection, dsh-client-ui-settings]`，platform web | 单包 `@graysilver/dsh-evolve-modes` v0.3.1；`cordis.patch.yml` 单行；dsh.client.inject 为 `@deepseek-ai/dsh-*@0.0.1-rc.1` 旧代 SDK |
| 构建系统 | `tsc -p tsconfig.build.json && tsdown`，共享 `shared/tsdown.client.ts` 预设；lightningcss 编 CSS Modules；TypeScript ~5.7.2 | tsdown + node 脚本（normalize/copy-types/verify） |
| React | **React 18**（peerDep `^18.2.0`，dev `^18.3.1`），CSS Modules | React 18.2（peerDep） |
| `conversation.view` 标签页 | **无**（全家桶逐仓 grep 无一处；dsh-task-board 用中心列 DOM 接管） | 无（只有 `conversation.input.left/plan`、`conversation.chat.turnTail/commandview`、`settings.section`，均为输入区/命令视图控件） |
| 数据通道 | **完整匹配规格**：`ctx.webServer.register` 三条路由 —— `GET {prefix}/state`(快照+revision, no-store)、`POST {prefix}/action`(requestId 信封, 严格校验)、`GET {prefix}/events`(SSE, 15s 心跳, revision 增量事件)；前缀 `/api/task-board` | **无 webServer/HTTP+SSE**；走 `remote`(typert 协议) + `conversationEvents`，纯 RPC 式 ControlFace |
| 看板组件复用度 | **高**：`TaskBoard.tsx` 自包含 React 组件，由 `BoardController` + `transport` 接口驱动；列由 `COLUMNS` 数据驱动按 status 过滤；表头已含 `revision/timeZone` 当前版本显示；1121 行 CSS 全 `--dsw-*` 令牌主题化 | 无看板；是模式切换/评审控件 |
| 依赖 | 运行 peerDep 仅 `react ^18.2.0`；deps 仅 `schemastery ^3.18.0`；**无原生/OS 特定依赖**；devDeps 为 `@deepseek-ai/*@0.1.1-rc.2` + tsdown/vitest/jsdom | deps `schemastery ^3.18.1-rc.1` + `zod ^4.4.3`；peerDeps 大量 `@deepseek-ai/*@0.0.1-rc.1`（更旧）+ `react ^18.2.0` |
| Windows 构建 | **可行**：`tsc`+`tsdown` 跨平台；本包无 bash 脚本（根 `test:mount` 用 bash 仅 Linux e2e，可选）；本地 node v24.4.1 ∈ `^22.19||>=24` | 可行：tsdown+node 脚本跨平台 |
| DSH 版本兼容 | `engines.dsh >=0.1.1-rc.1` **高于我们 rc.8** → 不能直接挂载；API 面兼容（webServer/register、slots/register、centerCol 均 rc.8 已核实） | peer `@deepseek-ai/dsh-*@0.0.1-rc.1` 旧代，与我们 rc.8 兼容性未验证且更旧 |
| 改造量估计 | 中：复制 Host 路由/协议/账本模式 + 看板组件/CSS；新写 domain 适配（registry→state）与六状态模型、时间线 | 大：无 webServer 通道、无看板、无 `conversation.view`，需自建一切，仅能借鉴 RPC 风格 |

**逐项依据（源码级）**：
- dsh-task-board Host 数据通道 `packages/dsh-task-board/src/host-routes.ts`：三条 `WebRoute`，
  `TASK_BOARD_API_PREFIX='/api/task-board'`；`GET {prefix}/state` → `writeJson(res,200,service.snapshot(),{'cache-control':'no-store'})`（非 GET→405）；
  `POST {prefix}/action` → 校验 content-type 为 json(否则 415)、`readBody`(import 2MB / 普通 action 64KB，否则 413)、
  `parseActionEnvelope`(否则 400)、`writeJson(res,200,service.apply(parsed.requestId, parsed.action))`；
  `GET {prefix}/events` → SSE：`res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive'})`，
  `push=()=>res.write(\`data: ${JSON.stringify(service.eventPayload())}\n\n\`)`、`subscribe(push)`、
  15s 心跳 `': ping\n\n'`、`req.once('close')` 清理；`push()` 立即推一次。
  `guard=isTrustedTaskBoardRequest`：`sec-fetch-site==='same-origin'||origin` 判定 + loopback 校验 + 可选 proxy token(`x-dsh-task-board-proxy-token`, timingSafeEqual)。
- 协议 `src/protocol.ts`：`TASK_BOARD_SCHEMA_VERSION=2`；`TaskBoardSnapshot{schemaVersion,revision,tasks,scheduler,power}`；
  `TaskBoardEventPayload{revision,scheduler,power}`（**刻意不含 tasks**，避免每帧深拷贝）—— 与我们「revision 增量 SSE」设计完全一致；
  `TaskBoardActionEnvelope{requestId,action}` + `parseActionEnvelope` 严格 exactKeys 校验。
- Host 服务 `src/host-service.ts`：`TaskBoardHostService` 持 `listeners=Set`、`snapshot()`、
  `eventPayload()`、`subscribe()`、`apply(requestId,action)`；账本 `src/host-ledger.ts`：
  `$DSH_HOME/task-board/ledger-v2.json`（原子写 tmp+fsync+rename、损坏隔离、revision 单调递增、
  `recentRequests` 幂等缓存 MAX=256）—— 与我们的 registry(revisions/<digest>) + JSONL 审计账本模式同源。
- Client transport `src/client/host-api.ts`：`HttpTaskBoardHostTransport` 实现
  `{state,action,subscribe,bootstrap}` —— `state()`=`fetch(\`${PREFIX}/state\`,{cache:'no-store'})`、
  `action(action)`=POST `{requestId:uuid(),action}`、`subscribe(listener)`=`new EventSource(\`${PREFIX}/events\`)`，
  onmessage 解析 JSON→listener（解析失败退化为全量 `state()`），`visibilitychange` 重连，`REQUEST_TIMEOUT_MS=15000` AbortController；
  **相对路径 fetch，同源，无 base URL 推导**。
- 看板组件 `src/client/board/TaskBoard.tsx`：`TaskBoard({controller})` 订阅快照；表头含
  `snapshot.host && <span>{t('board.hostMeta',{revision:String(snapshot.host.revision),timeZone})}</span>`（即当前版本栏雏形）；
  `COLUMNS.map(column=> tasks.filter(t=>t.status===column.status))` 渲染列/卡片/详情/弹窗。
  域模型 `src/core/tasks.ts` 框架无关：`TaskStatus='backlog'|'todo'|'running'|'done'|'failed'`、
  `COLUMNS[{status,label}]` 五列、`TaskRecord{id,title,description,prompt,status,createdAt,updatedAt,executions,...}`。
- 中心列接管 `src/client/board-mount.tsx`：`CONVERSATION_COLUMN_SELECTOR='[data-pane="conversation"], [class*="centerCol"]'`；
  `div.dataset.dshTaskboardView=''` + `data-dsh-plugin='task-board'`；`createRoot(...).render(<TaskBoard/>)`；
  `document.documentElement` 置 `data-dsh-taskboard-active`、互斥 `data-dsh-ssh-active`、`CustomEvent('dsh-panel-activate')`；
  侧栏行点击关闭。CSS `src/client/board.module.css`（1121 行）：`[data-dsh-taskboard-view]{position:absolute;inset:0;z-index:60;...}`
  覆盖 + `display:none !important` 隐藏会话内容（保留挂载与状态）；列 `grid-auto-flow:column; grid-auto-columns:minmax(220px,1fr); gap:12px; overflow-x:auto`；
  `statusDot[data-status]` 颜色映射；`@container task-board-view` 响应式。
- dsh-task-board 设置卡槽 `web-ui.plugin.item`（`{id:'task-board', order:110}`）—— 我们可仿此挂设置入口。

---

## 2. 裁决

**采纳 `dsh-task-board`（dsh-web-ui 家族）为代码基底**。理由按用户偏好逐条对齐：

1. **许可证**：Apache-2.0 允许派生/改造（保留声明 + 修改文件显著标注即可），满足「在此基础上改」。
2. **数据通道与规格同构**：它已有 `GET state(快照+revision)` / `POST action(requestId 信封)` / `GET events(SSE+心跳)`，
   正是规格的 `/eval/state` `/eval/action` `/eval/events` 三件套 —— 直接改前缀 `/api/task-board` → `/eval` 即可。
3. **看板组件现成可复用**：列由数据驱动（status 过滤 + `COLUMNS` 数组），表头 revision 显示即当前版本栏雏形，
   CSS 全令牌主题化；把五列 TaskStatus 换成我们的六状态即可。
4. **依赖极简、Windows 可构建**：运行依赖仅 react18 + schemastery，tsc+tsdown 跨平台，无原生依赖。
5. **会话根契约对齐**：`webServer.register`（`{kind,path,handler}` 返回 disposer）与 `slots.register`
   （`{name,id,order,label,locale,inject}`）在 rc.8 与上游实现逐项一致，复制源码用我们 SDK 构建无 API 断裂。

**否决 dsh-evolve-modes 为基底**：无 webServer/HTTP+SSE 数据通道（走 remote/typert RPC）、
无看板、无 `conversation.view`，且 peer 依赖为更旧的 `0.0.1-rc.1` 代 SDK —— 不满足规格任何一条结构性要求，
仅可借鉴其「ControlFace RPC」风格与 locale/apply-guard 手法。

---

## 3. 若采纳 dsh-task-board 的具体复用方案

### 3.1 直接复用的文件/模式（按 Apache-2.0 复制并保留声明，构建用我们 rc.8 SDK）

| 来源（dsh-task-board） | 复用什么 | 改为什么 |
|---|---|---|
| `src/host-routes.ts` | 三路由注册 + `isTrustedTaskBoardRequest` guard + `writeJson`/`readBody` helper | 前缀改 `/eval`；`/eval/state`、`/eval/action`、`/eval/events` |
| `src/protocol.ts` | `TaskBoardSnapshot/EventPayload/ActionEnvelope` + `parseActionEnvelope` 严格校验骨架 | `EvalSnapshot{schemaVersion,revision,digest,gateRunId,approvalId,rows,...}`；`EvalEventPayload{revision,...}`（不含大 payload）；`EvalAction`（approve/reject/promote/rollback 等，按我们 controller 定） |
| `src/host-service.ts` | `snapshot/eventPayload/subscribe/apply` 生命周期 + `listeners` 集合 + 定时器 | `EvalConsoleHostService`，订阅 registry + controller 变更事件 → emit SSE |
| `src/host-ledger.ts` | 原子写、revision 单调递增、损坏隔离、`recentRequests` 幂等 | 适配我们的 preset-registry（`revisions/<digest>/` 内容寻址）+ JSONL 审计账本，仍保 revision 单调 |
| `src/client/host-api.ts` | `HttpTaskBoardHostTransport`（fetch/EventSource/重连/超时） | 前缀 `/eval`；其余原样 |
| `src/client/board/TaskBoard.tsx` | 列/卡片/详情/弹窗/搜索/新建骨架、表头 revision 栏 | 六列状态、卡片字段改为 revision/digest/gateRunId/approvalId |
| `src/client/board.module.css` | 全部列/卡片/详情/响应式样式（`--dsw-*` 令牌） | 沿用；`statusDot` 增六状态颜色；看板根属性改 `data-dsh-plugin="evolution-console"` |
| `src/client/index.ts` | `claimTaskboardApply` 防重、`ctx.locale.register`、`installSettingsSection`、`mountOnce` | 沿用于我们的 `evolution-console` 插件 |
| `shared/tsdown.client.ts` / `shared/host/mount-once.ts` | 客户端 bundle 预设 + host 防重挂载 | 复用（源自 dsh-web 仓库共享层） |

### 3.2 集成点（对照规格）

- **`conversation.view` 标签页**（上游没有，需新写，契约 rc.8 已核实）：
  参照 `E:\github\dsh\packages\client\ui-trajectory\src\client\index.ts:43-44` 的权威范例 ——
  `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name:'conversation.view', id:'evolution-console', order:20, locale:NS, label:()=>t('view.title'), inject:(sessionId) => ({...}) }, ConsoleView))`；
  槽契约 `packages/client/ui-conversation/src/client/contract/slots.ts:103`：
  `'conversation.view': {kind:'list'; scope:'session'; owner:ConvViewOwnerProps}`（视图环，一次只渲染 active 条目）。
  `order:20` 满足规格（官方 trajectory 用 order:10）。
  **不**采用 dsh-task-board 的中心列 DOM 接管（`board-mount.tsx` 仅作参考）。
- **webServer 数据通道**：`ctx.webServer.register({kind:'exact', path:'/eval/state', handler})` +
  `{kind:'exact', path:'/eval/action', handler}` + `{kind:'exact', path:'/eval/events', handler(SSE)}`；
  `register` 返回 disposer 随插件生命周期释放（rc.8 `packages/host/webserver/src/index.ts:94` 已核实）。
- **Client 取数**：`HttpTaskBoardHostTransport` 相对路径 fetch + EventSource，同源无 base URL 推导；revision 增量事件驱动看板刷新。

### 3.3 需要新写的（我们的数据适配层）

1. **domain 模型**：registry/controller → `/eval/state` 快照适配器 —— 读 preset-registry 当前 revision/digest、
   gateRunId、approvalId，六状态行集；`/eval/action` 动作处理器（approve/reject/promote/rollback…）。
2. **六状态模型**：`EvalStatus='SEALED'|'EVALUATING'|'ACCEPTED'|'PROMOTED'|'REJECTED'|'INCONCLUSIVE'` +
   `COLUMNS` 映射 + `statusDot` 颜色 + zh/en i18n。
3. **审计时间线组件**：从 JSONL 账本读事件序列渲染时间线（dsh-task-board 只有 executions 列表无时间线）。
4. **`conversation.view` 注册**（上游无，见 3.2）。

### 3.4 从原型保留

- `docs/evolution-console-prototype.html` 的六列布局视觉、时间线形态、深色主题观感 —— 作为组件/样式参考，
  不直接搬 HTML，以 dsh-task-board 的令牌化 CSS 承载同款观感。

---

## 4. 诚实风险

1. **许可证义务**：Apache-2.0 要求复制时保留版权/许可证声明，并在修改文件中加显著修改标注（Section 4(b)）。
   需在复用的 `src/` 文件头保留原 LICENSE 引用 + 新增本平台修改标注；产物应附带 Apache-2.0 文本与 NOTICE（若有）。
2. **版本错配（真实阻塞点）**：上游按 `@deepseek-ai/*@0.1.1-rc.2` 构建且 `engines.dsh >=0.1.1-rc.1`，
   我们 checkout 是 **0.1.0-rc.8** —— **不能直接挂载上游 bundle**（版本门槛拒绝）。
   缓解：不挂载上游，复制源码用我们 rc.8 SDK 构建；`webServer.register` / `slots.register` / centerCol 布局在 rc.8 已核实兼容。
   仍建议在实现阶段做一次 rc.8 下的真实挂载冒烟，确认无隐藏 API 差异。
3. **`conversation.view` 缺口**：上游无此注册，需自己写（契约已核实、范例齐全），是改造中唯一「新写结构件」，
   但工作量为一个标签页注册 + 复用看板内部件，非重写。
4. **域模型差异**：dsh-task-board 的 `TaskRecord/ExecutionRecord` 是任务调度语义；我们的卡片是 registry revision
   语义 —— `src/core/tasks.ts` 需重写（这是我们的数据适配层，见 3.3），看板外壳与样式仍可复用。
5. **看板挂载方式**：上游 DOM 接管针对中心列；我们改用 `conversation.view` 标签页后，CSS 的
   `[data-dsh-taskboard-view]` 接管规则不再需要（标签页自带容器），样式需微调（去掉 takeover/`!important` 部分）。
6. **SSE 增量语义**：上游 `eventPayload` 刻意不含 tasks（避免深拷贝）——我们的 `/eval/events` 也要遵守同样取舍，
   行集变更走 revision 变化 + 客户端回拉 `/eval/state`，避免每帧推大 payload。
7. **Node 版本**：本仓库要求 node `^22.19||>=24`，本地 node v24.4.1 满足；pnpm workspace 安装需网络拉 `@deepseek-ai/*@0.1.1-rc.2`（仅 devDeps，用于类型/构建）。

---

## 5. 兜底结论（如实记录）

`dsh-web-ui` **可用**（克隆成功、Apache-2.0 可派生、架构与规格同构），无需启用兜底。
若未来因许可证或改造量原因放弃复用其看板代码，兜底排序为：

1. **自建插件 + 复制 dsh-task-board 的 Host 路由/协议/transport 模式**（Apache-2.0，最小工作量，
   保住 `GET/POST/SSE` 三件套）—— 即使不自建看板，这套数据通道模式也最值得抄。
2. `research/dsh-evolve-modes`：**不推荐**为基底（无 webServer 通道、无看板、无 `conversation.view`、SDK 更旧），
   仅作 RPC 风格参考。
3. 纯静态原型 `docs/evolution-console-prototype.html` 自绘：兜底兜底，仅当完全不引第三方代码时，
   仍建议参照 dsh-task-board 的 `--dsw-*` 令牌 CSS 与 transport 模式以保证与 DSH 主题/数据通道一致。

---

## 附：关键源码位置索引

- dsh-web-ui：`research/dsh-web-ui/`（浅克隆，head `0a264656`，dev 分支；Apache-2.0）
  - 看板包：`research/dsh-web-ui/packages/dsh-task-board/`
  - Host 路由：`src/host-routes.ts`；协议：`src/protocol.ts`；服务：`src/host-service.ts`；账本：`src/host-ledger.ts`
  - Client：`src/client/index.ts`、`host-api.ts`、`board-mount.tsx`、`board/TaskBoard.tsx`、`board.module.css`
  - 域模型：`src/core/tasks.ts`；包 manifest：`package.json`（engines.dsh `>=0.1.1-rc.1`，peerDep react ^18.2.0，deps schemastery ^3.18.0，build `tsc && tsdown`）
- DSH checkout（rc.8，`E:\github\dsh`，head `2db2fa3f` LOCAL EXTEND）：
  - `conversation.view` 契约：`packages/client/ui-conversation/src/client/contract/slots.ts:103`（`{kind:'list';scope:'session';owner:ConvViewOwnerProps}`）
  - 权威注册范例：`packages/client/ui-trajectory/src/client/index.ts:43-44`（order:10）
  - `slots.register` 选项契约：`packages/client/ui-slots/src/index.ts:559`（`{key?,id?,order?,label?,priority?}`）
  - webServer：`packages/host/webserver/src/index.ts:28-34,94`（`WebRoute{kind:'exact'|'prefix',path,handler}`，`register():()=>void`）
  - 版本：client-runtime / host-webserver / ui-conversation 均 `0.1.0-rc.8`
- 比较候选：`research/dsh-evolve-modes/`（MIT，v0.3.1）
- 原型：`docs/evolution-console-prototype.html`
