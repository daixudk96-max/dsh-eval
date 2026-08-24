# DSH 评测 + 进化平台 —— 生态基座吸收与改造计划

> 状态:计划稿 v1(2026-08-22)。本计划是「评测引擎基座化 + 进化引擎组件化」的唯一权威文档;
> 实施前先读本文件,所有「用谁的哪一部分、怎么用」以本清单为准。
> 配套:research/reference-absorption-plan.md(吸收点分级清单,本文件是其可执行化)。

---

## 0. 总原则(用户定稿)

1. **不整体重写**:凡生态已有、与目标同构的模块,一律「抽取 → 改造 → 复用」,禁止从零重新发明。
2. **同语言直接改**:逻辑部分(JS/与 CJS 同构)直接抽离出来,在我们的包内改。
3. **不同语言按架构改**:先拆出对方的功能模块,明确模块边界;模块语义同语言的直接改,
   不同语言的按对方架构要求、用我们的语言(CJS 零依赖)实现。
4. **每个模块三选一**:`直接改` / `改写(按架构用我们的语言)` / `印证已有(不实施,只对齐术语与验证)`。
   明确写「放弃」的模块不再讨论。

### 语言判定表

| 参考项目 | 语言/形态 | 判定 | 依据 |
|---|---|---|---|
| **hccccc01333/dsh-eval** (research/dsh-eval-src) | TypeScript 源,我们已有 CJS 移植 `packages/dsh-eval` | **同语言基座:直接改** | 13 文件同名对照,judge.js↔judge.ts 逐行同源(见 §2) |
| **ZK-Andy/dsh-continual-evolve** | TypeScript, ESM, src/ 56 文件, 527 tests, v0.4.0 | 不同语言:拆模块 → 按架构用 CJS 改写 | 我们 CJS 零依赖;模块语义可复刻(§3.1) |
| **timwhitez/dsh-self-evolving** | TS monorepo (10 packages), 需 Ubuntu+Docker+Bubblewrap | 不同语言+平台不兼容:拆**概念模块**改写 | Linux 绑定,代码不可直接落 Windows(§3.2) |
| **lmzhen/dsh-evolution** | TS monorepo, commonjs 包 | 不同语言:拆模块,主要「印证」 | data/control plane 我们已有同款(§3.3) |
| **Lhy723/dsh-self-evolution** | TS + dist/ 构建产物 | 不同语言:拆模块 → 改写 | 闭环设计最贴近,但无评测维度/强制审批(§3.4) |
| william-jin-cmu/dsh-evolve | TS, 2 文件 | 放弃(主题=热挂载插件能力) | 与 preset 版本化目标不同 |
| dmsobtl/dsh-skill-evolve | TS, 5 文件 | 放弃(主题=会话提炼 skill) | 同上 |
| GraySilver/dsh-evolve-modes | TS, 有 client UI | 放弃(主题=模式选择器 UI) | 不是进化引擎 |
| jasen215/dsh-continual-harness | TS, 22 文件 | 放弃(主题=持久记忆+回滚) | 对象是知识不是 preset |

---

## 1. 目标架构(吸收后的形态)

```
packages/
├── dsh-eval/                 # 评测引擎 —— 基座 dsh-eval-src,直接改(§2)
│   └── lib/  (基准 13 文件 + 4 适配层 + rubric.js 新增)
├── evolution-controller/    # 进化治理: 状态机 + Code Gate + rubric 聚合(§3.1)
│   └── lib/  (controller/gate/audit + aggregate.js 新增 + budget.js 新增)
└── preset-registry/         # 版本化: 自研(印证 dsh-self-evolving journal/object-store)
    └── lib/  (registry/fs-store/hash)
```

依赖方向:`evolution-controller → preset-registry →(评测证据)← d-eval`。评测只读,进化只写,信任域不变。

---

## 2. 同语言:直接改(基座 = dsh-eval-src)

### 2.1 事实对照(已逐文件核验)

