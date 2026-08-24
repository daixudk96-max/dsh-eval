# 9 仓功能级盘点 + 功能全集（DSH 生态）

> 本文件由独立盘点产出：逐仓直接读取 README 全文 + package.json + src 清单，重点仓读核心源码（无子代理）。
> 目的：供委托人对照自研「评测+自进化平台」缺什么。
> 参考 base-selection-review.md / base-selection-review-2.md（前两轮选型评估）补齐功能级清单。

---

## 逐仓功能级清单

### 1. dsh-continual-evolve (v0.4.0, 172 files) — 全部读取

版本化/可审计/可回滚的 harness 状态层，从会话轨迹提炼。

- **命令面（/evolve）**：`list/history/rollback <id>`（local/global 双 store）、`plan`（LLM planner）、`wrapup`（promote/archive/keep）、`archive/unarchive/demote`（注入隐藏、数据可恢复）、`failures`（失败类聚合）、`export/import`（store 备份恢复）、`mount/unmount`（热挂载 skill 为 live 插件）、`goal`（round-driven 自动 review）、`benchmark`（case 生命周期/run/验收）。
- **工具面**：`evolve_list/add/update/delete/rollback`。
- **评测**：代码 owned 评分（`src/score.ts`）——模型只出 per-cell 原始分，聚合与 accept/reject 全在确定性代码；`aggregate()`（passThreshold=60、失败 cell 不计 0、case 全失败报 null）、`decide()`（严格>reference、逐 case 回归≤tolerance、失败 cell≤max）、`flagMaterialDrift`（caseHash 变化→重标记 failed）、`totalDurationMs` 效率维。benchmark 存储（`src/benchmark.ts`）= benchmark.json + statement.md + **AES-256-GCM 加密 rubric.json** + scoreboard.json；case 生命周期 draft→calibrating→frozen；`caseCheckProblems()` 无 LLM 机械校验（statement≥20 字符/rubric 合法 JSON/meta 非空）。
- **治理**：`rollbackRejectedCandidate` 确定性逆编辑回滚（无 LLM 重猜）；`requireGlobalApproval=true` 全局写人工审批；`localFate` 门审计本地条目；`promotionBlockPatterns/promotionMinChars` 提全局守卫；`autoRollbackOnReject`；JSONL 文件日志轮转；rubric 明文永不落盘（optimizer 只见密文）。
- 来源模块：src/ 下 apply/approval/auto/benchmark-command/benchmark/command/evaluate/evolve-event/failures/fate/goal-command/goal/index/inject/llm-text/logfile/mount-command/mount/notify/plan/planner/pool/promotion/render/review/rollback/rubric/score/service/skill-render/skill/skillquality/source/state/store/tool/types/usage/validate/wrapup-command/wrapup。

### 2. dsh-continual-harness (v0.1.6, 94 files) — 全部读取

持续自精炼插件，闭环=持久记忆+周期 review-and-refine+跨会话共享知识+自动回滚（plan→validate→apply→rollback）。灵感源自 prime-agent。

- **核心（ESP 协议）**：`harness_state.json`（四类 entries prompt/memory/skill/subagent，各含 id/kind/version/content/updatedAt）+ `refinements.jsonl`（追加式，按 id 回滚）+ `reviews.jsonl`（门/审计）+ `usage.events.jsonl`（注入遥测）。
- **工具面**：`harness_refine`（plan→apply→rollback，output schema 含 edits[]）、`harness_wrapup`（机械 keep/promote/archive）、`harness_benchmark`（单入口 action：new/add-case/freeze/capture-reference/status/run）。
- **评测**：A/B LLM-judge——固定 frozen cases + pre-refinement reference snapshots + same-round A/B；`validateCandidateDelta` 代码证明 candidate=reference+恰好该 refinement；`score.decideBenchmark` 代码 owned ACCEPTED/REJECTED（不自动回滚）；失败 cell score:null 不计 0；run 追加到 `benchmark/runs.jsonl`。
- **治理**：三道护栏=impact minimization（固定合同校验+一行 reason+maxEntryGrowth）+ legality hard rejects（base_system_prompt/受护 entry 不可变）+ necessity soft gate；`requireGlobalApproval` 默认 false（零审批默认）；审批门只走 plan 路径，rollback 永不需审批。
- **注入**：`agent/pre-step` waterfall digest 去重增量注入 `<harness_state>`；ranked injection（title 优先、per-kind cap=6）。
- **自动驱动**：turn-interval(25)/compaction-end/cooldownMs=1.2M/re-entry guard。
- 来源模块：src/ 下 approval/audit/benchmark/complete/domain/driver/evaluate/invariant/logfile/planner/projection/refine/render/score/skills/storage/store/tool/types/usage/wrapup。

