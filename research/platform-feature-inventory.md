# 自研平台功能清单(对照功能全集的「已有」侧)

> 盘点对象: E:\github\dsh-eval 当前 HEAD(a2df77a)。用于与 9 仓生态功能全集做差集。
> 对应文档: research/base-selection-review.md / base-selection-review-2.md(选型)、
> research/feature-union-gap.md(全集+差距, 待 subagent 9 仓清单回来后合并)。

## 1. packages/dsh-eval(评测 CLI 插件, TS→ESM, vitest)

- **CLI 命令面**(lib/command.js + lib/index.js): `run <benchmark.yaml> --out <run.json> [--split dev|guard]`、
  `report <run.json> → markdown 指标表+中文总结`、`compare <a>.json <b>.json → markdown 对比表`、
  `import dsh <session.jsonl.zstd> --out <out>.json --case-id <id>`(导入已有会话日志评测)。
- **Benchmark schema**(lib/benchmark.js, js-yaml+zod 解析): name/model/provider?/reasoningEffort?/profile 默认
  headless/command?(覆盖 child 启动)/trials 默认1/timeoutMs 默认600000/seed 默认0/cases[{id,
  prompt|promptFile, workspace?, expected{tool?, check?}, split?}]/pricing?/judge?{provider?, model?,
  rubric?|rubricText?|rubricCipher?, maxScore?}/replay?。`cases[].split` = dev|guard 默认 dev,
  `--split` 过滤, 空子集报错。
- **Runner**(lib/runner.js): 每 case×trial 全新 temp DSH_HOME + settings.yaml(agent-default-model)+
  eval overlay(session-persistence-jsonl/sandbox workspace-write/approval never/permission defaultPreset eval)+
  spawn `dsh --profile <profile> --patch <overlay> <prompt>`; fail-closed: 无 session log→status
  error('no session log found; dsh {status}: {tail}'), 坏 trace/超时→status failed(+timedOut:true),
  INFRA_RETRYABLE=[RATE_LIMITED, OVERLOADED, CONNECTION_RESET] 重试 ≤3 次(attempt 后缀 -r<n> 目录);
  metrics: turns/steps/toolCalls/toolResults/toolSuccess/toolSuccessRate/invalidToolCalls/retries/tokens
  (input/cacheRead/cacheWrite/output)/contextTokens/llmMs/toolMs/ttftMs/latencyMs/costUsd;
  grading: taskSuccess + toolSelectionAccuracy; judge: tryJudgeTrial(LLM judge 按 rubric 打
  finalAnswerScore, verdict null 时跳过)。
- **Judge**(lib/judge.js): buildJudgePrompt(caseValue, trace, judge) system += ['Rubric:', judge.rubric]
  (rubric 钩子已存在); parseJudgeVerdict(text, maxScore); 165 行 ESM。
- **Rubric 加密**(src/rubric.ts → lib/rubric.js, absorbed-from ZK-Andy/dsh-continual-evolve/src/rubric.ts):
  AES-256-GCM 信封 `v1:<b64url(iv)>|<b64url(tag)>|<b64url(data)>`, key=sha256(passphrase);
  resolveRubricKey 4 级: configKey → env DSH_EVOLVE_RUBRIC_KEY → baseDir/evolve/rubric.key(0600 自动生成)
  → dev key(warn); 明文透传; 篡改 fail-loud。
- **辅助模块**: credential-bridge(apiKeyEnv→credentials.resolve 注入 child env)、launcher、model、
  settings-bridge(buildChildSettings 子树提取)、metrics、trace(loadTrace/mergeTraces)、invariant、
  types。

## 2. packages/evolution-controller(进化治理核心, CJS, node:test)

- **状态机**(lib/state-machine.js): DRAFT→SEALED→EVALUATING→ACCEPTED→PROMOTED; EVALUATING↘REJECTED |
  INCONCLUSIVE(→EVALUATING) | INVALID; REJECTED/PROMOTED/INVALID 终态。
- **Controller**(lib/controller.js, 230 行): newRun({source, triggerEvaluationRunId,
  selectedFailureClusters})→预算检查(budget.remaining()>0 否则 throw 'evolution budget exhausted');
  createCandidate(runId, {logicalId, sourceRevisionId, hypothesis, evidence, mutations,
  readCandidateFiles})→proposal-check 前置(失败 audit 'proposal-rejected' + throw, 候选留 staging);
  seal(runId)→registry.sealRevision; evaluate(runId, {baseline, candidate, gateOverrides, rubric})→
  PASS→ACCEPTED/INCONCLUSIVE/INVALID/FAIL→REJECTED + audit 'gate'(带 rubric 证据);
  promote(runId, {logicalId, approvalId, nearDuplicateCheck=true})— 仅 ACCEPTED + approvalId 必填
  ('approvalId is required (user confirmation binding)'), 近重复检查(命中 audit 'promote-near-duplicate'
  + throw), 自动 resolveCurrent 做 expectedCurrent; resample(INCONCLUSIVE→EVALUATING); _audit 走
  appendLedger(auditDir, {op:'audit', ts, ...}); redactValues 构造参数(hypothesis/evidence 先脱敏)。
