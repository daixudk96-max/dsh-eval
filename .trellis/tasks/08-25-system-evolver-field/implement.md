# implement — 实战: system-evolver 驱动真实进化闭环

## P3-1 system-evolver 配置盘点(AC1)
- 读 packages/system-presets/presets/system-evolver/(preset.yml + agent.cordis.yml):persona 原文、工具面(tool-*/skill-*)清单、与闭环各步(评测/分析/候选/门禁/审批)的覆盖度。
- 与 system-evaluator 对比(评测 agent 与进化 agent 的职责边界是否清晰)。

## P3-2 真实失败证据 + 候选生成(AC2)
- 起点: run-evalpreset-p2-2026-08-22.json(真实超时失败)。补充: 若时间允许, 重新跑一次 evaluate-preset 小样本确认当前状态(已知 1.0, 快速)。
- 进化 agent(按 system-evolver persona 驱动, 主会话执行或派 subagent 按 persona 提示执行): 分析失败证据 → 产出一致候选:
  - hypothesis: 指向失败机制(如 ask-user 交互阻塞 / 无重试恢复);
  - mutations: 真实内容变异(改 evaluate preset 的 agent.cordis.yml);
  - 写入候选目录(如 eval/presets/candidates/evolve-field-<ts>/), 内容经 proposal-check 语义。
- 注意: 候选与 08-25-ucb-air 演示的候选(ask-user 修复)内容不同——本次候选由进化 agent 独立产出, 若与已有近重复, 如实标注并另选方向(如加失败重试规则, 而非去 ask-user)。

## P3-3 CLI 真实闭环 + promote(AC3)
- `node packages/evolution-controller/bin/dsh-evolve.js --benchmark <evaluate-preset 或 fix-multiply 基准> --registry C:/Users/daixu/.dsh/preset-registry --logical evaluate --candidate <候选目录> --split dev --approve <用户确认的 approvalId> --out <out>`。
- 若 gate 拒绝(INCONCLUSIVE/FAIL): 如实记录, 与用户确认是否调整候选后重试(不伪造)。
- promote 成功: 指针/gateRunId/approvalId 记录; 导出 evaluate-evolved/ 同步(如需要)。

## P3-4 复盘报告 + 收尾(AC4/AC5)
- research/system-evolver-field-report.md: 配置覆盖度表、闭环各步耗时/成本(真实数字)、缺口清单(≥3 条, 每条第「影响/建议」)、结论。
- 全量回归: evolution-controller + preset-registry 单进程测试。
- 提交 + task.py archive + journal。
