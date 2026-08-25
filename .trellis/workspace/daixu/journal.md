
## 2026-08-23 · gate 效率维度(同质量+步骤减少算提升)
- 用户定调: 「我实现同一个目标, 效率提升肯定算提升」→ 给 Code Gate 增加效率维度。
- 改动(a97f088):
  - packages/evolution-controller/lib/gate.js: efficiencyGain = 1 - candidate.steps/baseline.steps(两者正数时); 更慢→FAIL(效率回归); 同质量+efficiencyGain>=minEffect→PASS; 无 steps 输入行为不变。
  - 顺带修复 packages/evolution-controller/lib/proposal-check.js normalizeText: 原把 '## ' markdown 标题当注释删除, 导致三代 previous 内容哈希完全相同(f038a29f…), near-dup 检测失效; 改为只删 YAML 注释 /^#(?:\s|$)/。
  - test/gate-efficiency.test.js 8 用例; evolution-p2.mjs finish 映射 run.json aggregate.steps + --approve <id> 真实 promote。
- 真实闭环(第 6 轮): baseline 63 步 vs candidate 37 步, 均 taskSuccess 1.0 → gate PASS(efficiency gain 0.413 >= 0.05)→ 用户批准 → promote evaluate-ab63a9b7(gateRunId evr-mt4lwb75-w2td4x, approvalId user-approved-efficiency-2026-08-23)→ 导出 eval/presets/evaluate-evolved/。
- 历史链 5 代: ab63a9b7(效率) → 8b9b3f03(缩进修复) → ab811c74(标题去重) → c60321bb(compare+闭环) → dab4f200(初始)。
- 全量回归 8 个测试文件通过; near-dup/budget 演示正常。

## 2026-08-23 P3 治理收尾(08-23-feat-08-23-p3-governance, 已归档)

- **redact.js**(packages/evolution-controller/lib/redact.js): 照 lmzhen redact.ts 改写,
  扩展路径/session id/已知凭证值; controller.createCandidate 的 hypothesis/evidence
  脱敏后才入审计/存储(redactValues 构造参数)。
- **bin/dsh-evolve.js**: 进化闭环单命令 CLI。闭环 = resolveCurrent → 候选(目录或占位变异)
  → createCandidate+seal → 评测×2(spawn dsh --profile eval run, 只读域子进程)
  → Code Gate(minEffect/效率/回归/rubric) → ACCEPTED+--approve → promote, 否则拒绝 exit 1。
  产物: baseline.json/candidate.json/gate.json/result.json。
- 测试: redact 11 例 + controller-redact 2 例; evolution-controller 全量 10 文件回归通过。
- 真实闭环(registry C:/Users/daixu/.dsh/preset-registry):
  - 无 --approve → gate PASS 但拒绝(exit 1)—— 人审绑定强制
  - 带 --approve → promote evaluate-c4d8aec0(指针带 gateRunId+approvalId)
  - 审计 ledger 无凭证形状残留(grep 验证 AC2)
- 踩坑记录:
  - '

<redacted:path>'.includes('<redacted>') 为 false —— 断言写错占位符形状
  - audit ledger 只记 evidence 条数不记全文, 脱敏验证点应在 run 对象
  - resolveCurrent 的 resolved 字段只在挂 agentPresets 时非 null, CLI 判定应看 revisionId
  - result.decision 是 gate 决策(PASS), state 才是 ACCEPTED; promote 分支判定用 state
- 提交: P3 代码 commit(redact+controller+bin+测试), 任务文档 commit, archive 自动提交。

## 2026-08-23 — P4 自动进化闭环(proposer 生成侧 + 评测集 + 系统 preset 治理)

任务: 08-23-feat-08-23-auto-evolution(PRD-only 升级为全量, 已归档)。

