# P0：可信评测闭环与 Registry 备份

- status: `planning`
- execution lane: `standard`
- 本文是 P0 的需求收敛稿；尚未批准实施，不包含产品代码变更。

## Goal

让一次进化决策同时具备三类可审计证据：

1. **业务质量证据**：真实 LLM-judge 按 rubric 产生可观察分数，并进入 evolution gate；
2. **评测完整性证据**：benchmark 材料在冻结 epoch 内没有漂移，候选不能复制 benchmark 题面或私有 rubric；
3. **存储恢复证据**：preset-registry 可以导出并在新 root 校验恢复，文件完整性不再错误地依赖旧 manifest digest。

成功标准不是“代码跑过”，而是：低质量/不可比较/污染的候选不能 promote；真实可用的业务分数和 registry 备份能在 run、audit、pointer 中追溯。

## Background：已确认事实

### P0-1：judge 执行链不是从零开始

以下能力已经存在，P0 不重复重写：

- `packages/dsh-eval/src/judge.ts:16-28` 已定义 `JudgeChatRequest` 与 `JudgeChat`；`packages/dsh-eval/src/judge.ts:69-89` 已构造 task/trace/rubric prompt；`packages/dsh-eval/src/judge.ts:140-147` 已调用 chat；`packages/dsh-eval/src/judge.ts:159-169` 已把调用异常转成 null verdict；`packages/dsh-eval/src/judge.ts:178-197` 已提供 `llmJudgeChat(...)` 生产 seam。
- `packages/dsh-eval/src/runner.ts:214-233` 已聚合 `finalAnswerScore` 与 `hallucinationRate`；`packages/dsh-eval/src/runner.ts:435-452` 已在完成 trial 后调用 judge；`packages/dsh-eval/src/runner.ts:471-477` 已在配置 judge 却没有 chat seam 时 fail loud。
- `packages/dsh-eval/src/index.ts:51-54` 已从 `ctx.get('llm')` 创建生产 seam；`packages/dsh-eval/src/index.ts:232-245` 已在 loader settle 后注入 judge/模型/settings/credentials。
- `packages/dsh-eval/src/benchmark.ts:23-33` 已支持 `judge.provider`、`judge.model`、`judge.rubric`/`rubricText`/`rubricCipher` 与 `maxScore`；`packages/dsh-eval/src/model.ts:94-106` 已有 `resolveJudge(...)`。
- `packages/dsh-eval/tests/judge.spec.ts`、`packages/dsh-eval/tests/runner.spec.ts:266-305`、`packages/dsh-eval/tests/command.spec.ts:120-156` 已覆盖 seam、解析、聚合、失败与无 llm 场景。

真实缺口是 `packages/evolution-controller/bin/dsh-evolve.js:90-106` 的 `evalEvidence(run)` 只取 task/tool/steps，没有取 `run.grading.finalAnswerScore` 与 `run.grading.hallucinationRate`；`packages/evolution-controller/bin/dsh-evolve.js:226-232` 也没有把 rubric 传给 `controller.evaluate(...)`。因此 `packages/evolution-controller/lib/gate.js:96-115` 的 rubric 规则在真实命令闭环中未被触发。

### P0-2：proposal-check 没有 benchmark 污染规则

`packages/evolution-controller/lib/proposal-check.js:102-146` 已检查 hypothesis/evidence、mutation、no-change、test-only/comment-only、W_p=3 与候选去重；`packages/evolution-controller/lib/controller.js:95-128` 已提供写入 registry 前的早拒挂载点，但没有 benchmark digest、statement、case id、private rubric corpus。

`research/dsh-self-evolution/src/candidate.ts:201-239` 的 `assertCandidateNotBenchmarkSpecific(candidate, benchmark)` 是参考实现：精确检测 benchmark digest、长度至少 40 的完整 statement、长度至少 20 的私有 rubric、`case_id: <id>`，分别产生 `BENCHMARK_OVERFIT` 或 `BENCHMARK_CONTAMINATION`。

### P0-3：gate 有 epoch 原语，评测没有 epoch 契约

`packages/evolution-controller/lib/gate.js:22-39` 已有 `digestOk`/`epochSame`，但调用方默认传 `true`。`packages/dsh-eval/src/types.ts`、`packages/dsh-eval/src/benchmark.ts`、`packages/dsh-eval/src/runner.ts` 没有 frozen、material manifest、caseHash、run-level invalid/epoch 结果。

参考：`research/dsh-self-evolution/src/benchmark.ts:57-88,107-166` 计算冻结 benchmark digest，`research/dsh-self-evolution/src/engine.ts:158-169,305-320` 评测前后 reload 并在变化时抛 `BENCHMARK_CHANGED`；`research/dsh-continual-evolve/src/score.ts:136-160` 提供 caseHash 漂移语义。

