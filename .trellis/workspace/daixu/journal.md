
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