### 完成
- **proposer 生成侧**: packages/evolution-controller/lib/proposer.js(failureEvidence→redact→LLM 严格 JSON→{hypothesis,evidence,mutations,candidateFiles}; 非 JSON/空假设/空文件/LLM 失败→拒绝)+ lib/llm-client.js(凭证 env→~/.dsh/.credentials.yaml, fetch, 零依赖)。absorbed-from dsh-self-evolving specs/03 §9(生成侧; 门槛侧是 proposal-check)。
- **dsh-evolve --auto**: 流程重构(baseline 评测先行→候选→seal→candidate 评测→gate); --proposal-run 支持历史失败 run.json(growing-archive); parseArgs 修无值 flag bug(下一 token 以 -- 开头=无值)。
- **评测集**: fixtures/rename-me(重命名+防改测试陷阱)+ readme-me(TASK.md 任务/README.md 交付物); refactor-rename-benchmark.yaml(dev)+ readme-write-benchmark.yaml(guard), 真实跑通均 100%。
- **系统 preset 治理**: install-system-presets.mjs 初始安装 system-evaluator-9c24a8c1 + system-evolver-5fac7f0b; 三 logical(evaluate/system-evaluator/system-evolver)指针独立。
- **真实闭环**: run-short.json 历史失败 → proposer 生成「Direct task mode+重试规则」变异 → seal evaluate-9682331a → gate INCONCLUSIVE 诚实拒绝(未 promote)。
- 测试 77/77; commit 99b6271。

### 踩坑
- parseArgs 无值 flag 会吞下一个参数(--auto --benchmark → benchmark 丢失), 修: 下一 token 以 -- 开头视为无值。
- readme-me 初版 README.md 既当任务说明又当交付物 → 改 TASK.md 分离。
- fixtures 风格不一致(CJS module.exports vs ESM import)会直接 SyntaxError → 统一 ESM。

## 2026-08-23 P0 可观察 Judge + Overfit + Frozen + Archive(08-23-feat-08-23-p0-judge-overfit-frozen, 已归档)

- **P0-1 可观察 Judge**(commit e6047f2):
  - 根因链: eval profile 下 dsh-base patch 层含 llm 插件行 → ctx.get('llm') 非 undefined → 走 dsh-llm stream 路径; 但 llmJudgeChat(llm.stream) 解构方法丢失 this → 'Cannot read properties of undefined (reading streamWithRegistration)' → tryJudgeTrial 静默 null。
  - 修复: resolveJudgeChat 用 llm.stream.bind(llm); buildJudgePrompt 加 'Respond with ONLY that JSON object. No markdown fences. No commentary. No other fields.'(deepseek-v4-flash 原不遵守 STRICT JSON, 返回 {success:false,...}); judge.baseUrl/apiKeyEnv 字段 + createHttpJudgeChat 直连 fallback(组合无 llm 服务时); resolveJudgeApiKey(env → ~/.dsh/.credentials.yaml)。
  - 真实验证: fix-multiply-judge-benchmark.yaml → finalAnswerScore 8.0, hallucination true, rationale 完整(run-p0-judge-fm-2026-08-23.json)。
- **P0-2 Overfit**(lib/overfit.js): 四规则 delta 扫描(digest 精确/statement≥40/case_id: <id> id≥8/privateRubric≥20), 只扫候选新增行; controller.createCandidate 在 staging 前检查, 失败只记结构化 findings 并 throw。测试 9+3。
- **P0-3 Frozen Epoch**: benchmark frozen+materials schema, 语义 digest(canonical JSON SHA-256, 覆盖全量 case 使 dev/guard 共享 epoch), 运行结束重载 sourcePath 验证, 漂移 → status invalid + aggregate/grading null + epochChanged; dsh-evolve epochSameOf 双 run 判定。测试 6+3。
- **P0-4 Archive**: registry.exportSnapshot/importSnapshot(自校验 JSON 包: 路径安全/逐文件 hash/package digest/revision manifest/pointer 引用; 临时 sibling + rename); dsh-evolve --export/--import(拒绝不兼容 flag)。真实往返: 139 文件 23 revisions, 指针/历史/digest 全保留。测试 6。
- 全量: dsh-eval 186/186 vitest + typecheck 0; evolution-controller 13 文件 node:test 全绿。
- 踩坑: ①prepare-sdk 要求 DSH HEAD == pinned 70195e98, 本地扩展 commit 2db2fa3f 需临时 checkout 跑完恢复; ②loadBenchmark 的 benchmark command 为空数组, frozen 测试需传 command 覆盖; ③exactOptionalPropertyTypes 下 Map.get 不窄化, 需局部变量; ④clipa 服务 down 时评测 TRANSPORT 失败(用户重启后恢复); ⑤evaluate-preset-rubric 任务 agent 陷入重建 DSH_HOME 兔子洞超时, 换 fix-multiply 稳定验证。

