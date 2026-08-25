# PRD: system-evolver 工具面实战 —— evaluate 新一轮真实进化

## 背景

`packages/system-presets` 工具面接线已完成(commit 4dd839c, 任务 08-25-system-evolver-tools):
`evolution.propose/mutate/candidate/run` 4 工具已注册为真实 DSH 工具(execute 调真实
proposer/registry/dsh-evolve CLI)。但**工具链路从未被真实调用过一次**——上一轮实战
(08-25-system-evolver-field)发生在接线之前, 用的是 CLI + subagent 分发。

本任务: 用 evolution.* 工具的真实 execute 链路, 驱动 evaluate logical preset 的
新一轮真实进化闭环, 验证「工具面 → 真实库 → 真实评测 → gate → promote」全链路可用。

## Goal

用 `packages/system-presets/plugins/evolution-tools.js` 的 execute 函数链
(executePropose → executeMutate → executeCandidate → executeRun) 驱动 evaluate preset
一轮完整真实进化, 得到**诚实结论**: 有真实证据增益则 promote, 无增益则如实拒绝;
同时验证工具面接线无功能缺陷(不暴露 approve 的自造路径)。

## 需求

- R1(链路): 四个 execute 函数按顺序真实执行, 不 mock 内部库调用。
- R2(证据): 失败证据必须来自真实 run.json(新跑一轮 baseline 评测, 或引用真实历史 run)。
- R3(门禁): gate 判定与 promote 语义与 CLI 完全一致(approvalId 必须由人审流程给出,
  工具面不暴露 --approve)。
- R4(诚实): 评测引擎故障/无增益时如实记录, 不伪造 promote。
- R5(回归): 全量测试不受影响。

## 验收标准

- AC1: executePropose 以真实失败 run.json + baseline 目录生成 proposal(ok:true 或带
  明确 reason 的拒绝), 产物落盘。
- AC2: executeMutate 对候选文件应用至少 1 条真实变异, 返回 changed:true。
- AC3: executeCandidate 在真实 registry(~/.dsh/preset-registry)创建 staging 候选,
  files 物化到 staging 目录。
- AC4: executeRun 完成真实评测 + gate; gate 判定符合预期(PASS→提交人工审批;
  INCONCLUSIVE/FAIL/INVALID→如实记录, current 指针不动)。
- AC5: 若 gate PASS, 以用户提供的 approvalId 完成 promote, 指针/gateRunId/approvalId
  记录正确; 若未 PASS, 记录拒绝原因。
- AC6: 全量回归绿(evolution-controller + preset-registry 单进程; 工具测试 9/9)。

## 约束

- 不修改 E:\github\dsh(DSH 本体)。
- 不 git commit 本任务的中间产物(由主会话提交)。
- 测试形态: node test/<file>.test.js 单进程(勿 node --test 目录)。
- 诚实原则: 不伪造评测分数、不为 promote 而 promote。
- 真实 registry: C:/Users/daixu/.dsh/preset-registry, 审计 C:/Users/daixu/.dsh/evolution-audit。
