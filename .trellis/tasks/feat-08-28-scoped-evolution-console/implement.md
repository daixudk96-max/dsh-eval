# Feature Implement Plan

## 有序步骤

参照实现依据(已核实):
- `EvalConsoleView.tsx:38-73` `useEvalState(transport)` 调 `transport.state()` 无 logical = 固定默认 evaluate。
- `VersionSelect.tsx:78-92` 已有 sessionPreset 解析;`host-api.ts:34-53` 已有 `state(logical?)` / `sessionPreset(sessionId)`。
- `host-routes.ts` baseLogicalId 归一化;`adapter.ts:173-187` canRollback;`EvalDetail.tsx:157-166` canRollback 门禁。
- `host-service.ts:158-188` snapshot 读全量 audit,`revision = audit.length`。
- `adapter.ts:163-210` buildRows 与 `timeline.ts:85-90` timelineEvents 消费全量 audit;真实 ledger 多数事件无 logicalId(created/candidate-created/gate/budget 仅 runId;sealed/promoted 的 revisionId 带 `${logicalId}-` 前缀;switch-to-revision 显式 logicalId)。
- `/eval/events` = 全局 audit revision delta。

### Phase 1 — Host 审计作用域化(核心,先做) ✅

1. **新增 `scopeAuditEntries(audit, logicalId)`**(置于 `src/audit.ts`;纯函数,零依赖)✅
   - 规则(见 design §审计作用域化):显式 `entry.logicalId === logicalId` 或 `revisionId/targetRevisionId` 前缀 `${logicalId}-` → 归属,并记 runId;第二遍保留归属 runId 集合内的全部事件 + 显式 logicalId 匹配事件;顺序保持原 ledger 顺序(不重排)。
2. **host-service.snapshot 接线** ✅
   ```ts
   const auditAll = await readAuditEntries(this.auditFile)
   const scopedAudit = scopeAuditEntries(auditAll, logicalId)
   const snapshot = buildSnapshot({
     logicalId, revision: auditAll.length, current: currentFacts, history,
     audit: scopedAudit, tailLimit: this.tailLimit,
   })
   this.revision = auditAll.length
   ```
   注意:`pollOnce` 与 `digestForRevision` 保持用全量 auditAll。✅
3. **测试** `test/audit-scope.test.js` ✅
   - fixture:两个 logical(evaluate / system-evolver)run 交织的 ledger;断言仅 evaluate 保留、system-evolver 排除、无归属排除、顺序稳定、`targetRevisionId` 前缀匹配、host-service.snapshot columns/timeline 不串链、`snapshot.revision === auditAll.length`、跨 logical 单调。✅

### Phase 2 — Client 状态机与空状态 ✅

4. **抽取 `useSessionPreset`**(新 `src/client/session-preset.ts`)✅
   - `(transport, sessionId)` → `{preset: string|null|undefined, reload}`;undefined=解析中;解析失败 → null;逻辑与 VersionSelect 原内联一致。
   - VersionSelect 改为 import 该 hook(去重)。✅
5. **EvalConsoleView scoped 改造**(主改)✅
   - props 解构 `sessionId`;`useSessionPreset` + `useEvalState(transport, preset ?? null)`;状态机分支:loading/no-preset/no-chain/ready/error;`evalViewPhaseOf` 纯函数驱动渲染分支。
   - `useEvalState` 保留 SSE 订阅(revision delta → refresh 重拉当前 scope);preset 变更清旧 snapshot。✅
6. **空状态文案**(`locales.ts` 增键 zh+en)✅
   - `view.noPreset` / `view.noChain` / `view.loadingPreset`;board.css `.evc-noState` 样式。✅
7. **动作语义接线校验**(零改动或文案补齐)✅
   - 详情 modal canRollback 门禁;版本下拉 switch-revision;promote 无 UI 路径(protocol 无 promote kind)。✅

### Phase 3 — 测试 / 构建 / 验收 ✅