## 2026-08-23 P1 (feat-08-23-p1-eval-engineering) 完成
- 实施(子代理 a64bdcd8): P1-1 case weight(weighted 均值, 默认1/拒非正) / P1-2 keyless replay 记录(replay.dir/<caseId>-<trial>/session.jsonl, @deepseek-ai/dsh-llm-replay 全环境不可用→record-only 诚实记录) / P1-3 import codex|claude-code(已有 commit 91386d5, 核实 importCodexLog/importClaudeLog/importTraceFile + 12 测试) / P1-4 dsh-evolve --status(只读, 真实验证 3 logical presets digest 全 ok) / P1-5 lifecycle draft|calibrating|frozen + meta strict / P1-6 caseCheckProblems(prompt>=20/非 draft 需 meta/rubric 非空, parseBenchmark 抛 'benchmark case validation failed:') / P1-7 feedback.js computeQualityFeedback(权重 taskSuccess .40 toolAcc .30 finalAnswer .20 halluc .10, 重归一, quality_warn)。
- 验证: trellis-check(8b4fe12e) PASS-WITH-NOTES; 修复 replay 未包 try/catch 偏差(runner.ts:545-552 → console.error 不失败 run); mirror 全量 vitest 197/197(15 文件), evolution-controller 14 文件 98 测试全绿。
- 踩坑: weight:1 默认破坏 2 个 toEqual 断言; prompt>=20 校验破坏 30 个短 fixture 测试(全部迁移); zod 先拒空串 rubric(caseCheckProblems 直接调用测空白串); .toContain 数组元素相等语义; strict TS cases[0] optional-chaining; mirror HEAD 2db2fa3f ≠ pinned 70195e98 无法跑 prepare-sdk(直接 vitest)。
- 提交: 15 文件 688+/77-, 后接 archive auto-commit。

## 2026-08-23 P2 (feat-08-23-p2-governance-enhance) 完成
- 实施(子代理 5d3f0d71): P2-1 registry.rollbackContent(buildInverseEdits 纯 diff 反演, 新内容寻址 revision + CAS, promote 重构 _promoteLocked 避免锁链死锁)+ controller lib/rollback.js(prepareRollback 只读/applyRollback 需 approvalId)+ autoRollbackOnReject(仅 prepare+audit 不自动应用); P2-2 detectConflicts 默认 true 交集即报错 'rollback conflict: intermediate revision ... changed ...' --force 覆盖; P2-3 lib/threat.js 三类纯正则(prompt_injection/exfiltration/secret), createCandidate 写 staging 前扫描(默认 true, block→run.candidateId=null)+ promote 重扫, audit {event:'threat-blocked'}, 真实 demo threat-block-demo.js(临时 registry); P2-4 dsh-evolve failures <run.json...> 子命令(位置参数 args._), classifyFailure 前缀规则, 真实 3 run.json: timed-out:1 task-failed:1; P2-5 compare --delta(renderDecisionDelta 逐 case before→after 表, pass/fail + numeric 两路), 真实: v2 fail→v3 pass +1。
- 验证: check(4de1d9fc) PASS; 回归 evolution-controller 17 文件/113 测试, preset-registry 3/21, dsh-eval mirror 15 文件/200 + tsc 0。
- 观察项: previous retained 依赖 _promoteLocked 既有测试; 重复回滚 digest 含 sealedAt 不同(与 sealRevision 一致); task-failed 正则含 /task success/、/grade/ 命名略反直觉但行为确定。
- 提交: 18 文件 + archive auto-commit。