本项目不把整个 workspace 默认当 benchmark 材料：workspace 是 agent 可变输出，默认全量 hash 会产生无关漂移和误 invalid。

### P0-4：registry 的 legacy digest 不证明内容树完整

`packages/preset-registry/lib/registry.js:130-147` 的 `sealRevision(...)` 只用 manifest 计算 revision digest；`packages/preset-registry/lib/registry.js:236-242` 的 `verifyRevisionDigest(digest)` 只重算 manifest，不能发现 revision 内容文件被删除或篡改。现有 registry 已有 logical/pointers/revisions/staging/ledger、CAS promote、rollback、WAL recovery、`revisionContent(...)`，但没有 export/import。

## Requirements

### R1 — Judge 可观察、可进入 gate

1. 保留现有 `dsh-eval` judge prompt、stream seam、解析与测试；先做真实 smoke diagnostic，区分 composition 缺 service、provider/credential、stream 调用、响应解析四类失败。
2. judge 配置存在时，run 记录每 trial 的 judge 状态/诊断（成功、调用失败、输出不可解析），不得把 outage 伪造成业务低分；敏感值和完整私有 rubric 不进入普通 audit。
3. `dsh-evolve` 从 `run.grading.finalAnswerScore`、`hallucinationRate` 与 `run.judge.maxScore` 构造结构化 rubric evidence，并传给 `EvolutionController.evaluate(..., { rubric })`。
4. 计划采用统一 0–100 rubric gate 单位：`normalizedScore = finalAnswerScore / maxScore * 100`；默认 `rubricMinScore=60`，允许命令参数/配置覆盖。候选与 baseline 的 judge evidence 都必须有效；任一侧无分数或 run 无效时不能 promote。
5. hallucination 作为 rubric regression 证据：candidate 的 `hallucinationRate` 高于 baseline 即记录 `hallucination` regression；不得用“judge 不可用”替换成 0 分。
6. `packages/evolution-controller/lib/gate.js` 在显著性判定前处理 rubric validity/epoch invalid，避免 null 或不可比较数据被 `INCONCLUSIVE` 绕过；保留现有确定性 check、质量回归、效率回归与 rubric minimum/regression 规则。

### R2 — Overfit/污染早拒

1. 新增纯函数模块 `packages/evolution-controller/lib/overfit.js`，吸收 `research/dsh-self-evolution/src/candidate.ts:201-239` 的机制但按 CJS 零依赖改写，并标注 `# absorbed-from`。
2. 支持四类 finding：benchmark digest、完整 public statement、`case_id: <id>`、private rubric；阈值沿用 digest 精确匹配、statement 长度 ≥40、rubric 长度 ≥20、case id 长度 ≥8。
3. 扫描 candidate 相对 source 的新增/修改文本，不扫描未变化的继承内容，降低 source 已含普通词汇时的误报；finding 只保留 code/kind/caseId/path，不保留私有 rubric 原文或命中片段。
4. `controller.createCandidate(...)` 在 registry staging 写入前执行；命中时写 `proposal-rejected` 审计、抛稳定 code/reason、不得创建新的 registry candidate。`gate.js` 不重复读取 benchmark 私文；如需兜底只接受结构化 `contaminationPassed/findings`。
5. frozen benchmark 若无法提供所需 benchmark metadata，按安全策略拒绝进入优化，而不是静默跳过污染检查。

### R3 — Frozen benchmark epoch/material manifest

1. `packages/dsh-eval/src/benchmark.ts` 增 `frozen?: boolean`，默认 `false`；增显式 `materials?: string[]`（相对 benchmark 文件目录的 regular files），不默认扫描 workspace。
2. 加载 benchmark 时计算稳定的语义 snapshot：canonical benchmark identity、case id/order/split、resolved prompt、expected tool/check、judge rubric 的语义 hash、显式 materials 内容 hash；运行时 provider 路由作为 provenance，不混入语义 digest。每 case 产生 `caseHash`，整份 benchmark 产生 `benchmarkDigest`。
3. `frozen:true` 的 run 在开始捕获 snapshot，并在整轮结束 reload/re-hash；变化、材料缺失、非法路径或 snapshot 不一致时生成 `status:'invalid'` 的 run 记录，保留 mismatch/notes，不聚合 grading，不伪造分数，并返回非零。
4. `EvalRun` 持久化 benchmark digest、case hashes、snapshot verification、epochChanged/status；老 run/import 数据字段保持可选兼容。未冻结 benchmark 仍记录 provenance，但不因漂移 invalid。
5. `dsh-evolve` 比较 baseline/candidate 的 benchmark epoch；任一 run invalid、digest 不同或 epochChanged 时将 `epochSame:false` 传给 gate，结果为 `INVALID`，current 不变。
6. frozen benchmark 的“冻结”是评测 epoch 不可漂移，不等同于 P1 的 case lifecycle `draft → calibrating → frozen`。