8. **测试**(`test/`)✅
   - `audit-scope.test.js`:scopeAuditEntries(8)+ host snapshot scoping(2)= 10 用例 ✅
   - `session-preset.test.js`:transport contract 三态(3 用例)✅
   - `eval-console-view.test.js`:evalViewPhaseOf 状态机五态(5 用例)✅
   - 现有全量回归:adapter/states/timeline/format/base-logical/protocol/service/version-sync。
   - **console 全量 71 用例 0 失败** ✅
9. **typecheck + build** ✅
   - `npm run typecheck`(双 tsconfig)0 错误;`npm run build`(tsdown)成功(client.js 150.97 kB)。✅
10. **真实 GUI 验证**(AC8,Host 改动需用户重启)——**主会话待办**
    - evaluate 会话 → 控制台显示 evaluate 链(时间线只含 evaluate 事件);
    - cordis 会话 → no-chain;deep-mindmap 会话 → no-chain;无 preset 会话 → no-preset(如无法构造,单测+说明替代);
    - evaluate 会话版本下拉 previous → 同步成功 + 审计 switch-to-revision + 指针不变;
    - 详情 modal:previous 有回滚按钮/current 无/REJECTED 无;
    - curl 检查 `/eval/state?logical=evaluate` 与 `?logical=evaluate-0c3922a0` 返回的 columns/timeline 只含 evaluate。
11. **独立 review/check**——**主会话待办**(派 check 子代理核对 AC1-AC8,记录 review.md)
12. **提交归档**——**主会话待办**(单 commit,task.py archive + journal 追加)

## 验证

- 质量门(项目 `.trellis/spec/` + 本任务 PRD AC):
  - 本实施完成:console 全量单测 79 用例 0 失败;typecheck 0 错误;tsdown build 成功。
  - 未动 registry/evolution-controller/DSH 本体。
- **待主会话**:真实 GUI 验证 + 独立 review/check + 提交归档。

## Review 修复轮(独立 review status:blocking → 已修复)

独立 code review 发现 F1/F2/F3 三个 blocking 与 F4/F5 minor,已全部修复:

- **F1 跨 logical 写侧未作用域化** ✅
  - 新增 `src/domain/revision-id.ts`:`logicalIdFromRevisionId(revisionId)` 剥最后 `-[0-9a-f]{8}`(logicalId 可含多 dash);`baseLogicalId` 改为其别名,`host-routes.ts` 复用,消除重复。
  - `host-service.digestForRevision(logicalId, revisionId)` 按推导 logical 查 current/history + scoped audit。
  - `apply` 的 detail/switch-revision 从 revisionId 推导 logical;rollback 校验 `derived === action.logicalId`,不一致拒绝;switch 的 `syncRevision.logicalId` 与 audit.logicalId 用推导值,绝不落 evaluate 目录。
  - `timeline(logicalId=this.logicalId)` 也 scoped(F5)。
  - 测试:`service.test.js` 新增 3 用例(system-evolver detail 解析自身链 / switch 同步到 `system-evolver-<digest8>` 且 audit.logicalId=system-evolver / rollback derived≠action 拒绝)。
- **F2 useSessionPreset 竞态** ✅
  - 新增 `src/client/latest-request.ts`:`LatestRequestController`(begin/isStale/invalidate,纯、无 DOM)。
  - `useSessionPreset` 用 per-effect scope token,旧 sessionId 晚到不覆盖新 preset。
- **F3 useEvalState / VersionSelect 竞态** ✅
  - `useEvalState` 用 `scopeController`,旧 logical 的 `state()` 晚到不覆盖新 scope;preset/session 切换清 snapshot/error/loading。
  - 测试:`test/latest-request.test.js` 5 用例(旧请求晚到被忽略 / begin 失效 / invalidate / count 单调 / 空控制器)。
