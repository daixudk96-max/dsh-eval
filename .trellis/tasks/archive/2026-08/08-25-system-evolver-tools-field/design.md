# Design: system-evolver 工具面实战 —— evaluate 新一轮真实进化

## 架构决策

### D1. 驱动方式: 真实 execute 函数链(不 mock, 不绕路)

`packages/system-presets/plugins/evolution-tools.js` 是 ESM('use strict' + export),
execute 函数(executePropose/executeMutate/executeCandidate/executeRun)可直接 import
调用。写驱动脚本 `research/evolution-tools-field.mjs`(ESM), 按真实 agent 调用顺序:

```
executePropose({evidenceRun, baselineDir, outDir})
  → proposal.json + outDir/candidate/(propose 生成的文件)
executeMutate({dir: outDir/candidate, file, from, to})   // 可选: agent 微调
executeCandidate({root, logicalId, sourceRevisionId, hypothesis, evidence, mutations, files})
  → registry.createCandidate + patchCandidate + files 物化 staging
executeRun({benchmark, registryRoot, logicalId, split:'dev', minEffect:0.05, out})
  → spawn dsh-evolve.js 完整闭环(评测×2 + gate) → gate.json/result.json
```

- executePropose 内部调用 proposer.propose(真实 LLM, clipa deepseek-v4-flash,
  凭证 env→~/.dsh/.credentials.yaml)。
- executeRun 内部 execFile spawn `node bin/dsh-evolve.js`(真实子进程, 600s 超时)。
- approve 不传(工具面已移除该参数) — 设计上只能从外部以人审路径 promote。

### D2. 证据获取策略(诚实优先)

- 先真实跑一轮 baseline 评测(evaluate-field-baseline-benchmark.yaml, provider clipa)。
- 若跑出失败 case → 该 run.json 即 evidence。
- 若全部通过(无失败) → executePropose 应返回
  `{ok:false, reason:'proposer: no failed cases in run.json (nothing to fix)'}` —
  如实记录拒绝, 不再强行进化(这正是诚实行为)。此时可降级选项(需用户确认):
  用历史真实失败 run(eval/benchmarks/run-evalpreset-p2-2026-08-22.json, 590s 超时
  taskSuccessRate 0)作为证据重试 — 该证据已用于上一轮 field(已 promote unattended
  修复), 需注意近重复风险(proposer 可能产出相同假设 → 候选内容 hash 与现有 revision
  相同 → proposal-check 拒绝)。

### D3. promote 路径(人审绑定)

- executeRun 结果 decision=PASS → gate ACCEPTED。
- promote 由主会话执行: 向用户申请 approvalId(ask_user_question), 得到后运行
  `node packages/evolution-controller/bin/dsh-evolve.js ... --approve <id>` 或等价
  controller.promote 调用; 永不通过工具面自造 approvalId。

### D4. 失败处理

- LLM 不可用(clipa down)→ executePropose 返回 ok:false 带 reason, 如实记录, 任务
  失败但链路验证完成(AC1 允许"带 reason 的拒绝")。
- 评测引擎故障(InvalidSubscription/PI_AI_ERROR)→ dsh-evolve 内 evidenceOk=false →
  gate INVALID → 如实记录, 不 promote。
- spawn EPERM(沙箱) → 驱动脚本无法完成 executeRun; 如实记录并降级为 CLI 直跑
  (bin/dsh-evolve.js 同参数), 标注"工具 spawn 受环境限制"。

## 数据流

```
run.json(真实失败证据) + baselineDir(当前 revision 内容)
   → evolution.propose(LLM) → proposal.json + candidate/ 文件
   → evolution.mutate(可选) → 文件改写
   → evolution.candidate(Registry) → staging/<candidateId>/ 物化
   → evolution.run(spawn dsh-evolve) → benchmark×2 → gate{decision,...}
   → PASS? → 用户 approvalId → CLI promote → 指针更新 + 审计
   → 导出 eval/presets/evaluate-evolved/ 同步指针
```

## 权衡

- 直接调 execute 函数而非新开 DSH 会话挂载 system-evolver: 前者验证的是真实接线
  (execute→库→CLI→registry), 后者需 GUI 会话不可自动化; 选择前者+报告说明。
- 证据用历史失败 run vs 新跑: 新跑优先(证据新鲜); 历史 run 降级需用户确认。
- executeRun 内 spawn 的 EPERM 风险: 若发生, 如实记录并降级 CLI 直跑(说明原因)。