## 2026-08-23 P3 (feat-08-23-p3-content-memory) 完成
- 实施(子代理 1556366b, 完成前被回收未发报告; 主会话核实全部就位+全量回归): P3-1 lib/skill-extract.js(吸收 dsh-skill-evolve; 参数泛化 http→<url>/path→<path>/数字→<number>/>50字→<long_text>, 步骤去重同 tool+argsPattern first-wins) + 真实 demo: 解码 session-a0c5c3a4(30,518 events/16 turns/13 tools)→58 步→SKILL.md; P3-2 lib/state-store.js(四类 kind prompt|memory|skill|subagent-spec 映射 Registry API, 按 id 回滚/CAS/history, registry.js 增 _safeFileId(%→%25,:→%3A)向后兼容); P3-3 lib/skill-lifecycle.js(active→stale→archived + restore/consolidate/pinned+plan 豁免); P3-4 热挂载验证 FEASIBLE(demo/hot-mount-verification.js 真实 FileSystemSkillProvider 隔离 DSH_HOME, 7 断言含热新增; 结论 research/hot-mount-verification.md); P3-5 lib/memory.js(逐字符预算, 溢出前端 LRU 驱逐, dedup 含日期前缀近同); P3-6 lib/injection.js(ranked ≤6/kind×180 字符, 空 store 返回 '', archived+local: 过滤)。
- 验证: check(b2d455fe) PASS-WITH-NOTES; 回归 evolution-controller 22 文件/168 测(新 55), preset-registry 3/21, dsh-eval 0 改动。
- 已知项(未修, 记档): bin/dsh-evolve.js printStatus 直接读 logical 目录文件名当 id 未解码 _safeFileId——state 条目会以 state%3Aprompt%3Astyle 假 id 出现且 resolveCurrent 二次编码显示 none; 建议 P4 命令面重构时处理。新模块未入 index.js 导出(纯库直引)。
- 提交: 16 文件 + archive auto-commit。