### 3. dsh-eval-src (dsh-eval v0.3.0, 69 files) — 全部读取

纯评测平台（唯一有确定性 check 评测的仓）。

- **CLI 面（dsh eval，commander）**：`run <benchmark.yaml>`（派生无头 dsh 子进程、隔离 DSH_HOME、workspace-write/never-approval、写 JSON 报告）、`report <run.json>`（渲染 markdown）、`compare <a> <b>`（markdown 表+B-A delta+配对统计）、`import codex|claude-code`（导入外部会话日志为一 trial）。
- **评测**：`expected.tool`（子串匹配=toolSelectionAccuracy）、`expected.check`（workspace 内命令 exit0=taskSuccess）**确定性判分**；`judge` LLM-judge 打 finalAnswerScore/hallucination（rubric+maxScore）；pricing→costUsd。
- **指标**：turns/steps/toolCalls/toolResults/toolSuccess(+Rate)/invalidToolCalls/retries/token buckets/totals/llmMs/toolMs/ttftMs/latencyMs/costUsd；pooled grading rates。
- **报告/对比**：JSON run + markdown report + compare 配对统计（win/lose/tie）。
- **Replay（keyless CI）**：replay.dir 记录 trial session log，重跑挂 `@deepseek-ai/dsh-llm-replay` 无密钥重建模型流。
- **依赖**：仅 commander/js-yaml/zod；113 测试。
- 来源模块：packages/eval/src/ 下 benchmark/command/compare/import/index/invariant/judge/metrics/report/runner/trace/types。

### 4. dsh-evolution (v0.1.0-rc.1, 272 files) — 全部读取

Hermes-inspired 自进化插件家族（20+ 子包），**必须跑在 DSH monorepo 内，不可独立**。

- **控制边界**：模型只能写 memory+skills；policy/prompts/routing/approval/state/audit/snapshots 全 control plane。
- **工具面**：`memory`（add/replace/remove/atomic batch，MEMORY.md/USER.md 字符预算）、`skill_manage`（create/edit/update/patch/delete/write_file/remove_file/list；delete=归档非硬删）。
- **后台 review（evolution-review）**：turn/end 信号门→one-shot subagent→plan validator（证据+禁字段+maxOpsPerPlan=32+字符预算+redactReviewSecrets 脱敏）→trusted executor；reviewMode=subagent/inject；review 不向主会话注入 nudge。
- **Curator（evolution-curator）**：确定性 active→stale→archived（30/90 天）+可选 LLM advisory 提名；snapshot 先拍再 archive 可 restore；JSON run report；minIdleHours 门；consolidate/restore 控制面操作；quality_warn。
- **治理**：evolution-approval（stage→approve/reject→audit）、evolution-threat（prompt-injection/exfiltration/secret 扫描，写前 block-any）、evolution-policy（不可变策略+tools.guard 单调门）、evolution-capability（校验 Creator 能力包并 stage，从不自动执行）。
- **可观测**：activity projection、replay/A-B 评分（`scorePlan=acceptedOps*10-rejectedOps*15+evidence*2-char*0.001`）、feedback（quality_score/warn→usage）、learning-graph。
- **存储**：memory/skill-usage/skill-catalog；evolution-io 可切换（本地文件或 storage-domain KV）；evolution-state 可插拔 provider（json fallback）。
- **安装**：install-layered.mjs（oneclick/layered/host）；PROMPT_BUNDLE 版本化+sha256 校验。
- 子包：evolution-host/agent/preset/capability/io/io-node/memory/memory-files/tool-memory/skill-usage/tool-skill-manage/evolution-skill-catalog/evolution-policy/plan-validator/state-storage/state-domain/state-json/evolution-state/approval/threat/review/curator/commands/activity/feedback/replay/learning-graph/dsh-evolution(core)/test-support/scripts。