- **Code Gate**(lib/gate.js): 判定顺序 = !digestOk→INVALID; !epochSame→INVALID; 质量回归
  (correctness/safety/verification 任一 candidate<baseline)→FAIL; 效率回归(steps 有输入且
  candidate.steps>baseline.steps)→FAIL; gain<=minEffect 且 efficiencyGain<minEffect→INCONCLUSIVE;
  !criticalAssertionsPassed→FAIL; criticalFailures>0→FAIL; perCaseRegression>tolerance→FAIL;
  canary.passed===false→FAIL; holdout.passed===false→FAIL; rubricScore<rubricMinScore→FAIL;
  rubricRegressions→FAIL; 否则 PASS。返回值带 gain/efficiencyGain/rubricScore 证据。
- **Proposal-check**(lib/proposal-check.js, absorbed-from dsh-self-evolving specs/03 §9):
  normalizeText(去 BOM/逐行 trim/剔空行/只删 YAML 注释 ^#(?:\s|$), 保留 ## 标题)/normalizeFiles;
  isTestOnly(/test|spec|tests?/ 路径); isCommentOnlyMutation; 规则: 结构缺失(缺 hypothesis/evidence/
  mutation)、候选内容为空、no-change(归一化同 source)、test-only、comment-only、假设上限
  MAX_HYPOTHESES=3、重复假设、语义去重(内容 sha256 同已有候选)。
- **Budget**(lib/budget.js): BudgetLedger({dir, limitUsd}); BUCKETS=[proposal, attempt, failed];
  spend(bucket, amountUsd, meta) appendFile 一行 JSON; entries/spent/remaining(limit-total 或
  Infinity)/canAfford。
- **Near-dup**(lib/near-dup.js): contentHash(files)=sha256(各文件 normalizeText join '\n');
  nearDuplicate(history, readRevision, candidateFiles)→{isDup, of}(逐历史 digest 比较)。
- **Redact**(lib/redact.js, absorbed-from lmzhen/dsh-evolution/packages/evolution-review/src/redact.ts):
  redactSecrets(8 形状: sk-/AKIA/gh[pousr]_/glpat-/xox[baprs]-/jwt/Bearer/inline assignment, 保留键名
  <redacted>)/redactSessionIds(session-[0-9a-f]{32})/redactPaths(盘符/UNC/POSIX/~)/redactCredentials
  (值长≥4)/redactReviewText(顺序: credentials→secrets→sessionIds→paths)。
- **Aggregate**(lib/aggregate.js, absorbed-from ZK-Andy/dsh-continual-evolve/src/score.ts):
  aggregate(cells)→{overall(失败 cell 排除均值, 全失败 null), perCase, failed, total,
  totalDurationMs}; decide(严格提升 + 失败 cell 协议 + 逐 case 回归); flagMaterialDrift(caseHash
  漂移→重标 failed); decisionReport。
- **Proposer**(lib/proposer.js, absorbed-from dsh-self-evolving specs/03 §9): failureEvidence(runJson)→
  失败 case 摘要; parseJsonLoose; propose({runJson, baselineFiles, logicalId, llm, redactValues})→
  {hypothesis, evidence, mutations, candidateFiles}|{ok:false, reason}; 无失败 case→拒绝; LLM 失败/
  非 JSON/空 hypothesis|files→拒绝; evidence 先 redact。
- **LLM client**(lib/llm-client.js): resolveApiKey(env→~/.dsh/.credentials.yaml 正则逐行);
  createChatClient({baseUrl 默认 http://127.0.0.1:8317/v1, apiKeyEnv 默认 CLIPA_API_KEY, model 默认
  deepseek-v4-flash, timeoutMs 120000})→complete(system, user) fetch+AbortSignal.timeout, temperature 0。
- **CLI**(bin/dsh-evolve.js, 零依赖 CJS): `node bin/dsh-evolve.js --key value`; 闭环 = baseline 评测
  先行(spawn `dsh --profile eval run` 子进程, 只读域边界)→ 候选生成(--candidate 目录 | --auto 调
  proposer + proposal.json | 缺省 README marker)→ newRun/createCandidate(变量化 hypothesis/evidence/
  mutations)/seal → candidate 评测 → evaluate(gateOverrides minEffect 默认 0.05)→ ACCEPTED +
  --approve <id> 才 promote, 否则 exit 1; 产物 out/baseline.json+candidate.json+gate.json+result.json;
  evalEvidence(run.json): overall=correctness=taskSuccessRate, verification=toolSelectionAccuracyRate,
  safety=1, steps=aggregate.steps??case0.metrics.steps, failed/total; 参数面(实测): --auto/--approve/
  --benchmark/--candidate/--dsh/--key/--logical/--min(-effect)/--model/--out/--profile/--proposal/
  --registry/--split/--api(-key-env?)/--help。

## 3. packages/preset-registry(版本化存储, CJS, node:test)

- Registry({root, agentPresets, rollbackWindow=3}), 布局 logical/revisions/<digest>/
  pointers/<logicalId>.current.json/staging/<candidateId>/ledger/ledger.jsonl。
- resolveCurrent(logicalId)→{logicalId, revisionId, digest, gateRunId, approvalId, resolved};
  createCandidate(logicalId, {sourceRevisionId, evolutionRunId})→candidateId='cand-'+sha256(16 hex);
  patchCandidate 仅 DRAFT; sealRevision(candidateId)→{revisionId='<logicalId>-<digest8>', digest}
  (digest=digestObject(manifest), 复制 staging→revisions/<digest>/ + manifest.json);
  promote(logicalId, {expectedCurrent, targetRevision, candidateDigest, gateRunId, approvalId}) CAS
  (_withLock 互斥 + pointer 比对 + WAL 先写 + 原子 rename);
  rollback(O(1) 切指针不删历史)/history(logicalId)→[{revisionId, digest, status:
  active|previous}]/gcCandidates(只清未 seal DRAFT)/verifyRevisionDigest(digest)/
  revisionContent(digest)→{files: {relPath: text}, text}|null(排除 manifest/candidate/source 控制文件);
  _recover() 崩溃恢复按 WAL 重放。
- fs-store: ensureDir/writeJsonAtomic(.tmp+rename)/readJson/appendLedger(直接 appendFile 一行 JSON)/
  readLedger/removeStrayTmp; hash: sha256/digestObject。

## 4. packages/security-hardening(早期 M4/M5/M6, 3 测试)

- Holdout(lib/holdout.js): 盲 holdout 服务级隔离——runner 收不到原始数据, 只跨边界聚合
  {passed, n, metrics}。
- Redaction(lib/redaction.js): trace 默认脱敏(api-key/bearer/private-key 三形状 + extraPatterns);
  sanitizeJudgeInput(候选输出当数据不当指令, 去 im_start/im_end/ignore-prior-instructions,
  超长 fail-closed)。

## 5. packages/system-presets(M4/M5/M6, 已真实安装)

- system-evaluator / system-evolver 两个 agent preset(agent.cordis.yml 工具面), 已安装进真实
  registry: C:/Users/daixu/.dsh/preset-registry/pointers/system-evaluator.current.json /
  system-evolver.current.json 均存在(research/install-system-presets.mjs)。
- packages/request-api: request_evaluation / request_evolution 工具(异步 job 契约)。
- packages/dsh-eval-defaults: 评测默认 provider/model 设置页(settings 插件)。

## 6. 真实资产与闭环记录

- 真实 registry root C:/Users/daixu/.dsh/preset-registry, audit C:/Users/daixu/.dsh/evolution-audit。
- evaluate 预设历史链 6 代(active evaluate-c4d8aec0 → ab63a9b7 → 8b9b3f03 → ab811c74 → c60321bb →
  dab4f200); system-evaluator/system-evolver 各自指针。
- 真实 benchmark 集(eval/benchmarks/*.yaml): fix-multiply-short(clipa)、split-demo、
  evaluate-preset(-p2/-rubric/-v2)、refactor-rename(dev, test-tamper trap)、readme-write(guard,
  term check)、demo(smoke)、probe。
- 真实闭环执行记录: 第 1-3 轮(结构检查)、第 4 轮 rubric INCONCLUSIVE 诚实拒绝、第 5 轮 P2
  proposal/budget/near-dup、第 6 轮 gate 效率维度 promote(63→37 步)、P3 治理 promote
  evaluate-c4d8aec0(6→5 步)、P4 --auto 真实 proposer 生成候选但 gate 诚实 INCONCLUSIVE(无增益)。
- 评测引擎: provider clipa(本地 8317, deepseek-v4-flash), 凭证 env 优先否则
  C:/Users/daixu/.dsh/.credentials.yaml; runner 内嵌 judge 从未真实执行(host profile 无 llm,
  verdict 恒 null)——**真实缺口: LLM-judge 业务指标层不在闭环内**(外部 rubric-score.mjs 补分)。

## 7. 已知缺口(自评, 待与全集对照后确认)

- 内嵌 judge 真实执行(judge.provider/model 配置, LLM-judge 入闭环)。
- 评测-进化对象对齐(benchmark 注入被测 preset, 当前 wrapper.cjs 手工 --preset-src)。
- 命令面: --export/--budget/rollback CLI 未暴露。
- system-evolver 实战轮(真实 --auto 至今无 promote)。
- 热挂载/技能提炼/记忆沉淀类能力(dsh-evolve/dsh-skill-evolve 域)未实现。