## 2026-08-23 P4 (feat-08-23-p4-webui-console) 完成
- 基底选型(子代理 16ea9e61, 结论 research/webui-base-selection.md): 采纳 dsh-web-ui 家族 dsh-task-board(@linxin666/dsh-client-ui-task-board v0.3.2, Apache-2.0)为代码基底; dsh-evolve-modes 否决(无 webServer/SSE、无看板、无 conversation.view、SDK 0.0.1-rc.1 更旧)。关键差异: 上游无 conversation.view 槽注册(用中心列 DOM 接管)→ 不照搬, 复用内部件+自建标签页; 版本错配(上游 rc.2 vs 我们 rc.8)→ 复制源码用 rc.8 SDK 构建, API 面已核实兼容。
- 实施(子代理 44f3b65d, 中途停止一次, send_message 恢复后完成): 新包 packages/dsh-eval-console/ — Host src/index.ts(createRequire require preset-registry, 默认 DSH_HOME→preset-registry + evolution-audit/ledger.jsonl, logicalId evaluate, inject ['webServer'], 内联 mountOnce) + host-service.ts(resolveCurrent+history+pointer-updatedAt+audit→snapshot, revision counter=audit 行数, 5s poll→SSE, apply detail/rollback/refresh, rollback logicalId 校验, 永不 promote) + host-routes.ts(GET /eval/state no-store / POST /eval/action 415/413/400/405 / GET /eval/events SSE 15s ': ping' 心跳; fence=浏览器同源标记+loopback socket) + http.ts + audit.ts; Client src/client/index.tsx(conversation.view id:evolution order:20, locale NS, ctx.slots.inject+ctx.locale.register, 对齐 ui-trajectory rc.8 范例) + EvalConsoleView/EvalCard/EvalDetail(确认短语 modal)/ConfirmDialog(吸收)/host-api(fetch+EventSource 15s AbortController)/locales(zh/en)/board.css(evc- 前缀 800 行, 6 statusDot 色, 无 takeover); domain/ 纯函数(states 6 态+EVAL_COLUMNS+statusFromGateDecision / protocol 严格 exactKeys parseActionEnvelope+ROLLBACK:<revisionId> 确认令牌+EVAL_SCHEMA_VERSION=1 / adapter buildSnapshot / timeline); cordis.patch.yml 行 {id: ui-eval-console}; LICENSE(Apache-2.0 全文)+NOTICE(derived-from dsh-task-board v0.3.2)+absorbed-from 标记 7 文件。
- 验证: check(1867e742) PASS-WITH-NOTES, AC1-AC5 全 VERIFIED; tsc host+client 0 错(tsc 6.0.3); tsdown lib/client.js 49.48 kB(gzip 11.13 kB), 仅 react externals, 0 @deepseek-ai 值引用; 单测 22/22(states 5+protocol 8+adapter 6+timeline 3, node:test 单进程, Node 24 type-stripping 直 import .ts); smoke-state 真实 registry 只读: 20 行/6 列/103 事件, current evaluate-c4d8aec0(gateRunId evr-mt55ya37-ta3ww5, approvalId user-approved-p3-governance-2026-08-23); smoke-routes 10/10(未确认回滚 400/裸请求 403/方法 405); 回归 evolution-controller 168 + preset-registry 21 全绿; dsh-eval 零改动。
- 偏差 8 项全部确认(审计路径单文件 evolution-audit/ledger.jsonl 带嵌套 fallback / 无 schemastery schema / 全局 evc- CSS 非 CSS modules / 无 dsh-web shared presets 内联 mountOnce / loopback fence 简化 / 回滚=内联确认短语 modal / resolved 线上强转 boolean / bundle id=包名)。
- 已知项(未修, 记档): console Host 构造 new Registry({root}) 未注入 DSH agentPresets 适配器 → 当前版本条 resolved 芯片恒 false(AC3 仍满足, 语义惰性); GUI 浏览器挂载验证未做(需 DSH 重启, 主会话协调); 真实端到端回滚未跑(smoke 只走拒绝路径保持只读)。
- 提交: 新包 + research/webui-base-selection.md + feature-union-gap.md P4 勾选 + task 文档 + journal, 后接 archive auto-commit。
- GUI 挂载验证(2026-08-24, 用户重启 DSH 后): 安装 `dsh plugin --profile web add E:/github/dsh-eval/packages/dsh-eval-console`(link 方式, bundles 含 dsh-eval-console)成功; 服务端探测: GET /eval/state → 403 fence(路由已注册, 裸请求正确拦截), GET /plugins/dsh-eval-console/client.js → 200 49,477 B(__ModuleLoader__.load 握手正确); 浏览器确认「进化」标签已出现(order:20, 轨迹之后)——AC2/AC3/AC4/AC5 浏览器侧全部确认, P4 完全收尾。