| 我们的 lib/ | 上游 src/ | 处理 |
|---|---|---|
| benchmark.js | benchmark.ts (133 行) | **直接改**: schema 解析保持兼容,新增 `split`/`judge.rubricText` 字段 |
| command.js | command.ts (135 行) | **直接改**: 命令面不变 |
| compare.js | compare.ts (210 行) | **直接改** |
| import.js | import.ts (314 行) | **直接改**: zstd/session 导入 |
| index.js | index.ts (119 行) | **直接改** |
| invariant.js | invariant.ts (27 行) | **直接改** |
| judge.js | judge.ts (198 行) | **直接改** —— 逐行同源已核验; `judge.rubric` 文本进 prompt 的钩子已存在, 接 rubric 层(§4) |
| metrics.js | metrics.ts (233 行) | **直接改** |
| report.js | report.ts (127 行) | **直接改** |
| runner.js | runner.ts (373 行) | **直接改**: 保持 temp DSH_HOME 编排; gradeTrial 接 fail-closed(§3.2 吸收) |
| trace.js | trace.ts (130 行) | **直接改** |
| types.js | types.ts (220 行) | **直接改**: 类型面, 增加 rubric 相关字段 |
| — | — | — |
| credential-bridge.js | 无(自研) | 保留 |
| launcher.js | 无(自研) | 保留 |
| model.js | 无(自研) | 保留 |
| settings-bridge.js | 无(自研) | 保留 |

**规则**: 凡上游有对应文件的,我们只做**增量修改**(加字段/加分支/加检查),不动其主体逻辑;
「他那一个模块,重写是浪费精力」——以 judge 为样本:它的 `summarizeTrace/buildJudgePrompt/parseJudgeVerdict/judgeTrial/tryJudgeTrial/llmJudgeChat` 逐行保留,我们只在上面接 rubric 输入。

### 2.2 不动的上游语义(只改不换)

- benchmark.yaml schema(name/model/provider?/profile 默认 headless/command?/trials/timeoutMs/seed/cases/pricing?/judge?/replay?)
- 会话导入 + report 指标表(import/report)
- runner 每 case×trial 全新 temp DSH_HOME + eval.cordis.yml overlay

---

## 3. 不同语言:拆模块 → 按对方架构用 CJS 改写

### 3.1 ZK-Andy/dsh-continual-evolve(src/ 56 文件) — 主要吸收方

| 对方模块 | 对方职责(源) | 吸收方式 | 落点(我们) |
|---|---|---|---|
| `rubric.ts` (139 行) | Rubric ACL:AES-256-GCM 加密,`v1:<iv\|tag\|data>`,key 解析(plugin config → env → baseDir/evolve/rubric.key 自动生成 0600 → dev fallback) | 改写(AES-256-GCM CJS 版) | 新增 `packages/d-eval/lib/rubric.js`(加密/解密/密钥解析) |
| `score.ts` (234 行) | 代码聚合: 模型只产 per-cell 原始分; aggregate() 排除 failed cells 于均值、case 均值 + overall; accept/reject 全在确定性代码 | 改写(逻辑同构) | `packages/evolution-controller/lib/aggregate.js`(新增)+ gate.js 扩展 |
| `evaluate.ts` (15126B) | 评测编排: 对 frozen cases 打分, reference vs candidate 对照 | 改写 | `evolution-controller` evaluate() 接 rubric 输入 |
| `approval.ts` (2112B) | requireGlobalApproval 咨询式 | 不实施, 印证已有(我们强制 approvalId 更严) | — |
| `rollback.ts` (2108B) | 确定性回滚 | 已实现(registry.rollback O(1) 切指针) | 印证 |
| `store.ts`/`state.ts` | 持久化+状态机 | 已实现(registry 目录布局+FSM) | 印证 |
| `logfile.ts` (6824B) | 审计日志 | 已实现(ledger.jsonl append-only WAL) | 印证 |
| `promotion.ts` (5420B) | 提升策略(project-scoped markers、near-duplicate 检测) | **改写吸收**: near-duplicate 语义进 promote 检查 | registry.promote 扩展点 |
| `failures.ts` (6702B) | 聚合失败类 | 改写 | 新 `lib/failure-clusters.js` 或并入 controller |
| `fate.ts`/`wrapup.ts`/`goal.ts`/`review.ts`/`auto.ts`/`inject.ts`/`mount.ts` | 会话内沉淀/审查/注入 | 放弃(对象是记忆/技能, 非 preset) | — |
| `plan.ts`/`planner.ts` | LLM 规划 | 放弃(proposer 协议见 §3.2) | — |
| `skill*.ts`/`pool.ts`/`usage.ts` | 技能/池/用量 | 放弃 | — |
| `command.ts` (18005B) / `tool.ts` (10411B) | 命令与模型工具面 | 改写(命令面映射我们的 CLI) | d-eval command 扩展 `/evolve` 风格命令(可选, P2) |

