# implement — P1 UCB-Air 多候选并行调度

## P2-1 lib/ucb.js(纯函数)+ 测试
- `ucbScore(mean, n, totalN)` = mean + sqrt(2 * ln(totalN + 1) / max(n,1));n=0 → mean 无探索(或返回 mean)。
- `shouldExpand({ expanded, evaluated, alpha = 0.6 })`:照 dsh-self-evolving 语义 `(N + P_eval)^alpha >= T`——实现为 `(expanded + evaluated) ** alpha >= expanded`(expand 预算与 evaluated 预算的关系),返回布尔。
- `test/ucb.test.js`:score 单调(同 n mean 高者高;同 mean n 小者高,探索项起作用);shouldExpand 边界(expanded=0 → true;expanded 大 evaluated 小 → false 节奏);alpha 参数影响。

## P2-2 proposer.proposeMultiple + 测试
- proposer.js 增 `proposeMultiple({ count, runJson, baselineFiles, logicalId, llm, redactValues })`:循环调用 propose 内部逻辑直到 count 个互异候选(主假设不同 + 内容 hash 不同),或 LLM 拒绝/耗尽;候选数不足 count 如实返回实际数。复用 parseJsonLoose/proposal-check 校验。
- `test/proposer-multi.test.js`(fake LLM 按轮返回不同 JSON):3 互异候选;count>3 截断;LLM 返回重复假设 → 去重后如实返回;redact 生效。

## P2-3 dsh-evolve.js --candidates 模式
- usage 增 `--candidates <n>`(默认 1);解析;n>1 时走多候选分支:
  - proposeMultiple → 每候选 createCandidate(hypothesis/evidence/mutations 各自)+ 物化 staging → seal×n;
  - 并行评测:Promise.allSettled(每候选 runBenchmark),并行度 min(n,2);
  - 每候选 evalEvidence + evaluate(gateOverrides 同单候选);budget 记账(attempt, costUsd from run.json);
  - 结果表输出到 out/candidates.json: [{candidateId, decision, gain, efficiencyGain, steps, costUsd, reason}];
  - 选择:唯一 ACCEPTED → 它;多 ACCEPTED → 最高 gain+effGain;无 → exit 1;
  - --approve → promote 选中候选;audit 含多候选记录。
- 单候选路径(--candidates 缺省 1)行为与现有一致。

## P2-4 验证
- ucb/proposer-multi 测试全绿;evolution-controller 全量单进程回归全绿。
- 真实闭环(clipa, --candidates 2, fix-multiply 类 benchmark):2 候选 seal+并行评测+双 gate 结果;至少 1 ACCEPTED;--approve 后 promote;审计 ledger 记录多候选。
- 预算 AC4:--budget-limit 0.001(远低于 1 次评测成本)→ 第 2 候选评测被拒,budget-blocked 标注。
- 提交 + task.py archive + journal 追加(含 UCB-Air vs HGM 取舍记录)。