## 2026-08-25 cmd-surface(方向2)完成 — commit da059ef
- 任务 08-25-cmd-surface: registry.decodeFileId(逆编码, %25 先于 %3A 解码防二次解码)+ printStatus 解码假 id(修 P3 观察项: state%3Aprompt%3Astyle 假 id/二次编码 none)+ dsh-evolve.js --budget-dir/--budget-limit。
- 关键发现: BudgetLedger 语义 limitUsd <= 0 = 无限(P2 约定); CLI 传 0 会静默变无限 → CLI 要求 limit > 0 才启用, ≤0/单侧给警告禁用。
- 预算拒绝验证方式: 预置 ledger spend 记录(limit 0.01 + spend 0.01) → newRun remaining=0 → 'evolution budget exhausted (remaining 0 USD)' + exit 1(多轮场景: 上一轮花光本轮拒)。
- AC1-AC4 全达成: --status 真实 registry 输出 evaluate/system-evaluator/system-evolver 三链无假 id; registry 9/9; evolution-controller 22 文件全绿。

## 2026-08-25 ucb-air(方向1)完成 — commit 多候选并行闭环
- 任务 08-25-ucb-air: lib/ucb.js(shouldExpand (N+P_eval)^alpha>=T alpha=0.6 忠实上游 specs/03 §7 + 首波约定; ucbScore mean+sqrt(2ln(totalN+1)/n)) + proposer.proposeMultiple(W_p≤3 互异假设、carbon-copy 去重重问、LLM 瞬时失败重试≤2 次 backoff、非重试拒绝立即返回、partial 诚实返回) + dsh-evolve --candidates n(仅 --auto; 每候选独立 run; 并行评测并发≤2 Promise.allSettled; 评测前 canAfford 预算检查→budget-blocked; 选择=唯一 ACCEPTED 或最高 gain+effGain; --approve promote)。
- 真实闭环(临时 registry 复制品): 2 互异假设(都针对 ask-user 交互阻塞, 一个说 persona 硬编码路径+交互选择, 一个说 ask-user 工具本身)→ 并行评测 → 候选0 4步 effGain 0.2 PASS / 候选1 5步 INCONCLUSIVE → pick 候选0 → promote evaluate-66e3b543(approval user-approved-ucb-air-2026-08-25)。
- 踩坑: ①clipa 并发请求互相抢占导致 LLM 300s 超时/ fetch failed——LLM 调用必须串行, 测试时勿并发; ②单候选 --auto 分支在多候选时也执行(浪费一次 LLM 调用)→ 包 candidateCount===1 修复; ③预算耗尽拒绝后 Node 24 Windows libuv 断言(UV_HANDLE_CLOSING, exit 0xC0000409)——proposer fetch 连接未清理的退出竞态, 功能正确, 记录不深挖; ④本环境评测 costUsd=0(pricing null), 预算只能在 newRun 层耗尽, budget-blocked 分支代码就位但真实评测中不可达(如实记录)。
- 测试: ucb 10 + proposer-multi 9 + proposer 8 + 全量回归无失败。

## 2026-08-25 实战任务收尾: evidenceOk 修复(commit 1f894e7 + 84cbb34)

- R5 暴露 gate 缺陷: 引擎故障 run(0 tokens/1-2 步)被效率维度比较, 1 步 vs 2 步 → efficiencyGain 0.5 ≥ minEffect → 虚假 PASS。
- 修复: lib/run-evidence.js(新, trace 尾部 turn/end error 检测 + case error 无 trace 检测)+ gate.js evidenceOk 开关(INVALID 优先于一切数字比较)+ dsh-evolve.js 双路径接线。
- 测试: run-evidence 10 + gate-efficiency +3, evolution-controller 全量 25 文件 0 失败。
- R6 真实验证: 订阅再次失效, 与 R5 相同数字(2步/1步)→ INVALID, 不再虚假 PASS。
- 实战闭环 6 轮: R1 证据干净但 epoch 命名未过; R2/R4/R5/R6 订阅间歇失效; R3 baseline 干净 candidate 流截断。候选(45→38 步 effGain 0.156)有 R1 证据但未过 epoch 校验 → 未 promote, 待订阅稳定窗口重跑。
- 教训: 「数字比较」前必须先证「数字可信」; 间歇性上游故障(InvalidSubscription/PI_AI_ERROR)是当前评测最大外部风险。

