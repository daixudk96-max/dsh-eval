# LLM Space 评测/调试机制对照评估

> 调研对象: deer-flow/llm-space(浅克隆于 `research/llm-space/`, 897 文件, bun workspace monorepo)
> 调研日期: 2026-08-23
> 问题: 用户贴出 LLM Space 的 Build→Trace→Debug→Evaluate 工作台(版本化 Prompt/System Prompt/Tools/模型参数、保存完整 Thread 状态、Restore Run/Compare Runs/Evaluation), 问「看看我们的评测引擎这块能不能实现」。

## 1. LLM Space 的评测机制(源码级事实)

### 1.1 Run History —— 调试时间线(快照 + 侧车文件)

- `packages/core/src/types/threads/thread.ts:179` `ThreadSnapshot = Type.Object(THREAD_FIELDS)` — THREAD_FIELDS 含 `title/model/context`(context 含 messages/tools), **显式排除 runHistory/evaluations**(防递归持久化)。
- `thread.ts:185-210` `ThreadRunSnapshot = { id?, thread: ThreadSnapshot, usage?: ModelUsage, timestamp }` — 一次完成 run 的完整线程状态。
- `thread.ts:221-229` `ThreadRunReference = { id, timestamp, usage?, thread: never, snapshotRef, preview: {summary, modelLabel, messageCountLabel} }` — 轻量索引, 完整快照在侧车文件。
- `packages/core/src/thread/history.ts:82-94` `snapshotThread(thread)` 去嵌套只留 `{title, model, context}`。
- 持久化(AGENTS.md): `~/.llm-space/history/<sha256(workspace-relative path)>/` 每 run 一个 JSON 文件, 按 `snapshotRef` 引用; thread 文件里只留 `runHistoryIndex`(ThreadRunReference 数组)。旧格式 `runHistory` 内联, `normalizeRunHistory` 迁移。
- `history.ts:97-99` `_fallbackRunId = run-${Math.trunc(timestamp)}-${index}`(旧文件回填确定性 ID)。

### 1.2 Restore Run —— 整线程快照恢复

- **core 层无 restoreRun/continueFrom/resumeFrom 实现**(grep 全仓仅 converters.ts:80 注释提及 replay)。恢复 = UI/desktop 层把 `snapshot.thread` 设为当前 thread 继续跑。
- **不是 LangGraph 节点级 fork**(用户记忆的「A→B→C→D→E 改 C 从 C 重跑」= LangGraph Time Travel 概念, LLM Space 未实现)。

### 1.3 Evaluation —— 人工 rubric 打分 + A/B 对比

- `thread.ts:242-252` `ThreadEvaluationRubric = { id, name, criteria[2..6], revision, createdAt, updatedAt }` — 可复用 rubric, 每线程最多 20 个(`history.ts:31` MAX_EVALUATION_RUBRICS)。
- `thread.ts:256-267` `ThreadEvaluationRubricSnapshot` — 不可变副本(id/name/criteria/revision), 存进评测记录。
- `thread.ts:270-276` `ThreadEvaluationCriterionScore = { criterionId, score: 1..5 }` — 单 criterion 整数分。
- `thread.ts:279-288` `ThreadEvaluationRunScores = { runId, scores[2..6] }` — 一个 run 的完整打分。
- `thread.ts:290-297` `ThreadEvaluationVerdict = leftBetter | rightBetter | tie | pass | fail`。
- `thread.ts:345-363` `ThreadStructuredEvaluation = { id, leftRunId, rightRunId, verdict, note?, createdAt, updatedAt, rubric: Snapshot, runScores[2..2] }` — **恰好两个 run 的 A/B 对比**; legacy 形态只有 verdict。
- `history.ts:28` MAX_EVALUATIONS = 50(每线程)。
- `packages/core/src/thread/run-evaluation-utils.ts`(242 行): `averageScoreForRun` / `evaluationScoreDelta(right-left)` / `flipEvaluationVerdict` / `isSameRunPair` / `findEvaluationForPair` / `scoreDraftFromEvaluation` / `reconcileScoreDraft` / `scoreDraftForRubricChange` / `completeRunScores` / `initialRubricForEvaluation` / `preferredEvaluationRubricId` / `requiresScoreRemovalConfirmation`。
- `packages/core/src/thread/run-history-utils.ts`(159 行): `summarizeRun`(最后消息摘要) / `runModelLabel` / `runMessageCountLabel` / `createRunPreview` / `runEntrySummary` / `runLastUserText` / `runResultText`(assistant 最后消息 + tool 输出)。

## 2. 我们的评测引擎对照(现状)

| 能力 | LLM Space | 我们(dsh-eval + evolution-controller) | 差距 |
|---|---|---|---|
| 评测方式 | 人工 rubric(1-5 分, 2-6 criterion)+ A/B verdict | 确定性 check 脚本 + LLM judge rubric(finalAnswerScore)+ gate 两层判定 | 我们自动化更强; 无人工 A/B 评分 UI |
| run 快照 | ThreadSnapshot 完整状态 + 侧车文件 + 轻量索引 | run.json 含 tracePath → session.jsonl(完整事件日志) | 快照引用已有; 无「恢复继续跑」入口 |
| 对比 | Compare Runs UI(左/右 run) | `compare --delta` CLI(逐 case before→after 表) | CLI 已有; 无 GUI |
| 评测记录持久化 | evaluations[] 每线程 ≤50, rubric 快照不可变 | 审计 ledger(append-only)+ registry 版本化 | 我们审计更强; 无结构化 rubric 管理 |
| 恢复继续跑 | 整线程快照恢复(UI 层) | runner 每次全新 temp DSH_HOME; 但 DSH session.jsonl 原生可恢复 | **可实现** |
| 节点级 fork | 未实现(那是 LangGraph Time Travel) | 未实现 | 双方都没有; 非评测引擎职责 |

## 3. 可实现性结论

1. **run 级快照恢复继续跑 —— 可实现, 且 DSH 原生支持**。DSH 的 session-persistence-jsonl 把会话存为 session.jsonl(事件流), 恢复 = 把快照 session.jsonl 放进新 DSH_HOME 继续跑。我们的 runner 已产出 tracePath; 加一个 `--resume <run.json> --from <caseId>` 或 import 侧命令即可。工作量: 小(1-2 人日)。
2. **人工 A/B 评分 UI —— 可实现**。compare --delta 已有数据面; WebUI 控制台(packages/dsh-eval-console, 已安装)有看板/时间线基础; 加「对比视图 + 1-5 分 rubric 打分 + verdict」即可。工作量: 中(2-3 人日)。
3. **结构化 rubric 管理(2-6 criterion, 1-5 分, revision, 可复用)—— 可实现**。我们 rubric 目前是 LLM judge 用的自由文本(明文/加密); 加 criterion 结构 + 人工打分存储(审计或 registry)即可。工作量: 小-中。
4. **节点级 fork(改 C 从 C 重跑)—— LLM Space 自己也没有**。DSH 层面 session.jsonl 是事件流, 理论上可截断到某条消息后继续, 但那是 DSH 会话能力, 不是评测引擎职责。**不建议做**。

## 4. 建议

- 若用户要「评测工作台」体验: 优先做 1(run 恢复继续跑, 复用 DSH 原生能力)+ 2(WebUI 对比视图)。
- 人工 rubric 打分可作为 WebUI 控制台的扩展(与 LLM judge 打分并存, 人工分进审计)。
- 不引入 LLM Space 代码(它是 Electrobun 桌面 app + bun workspace, 与我们的 Cordis 插件架构不同); 只借鉴数据模型(ThreadRunSnapshot/EvaluationRecord 形态)。