### 3.2 timwhitez/dsh-self-evolving(packages/ 12 包)— 概念吸收

| 模块 | 对方职责 | 吸收方式 | 落点 |
|---|---|---|---|
| `proposer/` (protocol.ts, process-sandbox.ts, runner.ts) | 失败聚类+提案: 读失败证据→ hypothesis + evidence + preservation tests; W_p=3 不同主 hypothesis; 拒绝 no-change/test-only/comment-only | 改写(协议复刻, 无网络 proposer 简化) | `research/evolution-proposer.mjs` → 最终 `packages/evolution-controller/lib/proposer.js` |
| `budget/ledger.ts` | 预算 ledger: 分 proposal/solver/辅助/failed 计账, 不信候选自报 | 改写 | `packages/evolution-controller/lib/budget.js`(新增) |
| `journal/journal.ts` + `object-store/store.ts` | hash-chain journal + 内容寻址 store | 已实现(registry 内容寻址+WAL) | 印证 |
| `reducer/snapshot.ts` | 崩溃恢复快照 | 已实现(_recover WAL 重放) | 印证 |
| `search/split.ts` | DEV/SEALED 数据切分 | 改写(简化: dev/guard 两级) | `benchmark.yaml` `split` 字段 + runner 用法 |
| `search/scheduler.ts`/`tournament.ts` | UCB-Air/波同步/Thompson | 放弃(单轮驱动不需要) | — |
| `normalized-status`(fail-closed) | 缺失/损坏/超时默认 FAIL, 仅白名单 infra 重试 | 改写 | `runner.js gradeTrial` 分支 |
| `candidate-sdk/`(builder-sandbox, capsule, v011/) | 候选构建沙箱/准入 | 放弃(生成 Cordis 插件代码, 我们进化 preset 内容) | — |
| `sealed-service/`/`loader-e2e/` | 揭盲服务/装载 e2e | 放弃 | — |

### 3.3 lmzhen/dsh-evolution(packages/ 20+)— 主要印证

| 包 | 职责 | 吸收方式 |
|---|---|---|
| `evolution-core`(curator/io/memory-store/skill-store/state-store/threats) | data 域(curator/state)与 control 域分离 | 印证: 我们 registry(data) + controller(control) 已同构 |
| `evolution-approval` / `evolution-policy` | 审批/策略 | 印证(approvalId 强制) |
| `evolution-state*` / `memory*` | 状态域 | 印证 |
| `evolution-review`(redact.ts) | 审查脱敏 | 改写(可选 P2: 失败证据脱敏再入 proposer) |
| 其余(`-activity/-agent/-capability/-feedback/-learning-graph/-replay/-skill-catalog/-tool-*`) | 会话内能力 | 放弃 |

### 3.4 Lhy723/dsh-self-evolution(src 15 文件)— 闭环印证 + 改写

| 模块 | 职责 | 吸收方式 |
|---|---|---|
| `engine.ts` (34865B) | 闭环主循环 | 印证(我们的 controller 闭环已等价) |
| `scoring.ts` (4538B) | 严格更好才接受 | 印证(≈minEffect 门禁) |
| `snapshot.ts` (6256B) | 快照恢复 | 印证(≈rollback) |
| `benchmark.ts`/`candidate.ts`/`profile.ts`/`storage.ts` | 各自 | 印证(对象=Agent Profile, 与我们 evaluate preset 同构) |
| `worker.ts`/`runtime.ts`/`prompts.ts` | 执行面 | 放弃(我们的评测在 d-eval) |