### 5. dsh-evolve (v0.1.0, 60 files) — 全部读取

agent 会话内按需给自己长出/剪掉能力。

- **工具面**：`evolve_add(name, source, description?, config?)`（把纯 ESM cordis 插件源码落盘 `~/.dsh/evolve/*.mjs`+manifest 并热挂载，下个 step 工具即可见；同名调用即替换，旧 fiber 先卸载）、`evolve_remove`（可逆卸载+删源码，keepSource 可选）、`evolve_list`（名称/fiber 状态/rev/用途）。
- **进化形态**：完整 cordis 插件——不限于工具，可注册 prompt section（常驻规则）、`agent/pre-step` 钩子（自纠）、`agent/turn-stopping`/settled 监听（事后自动化）、定时器+agent.send 唤醒（主动触发）；mount 即生效、dispose 即净。
- **持久化**：重启 autoRestore 重挂 manifest；进程内单调 seq 作 cache-buster（与 rev 解耦）；无沙箱（真实模块加载，与主 harness 同权限）。
- **配置**：dir、autoRestore=true。无评测无治理。
- 来源模块：src/ 下 index.ts / store.ts。

### 6. dsh-evolve-modes (v0.3.1, 74 files) — 全部读取

Web 工作流/自进化控制插件（输入区四维控件）。

- **四维工作决策**：工作状态（正常/计划，复用官方 planMode）、思考策略（标准/第一性原理→写 request/header.system）、质量门禁（关/对抗性审查/验收审查→独立审查 Agent，报告固定 Met/Gap/Unverified/Evidence/Concrete follow-up）、自进化（关/开=Propose）。
- **自进化**：学习批次=3（每累计 3 次父回复启动一次隔离学习）、隔离学习请求（专属 persona、不继承父历史/工具/不加载 AGENTS.md、只分析长期身份/偏好/要求、证据必须逐字来自用户消息）、待审阅提议上限=100；提议必须人工确认（应用/忽略）；手工增删改全局规则；从变更前自动备份恢复。
- **命令面**：`/evolve-mode` + 各维度子命令（working/reasoning/quality/evolution、review <turn>、reviews、batch-size、max-pending-proposals）。
- **平台**：Web client UI（React slots）+ storage domain 持久化；质量审查走 fork/subagent；自进化走 llm service；计划走官方 planMode；工具策略经 tools/pre-execute pipeline（非 OS sandbox）。无版本化无评测。
- 来源模块：src/ 下 index/prompt/remote/storage/typert/types + client/index.tsx + evolution/{learning,messages,prompt,schema,service,store,wire}。

### 7. dsh-self-evolution (v0.1.1, 134 files) — 全部读取

基准驱动自我进化插件（唯一同时含评测+进化闭环）。

