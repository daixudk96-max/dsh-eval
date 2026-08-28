# Feature Code Review

status: passed   # missing | passed | blocking

## 审查范围

- 任务 `.trellis/tasks/feat-08-28-scoped-evolution-console`(进化标签绑定会话 preset + 审计作用域化),第二轮独立审查(第一轮 blocking,见本文件历史)。
- 本轮核对第一轮 F1-F5 的修复 + 新增文件:
  - `src/domain/revision-id.ts`(logicalIdFromRevisionId / baseLogicalId,新增)
  - `src/client/latest-request.ts`(LatestRequestController,新增)
  - `src/client/session-preset.ts`(useSessionPreset 改用 LatestRequestController)
  - `src/host-service.ts`(digestForRevision/apply 参数化、timeline scoped)
  - `src/client/EvalConsoleView.tsx`(useEvalState 竞态守卫、modal 关闭)
  - `src/client/VersionSelect.tsx`(refresh 竞态守卫)
  - `src/host-routes.ts`(baseLogicalId 归一化)
  - `test/{latest-request,audit-scope,session-preset,eval-console-view,base-logical}.test.js`(新增)+ `test/service.test.js`(cross-logical 用例)
- 只读审查;未改业务代码、未提交。

## 第一轮 F1-F5 修复核验

### F1 — BLOCKING(写侧未作用域化)→ ✅ 已修复
- `host-service.ts:242 digestForRevision(logicalId, revisionId)` 已参数化,按推导 logical 查 current/history/scoped audit。
- `apply()` 各写 action 从 revisionId 推导 logical:`detail`(:272)、`rollback`(:286-292,校验 `derived !== action.logicalId` 即拒)、`switch-revision`(:314,`syncRevision` 与审计记录都用推导 logical,:332-348)。
- `revision-id.ts:14 logicalIdFromRevisionId` 贪婪正则 `^(.+)-[0-9a-f]{8}$` 只剥最后一段,多 dash logical(`system-evolver-5fac7f0b`)正确;`baseLogicalId` 别名供路由层。
- 测试:`service.test.js:442-530` 三个 cross-logical 用例(detail 在自身 logical 解析 / switch 同步到 `system-evolver-5fac7f0b` 目录且审计带 evolver logical / rollback mismatch 拒绝 `evaluate != system-evolver`)。

### F2 — BLOCKING(useSessionPreset 旧请求竞态)→ ✅ 已修复
- `session-preset.ts:68-85` 改用 `LatestRequestController`:effect 内 `begin()` 取 scope,`then/catch` 里 `isStale(scope)` 才 `setPreset`,cleanup `invalidate()`。
- `latest-request.ts` 正确:`begin()` 使前一 scope 失效、`isStale` 判最新、`invalidate` 全失效、`count` 单调。
- 测试:`latest-request.test.js` 5 用例含「旧请求晚 resolve 被忽略」竞态。

### F3 — BLOCKING(useEvalState/VersionSelect 旧快照竞态)→ ✅ 已修复
- `EvalConsoleView.tsx:51-81 useEvalState`:`refresh` 内 `begin()`+`isStale` 守卫 setSnapshot/setError/setLoading;effect 切 logical 时 `begin()`+清状态,cleanup `invalidate()`。
- `VersionSelect.tsx:81-111` 同模式,preset 切换清 snapshot/error/busyId/notice/open。
- `EvalConsoleView.tsx:112-114` preset 切换关闭 detail modal(selected 置 null)。
- 测试:`latest-request.test.js` 覆盖竞态语义。

### F4 — MINOR(缺写侧/竞态测试)→ ✅ 已补
- cross-logical 写 action 测试:`service.test.js:442-530`。
- 竞态测试:`latest-request.test.js`。
- `session-preset.test.js` 覆盖 transport 契约(成功/空/抛错吞 null);`eval-console-view.test.js` 覆盖 `evalViewPhaseOf` 五态纯函数。Hook 级渲染测试仍无(无 renderer),但竞态语义已由 LatestRequestController 单测覆盖,可接受。

### F5 — MINOR(timeline 未 scoped)→ ✅ 已修复
- `host-service.ts:404 timeline(logicalId = this.logicalId)` 已 scoped,内部用 `scopeAuditEntries(audit, logicalId)`。

## 新观察(非阻塞)

- `apply()` 的 `refresh` action(:310-312)调 `this.snapshot()` 无 logical 参数 → 回退 config 默认链。但 grep 确认**无任何 client 代码发送 `{kind:'refresh'}`**(仅 switch-revision 与 detail 被使用);client 用 `useEvalState.refresh()` 直调 `transport.state(logical)`。故该分支是 scoped UI 不可达的遗留路径,非跨 logical bug。建议后续清理或参数化,不阻塞本轮。
- `EvalDetail` 回滚发送 `logicalId={readySnapshot.logicalId}`(:272),Host 端 `derived === action.logicalId` 校验成立(rows 均来自该 scoped 快照,revisionId 前缀与 snapshot.logicalId 一致)。

## AC 对照

| AC | 判定 | 证据 |
|---|---|---|
| AC1 会话 preset 有链 → 仅展示该链 | ✅ | scopeAuditEntries 单测 + host snapshot 2 用例 + F3 竞态已修 |
| AC2 cordis → no-chain | ✅ | evalViewPhaseOf 单测;文案 `view.noChain` |
| AC3 无 preset → no-preset | ✅ | evalViewPhaseOf 单测;文案 `view.noPreset` |
| AC4 版本下拉 + switch-revision | ✅ | 非 evaluate 预设 switch 同步到自身目录(service.test.js:491) |
| AC5 详情/回滚 canRollback | ✅ | 非 evaluate 回滚 mismatch 拒绝(service.test.js:517);canRollback 门禁 |
| AC6 promote 无 UI 路径 | ✅ | protocol 无 promote kind;parseActionEnvelope 枚举拒绝 |
| AC7 测试/typecheck/build | ✅ | 12 测试文件 0 失败;typecheck 双 tsconfig 0 错;build client.js 70.64 kB |
| AC8 真实验证 | 待主会话 | implement.md 明示「主会话待办」 |

## 验证证据

- `node test/<file>.test.js` 全部 12 个测试文件 0 失败(本轮重跑)。
- `npm run typecheck` tsc build+client 双 tsconfig 0 错误。
- `npm run build` tsdown 成功(client.js 70.64 kB / gzip 15.53 kB)。
- 源码核对:digestForRevision/apply 参数化、rollback derived 校验、switch 用推导 logical、两个 hook 的 LatestRequestController 守卫、timeline scoped、host-routes baseLogicalId 归一化,全部就位。
- 未做:真实 GUI 重启验证(主会话范围)。

## 结论

- [x] **通过**(含 `trellis-check` 与任务要求的验证)
- [ ] 需修复后重审

第一轮 F1-F5 全部修复并验证;新增 cross-logical 与竞态测试覆盖。唯一遗留为 `refresh` action 的 config-default 回退(不可达遗留路径,非阻塞,建议后续清理)。