**注意**: Lhy723 的 dist/ 有构建产物, 但对象是 Agent Profile(AGENTS.md+Skills+config), 不是我们 evaluate preset 的三文件结构; 闭环思路采纳, 代码不搬。

---

## 4. rubric 集成(用户定性: Code Gate 太窄, 必须 rubric)

### 4.1 现状
- `gate.js` 只判确定性事实: digest/epoch/gain/回归/canary/holdout —— 答不了「质量好不好」。
- d-eval `judge.js` 的 judge prompt **已支持 `judge.rubric` 文本**钩子(judge.ts:81), 只是我们没用。

### 4.2 两层判定(融合后)

```
评测证据(只读域)
  ├─ 确定性: digest/exitCode/回归/canary/holdout        → gate.js(现状, 保留)
  └─ 质量:   LLM judge 按 rubric 逐 cell 打分           → 新增 rubric 层
                 ↓
聚合(代码): aggregate.js 排除失败 cell, case 均值, overall   (照 score.ts)
                 ↓
gate 新规则: rubricScore < rubricMinScore → FAIL
             rubric 逐维 candidate < baseline → FAIL(回归)
             → 两层都过才 PROMOTED
```

### 4.2 落地清单
1. `packages/d-eval/lib/rubric.js`(新增): encryptRubric/decryptRubric/deriveKey/resolveRubricKey —— 逻辑照 `rubric.ts` 改写(AES-256-GCM + `v1:` 信封 + `<baseDir>/evolve/rubric.key` 0600 自动生成)。
2. `packages/d-eval/lib/types.js`: `BenchmarkJudge` 增 `rubricText`(明文输入)/`rubricCipher`(加密存储)。
3. `packages/d-eval/lib/benchmark.js`: schema 解析 rubric 段(支持 `rubricText` 明文或 `rubricCipher` 加密信封)。
4. `packages/d-eval/lib/judge.js`: 接 rubric 文本进 prompt(钩子已存在, 只需把解密后的 rubric 传进 `buildJudgePrompt`), LLM 产 per-cell `finalAnswerScore` + `hallucination`。
5. `packages/evolution-controller/lib/aggregate.js`(新增): 照 `score.ts` 改写的聚合器。
6. `packages/evolution-controller/lib/gate.js`: `evaluateGate` 增 `rubricScore`/`rubricMinScore`/`rubricRegressions` 入参与判定。
7. `packages/evolution-controller/lib/controller.js`: `evaluate()` 增 `rubric` 透传。
8. 测试: rubric 加密往返、聚合排除 failed、gate rubric 规则(FAIL/INCONCLUSIVE/PASS 三态)。

### 4.3 rubric 数据源(诚实标注)
- rubric 文本初始由人工/评测集提供(`judge.rubricText`); 后续可由失败簇聚类归纳(proposer 产出候选 rubric 片段, 人审后入信)。
- 加密: 评分标准不落盘明文, 模型侧(agent preset)不可见(ACL 语义照搬)。

---

## 5. 实施顺序

| 阶段 | 内容 | 依赖 | 验证 |
|---|---|---|---|
| P0(完成) | rubric 集成 §4: rubric.js + aggregate.js + gate/controller 扩展 | d-eval 基座不动 | 新增单测 + 一轮真实评测(现有 fix-multiply / evaluate-preset benchmark) |
| P1(✅ 2026-08-22) | 评测侧: `split` 字段 + 与 guard 子集 + fail-closed gradeTrial | P0 | benchmark 双集跑通(taskSuccess 1.0 ×2, commit ea58fbc) |
| P2(✅ 2026-08-22) | 进化侧: proposer(失败证据→多假设候选)+ budget ledger + 近重复检测入 promote | P1 | proposal-check 11 测 / budget 6 测 / controller-p2 6 测全绿 + 真实闭环(见下) |
| P3(✅ 2026-08-23) | 治理: 审查脱敏(redact.js, 照 lmzhen redact.ts 改写)+ 进化命令面(bin/dsh-evolve.js 单命令闭环) | P2 | redact 11 测 + controller-redact 2 测全绿; CLI 真实闭环: 无 --approve 拒绝 / 带 --approve promote(evaluate-c4d8aec0) + 审计无凭证残留 |
| P0-2(进行中 2026-08-23) | 可观察 Judge + Overfit 检测 + Frozen Epoch + Registry Archive(任务 feat-08-23-p0-judge-overfit-frozen): judge HTTP fallback(baseUrl/apiKeyEnv 直连, 内嵌 judge 真实执行) / overfit.js 四规则 delta 扫描入 createCandidate / benchmark frozen+materials 语义 digest + 运行中漂移→invalid / exportSnapshot+importSnapshot 自校验 JSON 包 + dsh-evolve --export/--import | P3 | judge/benchmark/model spec + overfit 9 测 + controller-overfit 3 测 + archive 6 测 + runner frozen 3 测全绿; 真实 export/import 139 文件 23 revisions 往返; 真实评测 judge 打分验证(进行中) |