- **工具面**：`evolution_run`（完整闭环：基线→候选生成→评测→严格接受或回滚）、`evolution_evaluate`（只评测不改动，追加 durable reference）、`evolution_status`（版本/哈希/漂移/快照）、`evolution_rollback`（恢复到已验证版本快照）。
- **评测**：frozen Benchmark（frozen:true + digest）+ Case×Run 矩阵 + Target/Evaluator/Optimizer 三类隔离子代理（Evaluator 只见私有 rubric、Optimizer 只见公开证据+`{allow:[]}` 全工具隔离）；**LLM-judge** 打分。
- **治理**：严格接受规则（`candidate.score > reference.score + minImprovement`，`>=` 不用、平分回滚）；快照验证；`assertCandidateNotBenchmarkSpecific` overfit 检测（digest/statement 复制/私有 rubric 污染/case_id 嵌入→BENCHMARK_OVERFIT/CONTAMINATION）；候选文件白名单+路径穿越+符号链接防护；单 profile 互斥锁+外部改动检测（漂移拒绝覆盖回滚）；partial 回滚冲突检测；单调版本号（拒绝后不复用）；默认禁改 provider/model。
- **对象**：Agent Profile（AGENTS.md+skills+config+runtime.json，版本化）；状态根 `~/.dsh/self-evolution/profiles/<hash>/`（snapshots/v1、v2…+scoreboards+runs）。
- **配置**：stateRoot/subagentProvider/maxParallelEvaluations=4/minImprovement/maxCandidateOperations=12/maxCandidateBytes=262144/各 retries/lockStaleMs/allowModelRouteMutation/managedFiles/requiredFiles/toolPrefix/maxDepth。无人工审批门（自接受）。
- 来源模块：src/ 下 benchmark/candidate/config/engine/index/invariant/profile/prompts/runtime/scoring/snapshot/storage/types/util/worker。

### 8. dsh-self-evolving (v0.2.0, 355 files) — 全部读取

规格驱动、可崩溃恢复的 RSI（递归自改进）引擎；**平台致命：Ubuntu/Docker/Python+Bubblewrap/Harbor/Terminal-Bench，Windows 不可用**。

- **核心**：content-addressed object store + hash-chain journal + 纯 state reducer+snapshot + action saga + 预算双式记账 ledger（budget/ledger.ts）；文件系统为真源、索引可重建；崩溃恢复（crash-replay、process-crash-resume）。
- **搜索算法（spec 03）**：clade Thompson sampling 选 parent + node Thompson 选候选 + **UCB-Air** expand-vs-evaluate + cold-start q0 + 确定性 RNG 流（resume 不重采样）。
- **评测**：Harbor ACP runner 跑 Terminal-Bench 2.1；dev-observed/dev-guard/sealed 三层 split 分离（sealed task 在候选哈希冻结前不入 proposer/selector/archive）；正式/开发/晋升四态分离。
- **候选流水线**：candidate-sdk（sandboxed builder、canonical-tar identity、policy-scan）、v011 proposal 协议（candidate-intent/capability-catalog/evidence-citation/materialization-receipt/recovery）、proposal sandbox（隔离进程一次性启动，node:vm 非安全边界）；候选只能改自己声明的 package，TCB（adapter/verifier/split/scorer/controller/budget/policy）候选不可写。
- **CLI 面（dsh-self-evolving）**：`init/run/resume/status/audit/doctor`（+audit 验收/doctor 预检/崩溃注入测试）。
- **治理**：provenance.lock、check-provenance、upstream-clean、byte-equal、release 门、sealed-service；specs/00-07 契约。
- 子包：dsh-self-evolving（core controller/service）、dsh-self-evolving-cli、candidate-sdk、dsh-self-evolving-proposer、dsh-self-evolving-search、dsh-self-evolving-pilot、dsh-self-evolving-sealed-service、dsh-self-evolving-llm-responses、dsh-self-evolving-loader-e2e、benchmark-adapters/terminal-bench。

### 9. dsh-skill-evolve (v0.1.0, 39 files) — 全部读取

最小技能提炼插件。