- **F4 测试覆盖** ✅ 新增 latest-request(5)+ service cross-logical(3)。
- **scopeAuditEntries 额外修正** ✅ 用 `ownedByPrefix`(索引 Set)保留无 runId 的 prefix 命中记录;显式其他 logical 同 runId 也排除;`audit[i]` 加 `undefined` 守卫(noUncheckedIndexedAccess)。

**最终数字**:console 全量 **79 用例 0 失败**;typecheck 0 错误;build 成功(client.js 70.64 kB);evolution-controller + preset-registry 保险回归 0 失败。

## Review / 验证门

- [x] 实施侧代码/测试/构建全部完成(79 用例 + typecheck + build)
- [x] Review 修复轮(F1-F5)完成,独立复审 review.md status=passed
- [x] 独立 review/check 核对 AC1-AC8——trellis-check 已执行(见下)
- [x] 真实 GUI 验证(AC8,用户重启 Host 后 curl 实测)——见下方验证记录

### trellis-check 记录(2026-08-28)

- 命令:逐文件 `node test/<file>.test.js`(12 文件,0 失败);`npm run typecheck`(双 tsconfig,0 错误);`npm run build`(tsdown,client.js 70.64 kB / gzip 15.53 kB)。
- 保险回归:evolution-controller + preset-registry 共 28 个 test 文件,0 失败。
- git diff:仅 packages/dsh-eval-console 的 src/test 改动 + 新增 7 文件(latest-request/session-preset/revision-id + 4 测试);无 node_modules/lib 构建产物;无新增依赖(peer 仅 react+cordis)。
- 源码核对:scopeAuditEntries 显式 logicalId/prefix 归属 + runId 桥 + 显式其他 logical 排除;digestForRevision/apply 写侧按推导 logical 作用域化,rollback derived≠action 拒绝,switch 用推导 logical 同步+审计;useEvalState/useSessionPreset/VersionSelect 用 LatestRequestController 竞态守卫;preset 切换清 snapshot/modal。
- AC1-AC7 通过;AC8(真实 GUI)待主会话/用户重启验证。

### AC8 真实 GUI 验证(2026-08-28,用户重启 Host 后主会话 curl 实测)

- `GET /eval/state?logical=evaluate` → current=evaluate-0c3922a0, history 4, timeline 120(仅 evaluate 事件,foreign 检查 0 条 system-* )。
- `logical=cordis` / `logical=deep-mindmap` → current null + history 0 + timeline 0(no-chain 数据基础,UI 显示「预设 X 尚无版本链」)。
- `logical=system-evolver` → current=system-evolver-5fac7f0b, history 1(跨 logical 有链展示)。
- `GET /eval/session-preset?sessionId=session-87235c5a-…` → presetId=cordis(当前会话 → no-chain)。
- `POST /eval/action {kind:'detail', revisionId:'system-evolver-5fac7f0b'}` → ok=true, digest 5fac7f0b63cf…, files=agent.cordis.yml(跨 logical 读不再 unknown revision)。
- `POST /eval/action {kind:'switch-revision', revisionId:'system-evolver-5fac7f0b'}` → ok=true, targetDir=…\.agent-presets\system-evolver-5fac7f0b;审计最后一条 logicalId=system-evolver;`.agent-presets` 无新 evaluate-* 目录(写侧作用域正确,零串写)。
- client bundle: 70,645 B(新 build)。
- 浏览器视觉项(回滚按钮仅 previous 显示)由 canRollback 数据 + adapter 单测覆盖;无浏览器自动化,如实标注。

## 回滚点

- 单 commit 回滚:git revert(全部改动在 packages/dsh-eval-console client + host-service helper + audit helper + test;协议形状零变更,其他插件不受影响)。
- 若 scopeAuditEntries 归属规则在真实 ledger 上误排除有效事件:先调规则文档(优先 runId 关联;对明显 single-writer 的旧 ledger 可整段保留),再重跑跨 logical fixture 验证。