## 6. 明确放弃(不再讨论)

- dsh-self-evolving: Linux 平台(需 Ubuntu+Docker+Bubblewrap)、候选 sandbox/capsule/v011、HGM/UCB-Air/波同步调度、sealed 29-task 揭盲仪式。
- dsh-continual-evolve: 会话内记忆/技能/注入/fate/wrapup/mount/plan 面。
- lmzhen/dsh-evolution: 插件内能力面(20 包中除 core/approval/policy/review 外全部)。
- dsh-skill-evolve/dsh-evolve/dsh-evolve-modes/dsh-continual-harness: 整项。

## 7. 文档归属
- 本文件: 吸收/改造的唯一权威清单(实施前读)。
- reference-absorption.md: 历史分级(🔧/💡/⚙️/✅)与仓库真实性核验记录, 保留为附录。
- 每个被改动的包: 模块头部加 `# absorbed-from: <repo>/<file>` 注释, 便于追溯上游。

## 8. P4(✅ 2026-08-23)自动进化闭环: proposer 生成侧 + 评测集扩充 + 系统 preset 治理
- 前置: P3 之后进化闭环唯一手工环节 = 变异生成(dsh-evolve 无 --candidate 时只追加 marker)。
- 实现:
  - lib/llm-client.js(新): OpenAI 兼容 chat 客户端(凭证 env→~/.dsh/.credentials.yaml, fetch, 零依赖)。
  - lib/proposer.js(新, absorbed-from: dsh-self-evolving specs/03 §9 生成侧): failureEvidence(从 run.json 提取失败 case)→ redact → LLM prompt(PROPOSER_SYSTEM 要求严格 JSON {hypothesis,evidence,mutations,files})→ 输出 {hypothesis,evidence,mutations,candidateFiles}; 非 JSON/空 hypothesis/空 files/LLM 失败 → {ok:false,reason} 拒绝。
  - bin/dsh-evolve.js: 流程重构(baseline 评测先行 → 候选生成(--candidate | --auto proposer | 占位)→ seal → candidate 评测 → gate); 新增 --auto/--proposal-run/--model/--api-key-env; parseArgs 修无值 flag bug(下一 token 以 -- 开头则无值)。
- 评测集: eval/benchmarks/fixtures/rename-me(改函数名, check 验证 tests/run.js 未改 — 防作弊陷阱) + readme-me(写 README, check 要求 multiply/usage/error 术语); refactor-rename-benchmark.yaml(split dev) + readme-write-benchmark.yaml(split guard); 真实跑通均 taskSuccess 1.0(dev 7 步 / guard 5 步)。
- 系统 preset 治理: research/install-system-presets.mjs 初始安装 system-evaluator(system-evaluator-9c24a8c1) + system-evolver(system-evolver-5fac7f0b) 进真实 registry(expectedCurrent:null), 三 logical 指针独立, resolveCurrent/history 正常。
- 真实 --auto 闭环(evidence = run-short.json 历史真实失败): proposer 生成 1 文件变异("Direct task mode + 非零退出重试"), seal evaluate-9682331a, gate INCONCLUSIVE(质量/效率无增益)诚实拒绝, 未 promote —— 生成侧与门槛均按设计工作。
- 测试: proposer 8 测 + 全量 77/77 绿。