- **工具面**：`extract_skill(sessionPath, skillName, description)`（从 session JSONL 提炼为 skill markdown）、`list_learned_skills`。
- **提炼**：`extractor.ts` 从会话事件流识别 user/message→taskDescription、tool/call→步骤序列（参数值泛化为 `<url>/<path>/<number>/<long_text>` 占位符、inferPurpose 推断目的、按 tool+argsPattern 去重）；turn/end completed→success。
- **生成**：`generator.ts` 产出 SKILL.md（触发条件/执行步骤/使用工具/统计/注意事项）；skillsDir、minSteps=3 配置。
- 无评测、无版本化、无回滚；README 建议配合 dsh-session-analyst/dsh-agent-eval。
- 来源模块：src/ 下 config/extractor/generator/index/session。

---

## 功能全集（9 仓并集）

### A. Benchmark 能力
- **YAML/JSON benchmark 定义**：`benchmark.yaml`（dsh-eval-src）、`benchmark.json`（self-evolution、continual-evolve）、`benchmark.json`+public/private 分目录（self-evolution）
- **frozen 冻结基准**：`frozen:true`+内容 digest（self-evolution）；frozen case 材料不可变+hash（continual-harness）；case 生命周期 draft→calibrating→frozen（continual-evolve）
- **确定性 check 判分**：`expected.check`（exit0=taskSuccess）+`expected.tool`（子串=toolSelectionAccuracy）（**仅 dsh-eval-src**）
- **LLM-judge rubric 判分**：rubric 打业务分（dsh-eval-src judge、self-evolution Evaluator、continual-evolve、continual-harness）
- **A/B 同轮对比**：reference vs candidate 同 cases/runs/model，candidate-delta 代码证明（continual-harness）
- **A/B 评分公式**：scorePlan=acceptedOps*10-rejectedOps*15+evidence*2-char*0.001（evolution replay）
- **外部基准适配**：Terminal-Bench 2.1 经 Harbor ACP runner（self-evolving）；导入外部会话日志为 trial（dsh-eval-src import）
- **rubric 加密**：AES-256-GCM 落盘加密，明文只在 runner 子 prompt（continual-evolve）
- **case 标定**：CaseMeta capability/distinguisher/shortcuts/calibrationHistory（continual-evolve）
- **无 LLM 机械校验**：statement≥20 字符/rubric 合法 JSON/meta 非空（continual-evolve caseCheckProblems）

### B. 评测指标
- **会话指标**：turns/steps/toolCalls/toolResults/toolSuccess(+Rate)/invalidToolCalls/retries（dsh-eval-src）
- **成本指标**：token buckets/totals/billed context/costUsd/pricing（dsh-eval-src）
- **性能指标**：llmMs/toolMs/ttftMs/latencyMs/totalDurationMs（dsh-eval-src、continual-evolve C3）
- **任务判分**：taskSuccess/toolSelectionAccuracy（dsh-eval-src）；finalAnswerScore/hallucination（dsh-eval-src judge）
- **加权聚合**：case weight 加权均值、pooled grading rates（dsh-eval-src、self-evolution）
- **失败 cell 协议**：失败不计 0、单独计数、超阈值拒绝（continual-evolve、continual-harness、self-evolution INCOMPLETE）
- **质量反馈**：feedback positive/negative→quality_score/quality_warn（evolution-feedback）

### C. 报告/对比/导入
- **JSON run 报告**（dsh-eval-src run、self-evolution run.json、curator JSON report）
- **markdown report/compare**：report+compare 表+B-A delta+配对统计（dsh-eval-src）；decisionReport 逐 case before→after delta（continual-evolve）
- **会话导入**：codex/claude-code session.jsonl→run（dsh-eval-src）
- **status**：版本/哈希/漂移/快照（self-evolution evolution_status、self-evolving CLI status）

### D. 判分方式
- **确定性 code gate**（回归/失败 cell/效率/篡改）（continual-evolve、continual-harness、dsh-eval-src expected.check）
- **LLM-judge**（业务 rubric 分）（dsh-eval-src、self-evolution、continual-evolve、continual-harness、evolution-replay）
- **两层结合**：确定性安全网+LLM 业务层（continual-evolve、dsh-eval-src）
- **严格接受规则**：>reference+minImprovement、平分回滚（self-evolution、continual-evolve）