## 2026-08-25 实战闭环完成(08-25-system-evolver-field, 待归档)
- 子代理评测轮(用户切换评测方式): 两个 subagent 分别注入 baseline/candidate persona 评测同一真实 session; baseline 32 步(列目录 55 会话+询问回退) vs candidate 23 步(直接用路径), 均 CHECK_PASS → efficiencyGain 0.281。
- gate PASS(整体无增益, 效率增益达标) → 用户批准 → promote evaluate-94a7c40b(gateRunId evr-mt82l8v7-pkxdp6, approvalId user-approved-unattended-2026-08-25)。
- 指针链 4 代: 94a7c40b(active) → c4d8aec0 → ab63a9b7 → 8b9b3f03; evaluate-evolved/ 已重新导出+EVOLUTION.md 更新。
- 脚本: research/evolution-subagent-gate.mjs(闭环, --approve 才 promote)、research/eval-subagent-collect.mjs(证据收集)。
- 复盘: research/system-evolver-field-report.md §2.4 补子代理轮; §4 结论更新为 promote 成功。
- 回归: evolution-controller + preset-registry 全测试 0 失败。
- 前置: evidenceOk 修复(commit 1f894e7)让 R5 虚假 PASS → R6 INVALID。

## 2026-08-25 · system-presets 工具面接线(08-25-system-evolver-tools, 已归档)

- 用户链: 问 system-presets 设计稿工具面接线啥意思 → 解释两条路(A 注册真实工具/B 命令型) → 用户选 A「行吧,建立吧。建立完成计划以后,调用 AgY 技能委派。按照 TRELIS 的目标去执行,你就别执行了。」
- 机制查证(关键): DSH agent preset 的 agent.cordis.yml 是**顶层插件行列表**, 非自定义 name/tools/forbidden 结构(后者 DSH 标 broken); 工具注册 API = ctx.tools.register({name,description,parameters,output:{schema,render},execute}), 权威范例 E:\github\dsh\packages\preset\agent-presets\tests\fixtures\plugins\contribute.js; 行 name 相对路径从 preset 目录解析。
- 前置: trellis init -u daixu --gemini 成功(.gemini/commands/trellis/ 等 9 文件, 已提交并登记 .template-hashes.json)。
- AgY 执行(relay.mjs, gemini-3.7-flash-high, 后台): 4+4 工具插件 + 两预设合法化 + preset.yml + install.ps1 目录级复制 + 测试 9/9 + 全量回归 29 文件绿。真实安装到 ~/.dsh/.agent-presets/system-{evaluator,evolver}/。
- **踩坑**: ①relay.mjs --brief 指向不存在文件报 "missing required property file_path" —— brief.md 忘写, 补齐后成功; ②AgY 在 evolution.run 加了 approve 参数透传 --approve —— 审查发现违反信任域(agent 可自造 approvalId 绕人审), 已移除(仅 CLI 侧人审), README 注明; ③.gitignore 缺失时提交会带 node_modules(本项目根已有, 未触发)。
- 提交: 4dd839c(feat system-presets) + 035db40(chore trellis/gemini) + auto-commit archive。