### R4 — Registry export/import

1. `packages/preset-registry/lib/registry.js` 增 `exportSnapshot(outPath)` 与对应 `importSnapshot(...)` API；保留 legacy revision digest 算法，不改已有 revision ID。
2. export schema v1 为单 JSON 包：`schemaVersion:1`、metadata、全部 `logical/`、`pointers/`、全部 `revisions/`、原始 `ledger/ledger.jsonl`；不导出 DRAFT staging、`.tmp` 或 live `agentPresets` 对象。
3. 每个文件用 `{path, encoding:'base64', content, sha256}` 表示；包顶层用 canonical file-entry 列表计算 `packageDigest`。逐文件 hash 是备份完整性的依据，`verifyRevisionDigest` 只作为 legacy manifest 验证另行记录。
4. import 仅支持空目标 root（不存在或无内容）；先校验 schema、相对路径/路径遍历、重复 path、文件 hash、packageDigest、每个 revision manifest digest 与 pointer/logical 引用，再写临时目录并提交。失败不得破坏已有目标 root；非空 merge/覆盖另列任务。
5. `dsh-evolve` 增独立 `--export <path>` / `--import <path>` mode；该 mode 不要求 benchmark/logical，错误 schema、非空目标与校验失败返回非零。

## Acceptance Criteria

- **AC1 Judge 闭环**：确定性测试证明 fake judge 的 score/hallucination 被 `dsh-evolve` 映射为 rubric evidence 并传入 controller；null/invalid judge 不能 promote；真实 clipa smoke（环境可用时必须执行）产生非 null `run.grading.finalAnswerScore`、`hallucinationRate` 与 gate audit rubric evidence。若环境不可用，必须保留精确诊断且 P0 不宣称真实 AC 已通过。
- **AC2 Overfit**：四类污染各有单测；正常候选与 source 未变化材料不误报；controller 在 staging 前拒绝并写结构化 `proposal-rejected`，审计不泄露私有 rubric，registry 不产生新 candidate。
- **AC3 Frozen**：frozen=false 的旧 benchmark 行为保持兼容；frozen=true 且材料未变正常完成；在评测 epoch 内修改 prompt/显式 material/judge rubric 或造成缺失时产生 invalid run、非零退出、无 grading；baseline/candidate digest 不同触发 gate `INVALID`。
- **AC4 Export/import**：多 logical、多 revision、pointer、rollback-window 及 ledger 可导出；篡改单文件/package/path/schema 均拒绝；导入新空 root 后 current/history/ledger 可读，全部 revision 的 legacy manifest 校验与逐文件 hash 校验通过；失败不污染目标 root。
- **AC5 Regression**：`packages/evolution-controller` 全部 node:test 单进程通过；`packages/dsh-eval` mirror build/typecheck/vitest/pack 全部通过；真实 dev/guard 或等价 fixture 证据归档；相关 README 不再把已实现 judge 写成 deferred。

## Out of Scope

- 重写 `packages/dsh-eval/src/judge.ts` 的 prompt/评分算法；Terminal-Bench/Harbor/LMAB 适配。
- 语义级 overfit、模型行为检测、完整 case 生命周期与 calibration（P1）。
- weighted aggregate、keyless replay/import codex/claude、failure feedback、逆编辑 rollback、威胁扫描、WebUI、UCB-Air。
- registry 非空 root 的 merge/覆盖/冲突解决；改变现有 revision digest 算法；导出 DRAFT staging。
- judge 成本预算与 P2 budget ledger 的联动。

## Constraints and Risks

- `packages/evolution-controller` 保持 CJS/node:test/零新增依赖；`packages/dsh-eval` 保持 ESM/vitest，源码改动后必须通过 `prepare-sdk.mjs` mirror 流程。
- 上游只读；吸收机制的生产文件头部标注 `# absorbed-from: <repo>/<file>`；不复制不同项目的整体运行时。
- 评测与进化信任域继续分离：benchmark 子进程只读，registry/controller 本进程只写。
- judge 无 seam 是配置/组合级 fail loud；单次 provider/解析失败保留 trial 完成但写 null/诊断；进化 gate 对不可用业务证据 fail closed。
- 真实 provider、凭证、profile bundle 是环境风险；不得用手填分数替代真实 smoke。
- Windows 路径、原子目录提交和无 spawn pipe 的测试限制必须在实施验证中显式记录。

## Planning Status / Open Decision

本稿给出推荐契约，仍待用户确认严格 fail-closed 语义后再进入最终 planning review。实现前必须把推荐契约写入 `design.md` 的 approved 版本，并再次获得用户对完整计划的明确批准；当前禁止 `task.py start`、产品代码修改和实现派工。