### E. 候选生成
- **LLM optimizer 子代理生成候选**（self-evolution Optimizer、continual-evolve planner、self-evolving proposer）
- **隔离优化器**：`{allow:[]}` 全工具隔离+受限文件操作（self-evolution）；sandboxed builder+policy-scan（self-evolving）
- **后台 review 自动提炼**：turn-interval/compaction/round 门（continual-harness、continual-evolve、evolution-review）
- **会话提炼**：session.jsonl→skill markdown（dsh-skill-evolve）
- **现场写码热挂载**：agent 自己写 cordis 插件源码（dsh-evolve）

### F. 版本/快照
- **不可变版本封存**：sha256 digest+monotonic version、拒绝后不复用（self-evolution）；revisions 内容寻址
- **快照**：pre-refinement reference snapshot（continual-harness）；pre-curator/pre-consolidate/pre-restore snapshot（evolution-curator）；snapshots/v1,v2（self-evolution）；snapshot 验证（self-evolution）
- **hash-chain journal**：内容寻址 object store+纯 reducer+snapshot（self-evolving）
- **store 备份/恢复**：export/import（continual-evolve）

### G. 门禁（回归/效率/质量/篡改）
- **非回归接受**：overall 严格>、逐 case 回归≤tolerance（continual-evolve、continual-harness、self-evolution）
- **失败 cell 上限**（continual-evolve、continual-harness）
- **材料漂移检测**：caseHash 变化→failed（continual-evolve）；Benchmark digest 变化→整轮失败（self-evolution）
- **效率门**：totalDurationMs 维度（continual-evolve）
- **overfit/污染检测**：digest/statement/private rubric/case_id 嵌入（self-evolution assertCandidateNotBenchmarkSpecific）
- **growth/预算**：maxEntryGrowth（continual-harness）；maxCandidateOperations/Bytes（self-evolution）；预算双式记账 ledger（self-evolving）；字符预算（evolution memory/skill）
- **promotion 守卫**：promotionBlockPatterns/promotionMinChars/近重复检测（continual-evolve）
- **工具策略门**：tools/pre-execute pipeline（dsh-evolve-modes）

### H. 审批
- **人工审批**：requireGlobalApproval（continual-evolve=true、continual-harness=false 默认）；审批门只走 plan 路径
- **staged 审批**：后台写 stage→approve/reject→audit（evolution-approval）
- **提议人工确认**：应用/忽略/备份恢复（dsh-evolve-modes）；promote 强制 approvalId
- **自接受无审批**（self-evolution，生态缺陷）

### I. 回滚
- **确定性逆编辑回滚**：从 applied 重建逆编辑，无 LLM 重猜（continual-evolve rollbackRejectedCandidate）；autoRollbackOnReject（continual-evolve）
- **按 id 回滚**：refinements.jsonl/rollback <id>（continual-harness、continual-evolve）
- **verified rollback**：快照验证+partial 回滚冲突检测（self-evolution）
- **版本回滚**：evolution_rollback/restore latest snapshot（self-evolution、evolution-curator restore）
- **可逆卸载**：fiber dispose 净、keepSource（dsh-evolve）
- **benchmark 不自动回滚**（continual-harness 明确 auto_rollback:false）；拒绝后确定性回滚（continual-evolve）

### J. 审计/崩溃恢复
- **审计日志**：reviews.jsonl、refinements.jsonl、events.jsonl、usage.events.jsonl（continual-harness）；JSONL 文件日志轮转（continual-evolve）
- **运行事件日志**：每轮 decision 可复盘+独立 session id（self-evolution、self-evolving events.jsonl）
- **崩溃恢复**：hash-chain journal+action saga+crash-replay+process-crash-resume（self-evolving）；单 profile 互斥锁+lockStaleMs（self-evolution）
- **provenance**：provenance.lock、upstream-clean、byte-equal（self-evolving）
- **drift 外部改动检测**：digest 漂移拒绝覆盖（self-evolution）