## 2026-08-25 — system-evolver-tools-field(已归档)
真实进化第 N 轮(工具链驱动): executePropose→executeCandidate→executeRun 全链路验证。
- 模型路由纠错(用户质疑驱动): 评测子进程不继承主会话设置, 由 benchmark yaml 的
  provider/model 决定; 8-22 硬编码 clipa 致火山 ark 订阅失效(InvalidSubscription 400,
  account 2125384065); ollama 云(https://ollama.com/v1, deepseek-v4-flash:0731)实测
  可用, 切换后真实跑通。遗留: 其余 14 个 yaml 仍硬编码 clipa, 建议批量评估切换。
- 最终闭环: baseline 40 步/46 toolCalls/2.95M tokens✅ vs candidate 50 步/64
  toolCalls/3.40M tokens✅; 质量全 1.0 持平 → gate FAIL efficiency regression →
  诚实拒绝, 不 promote, current 保持 evaluate-94a7c40b。LLM 假设(CLI 路径指令)
  被真实评测否决(加了反而多 10 步)——Code Gate 价值验证。
- executeRun 修复: benchmarkBaseline/benchmarkCandidate 透传(原单 --benchmark 导致
  baseline/candidate 跑相同内容)、timeoutMs 默认 40min+err 透传(600s 固定超时被吞)。
- 测试: system-presets 10/10, 全量 29 文件 0 失败。提交 4e1ec76/3c329b8/64fdaed。
- 教训: ①LLM 假设必须过真实评测, 不提升不 promote(不伪造分数); ②干净证据时
  proposer 诚实拒绝是特性不是 bug; ③评测路由/凭证/订阅是真实进化的外部依赖,
  需显式验证。

## 2026-08-25 preset 版本选择器(08-25-feat-08-25-preset-version-selector, 已归档, c77e91f)
- 需求来源: 用户发现 GUI 模式选择器看不到 registry 版本(安装目录还是 v1, 7 代进化从未同步), 调研生态后批准实施。
- 生态调研: research/preset-version-ui-research.md — 完整功能(preset 内容版本选择器)生态空白; 组件级现成件: dsh-preset-switcher(头部下拉+热切换 recompose)、dsh-liangshen sync.ts(目录同步)、dsh-agent-preset-router(owner 标记防覆盖)、dsh-guise(库+指针+历史)。本轮不做 recompose 热切换。
- 实现: src/version-sync.ts(syncRevision 纯函数: owner 标记 .dsh-preset-owner.json / 幂等 / 原子 staging+rename / 路径安全); protocol.ts EvalAction {kind:'switch-revision'}(exactKeys 严格校验, 无 confirm); host-service.apply() 新分支 + agentPresetsRoot 配置; audit.ts appendAuditLine(尽力而为); client VersionSelect.tsx 注册 conversation.session.header.actions(id eval-version, order 30)。promote 语义不动(UI 永不推进指针)。
- 测试: console 37/37, evolution-controller 200/200, preset-registry 22/22; 独立 subagent 核验 PASS-WITH-NOTES(4 低危: locales 死文案/SSE 自愈/字符集/400 暴露路径)。
- 真实验证: evaluate-94a7c40b 同步到 ~/.dsh/.agent-presets/evaluate-94a7c40b/(owner 标记, 幂等, 指针不变); 产物 research/preset-version-selector-verify.md。
- 踩坑:
  1. npm 11.4.2 + Node 24 arborist bug: 'Cannot read properties of null (reading '"'"'edgesOut'"'"')' @ #loadPeerSet(处理 postcss peer 时)— 删 node_modules/lock/缓存均无效; 改用 pnpm install 成功。
  2. DSH SDK 类型缺失: @deepseek-ai/dsh-host-webserver 等 6 包用 junction 链到 E:\github\dsh\packages\(host|client)\* (lib 已构建), typecheck/build 恢复。
  3. version-sync.ts 放 src/domain 被 client tsconfig(include src/domain, types:[])编译报 node:fs 错 → 移根 src/。
  4. 大坑: web profile 的 node_modules/dsh-eval-console 是 symlink 指向源目录, Remove-Item 沿 symlink 把源 lib 删了 → 重新 build 恢复; 教训: 对 symlink 目标操作前先确认 LinkType。
  5. 根 .gitignore 新增(克隆仓库/run-short 产物/scratch), 防误提交。
- 遗留: ① GUI 重启后用户确认头部下拉 + 新会话可选 evaluate-94a7c40b; ② executeRun README 参数说明未同步(benchmarkBaseline/benchmarkCandidate/timeoutMs); ③ 14 个 benchmark yaml 仍硬编码 provider: clipa(火山订阅失效), 建议批量切 ollama。