### K. 内容/记忆对象
- **harness state 四类**：prompt/memory/skill/subagent spec（continual-harness、continual-evolve）
- **memory 文件**：MEMORY.md/USER.md 字符预算+dedup+drift 守卫（evolution、dsh-evolve-modes）
- **Agent Profile 版本化**：AGENTS.md+skills+config+runtime.json（self-evolution）
- **skill 沉淀**：SKILL.md 实体化+provenance（continual-harness、continual-evolve、evolution-skill-catalog）；skill markdown 提炼（dsh-skill-evolve）
- **skill 生命周期**：active→stale→archived+consolidate+restore（evolution-curator）；pinned 受护不可删
- **skill 目录注册**：ctx.skills 注册+立即失效（evolution-skill-catalog）
- **热挂载**：skill→live 插件（continual-evolve mount）；cordis 插件源码热挂载（dsh-evolve）
- **注入形态**：prompt notes 内容注入（≤6/kind×180 字符）；memories/skills 目录索引（≤15 行 fold）；空 store 零 token（continual-evolve、continual-harness ranked injection）

### L. 命令面（汇总）
- `/evolve`（list/history/rollback/plan/wrapup/archive/demote/failures/export/import/mount/goal/benchmark）（continual-evolve）
- `/evolution`（pending/approve/reject/curator run/report/restore/consolidate/skill restore/replay）（dsh-evolution）
- `/evolve-mode`（working/reasoning/quality/evolution/review 子命令）（dsh-evolve-modes）
- `dsh eval`（run/report/compare/import）（dsh-eval-src）
- `dsh-self-evolving`（init/run/resume/status/audit/doctor）（self-evolving）
- 模型工具：evolve_*（continual-evolve）、harness_*（continual-harness）、evolution_run/evaluate/status/rollback（self-evolution）、evolve_add/remove/list（dsh-evolve）、extract_skill/list_learned_skills（dsh-skill-evolve）、memory/skill_manage（dsh-evolution）

### M. 平台/集成
- **独立 npm+bundle**：cordis.patch.yml+dsh.bundle（continual-evolve、continual-harness、self-evolution、dsh-evolve、dsh-evolve-modes、dsh-skill-evolve）
- **monorepo 绑定**：必须跑在 DSH monorepo 内（dsh-evolution、self-evolving）
- **平台致命绑定**：Ubuntu/Docker/Python+Bubblewrap/Harbor/Terminal-Bench（self-evolving，Windows 不可用）
- **keyless replay**：@deepseek-ai/dsh-llm-replay 无密钥 CI（dsh-eval-src）
- **Web client UI**：React slots+storage domain（dsh-evolve-modes）
- **IO/state 可插拔**：本地文件或 storage-domain KV（dsh-evolution）
- **Anchored Standard 兼容**：工具隐藏直到 dev_tool_search 解锁（dsh-evolution）

---

## 对照自研平台的关键提示

- 确定性 check 评测**仅 dsh-eval-src**；确定性代码门（非回归/失败 cell/效率/材料漂移）+ 加密 rubric + 人工审批 + 确定性逆编辑回滚**最成熟在 dsh-continual-evolve**；快照/版本/overfit/回滚闭环**最完整在 dsh-self-evolution**。
- 全集里 self-evolving（RSI/哈希链 journal/预算账本/UCB-Air/崩溃恢复）与 dsh-evolution（curator/威胁扫描/feedback/learning-graph）代表了前两轮报告未细化的进化治理功能点，可对照补齐。
- LLM-judge vs 确定性 code gate 是两层：确定性 gate=安全网（回归/失败 cell/效率/篡改），LLM-judge=业务指标层（rubric 打业务分）。
