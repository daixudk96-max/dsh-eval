# PRD: 真实进化 — 修复 evaluate 挂载缺陷(补必填 config)

## Goal
用真实进化闭环把「补 tool-fs-search/tool-todo 必填 config」落进 preset-registry,
产生新版本 `evaluate-<新digest>`,gate PASS 后 promote,使版本选择器同步出的
版本目录可正常挂载(修复前 registry current `evaluate-94a7c40b` 的 agent.cordis.yml
缺 `config.sampleOverCapGlobResults` / `config.allowParallelInProgress`,
GUI 挂载报 `agent-preset-invalid: invalid config: missing required value`)。

## 背景(已实测)
- 安装目录 `~/.dsh/.agent-presets/{evaluate,system-evaluator,system-evolver}/` 已手动修复
  (commit f4ff95f),GUI 三个预设挂载验证 ok:true。
- registry 内容寻址不可变,旧版本不能改;本轮进化产生修复版新版本。
- 评测子进程(wrapper 合并 overlay)不受 config 缺失影响(历史评测成功),故
  baseline/candidate 真实评测分数相同 → 质量增益来自「挂载性」而非评测分数。

## 变异(确定性,不用 LLM proposer)
- 文件: agent.cordis.yml
- 变更: tool-fs-search 行补 `config: sampleOverCapGlobResults: false`;
  tool-todo 行补 `config: allowParallelInProgress: true`(参照 deep-mindmap/liangshen)。

## 证据与 gate 输入
- baseline: RPC 实测 `agentPreset.select` → `agent-preset-invalid`(挂载失败)
  → 映射 {overall:0, correctness:0, safety:0, verification:0}(不可用=能力 0,如实标注来源)。
- candidate: RPC 实测挂载 ok:true + 真实 benchmark 评测(taskSuccess 1.0)
  → {overall:1.0, correctness:1.0, safety:1.0, verification:1.0, steps:真实}。
- gate: gain = 1.0 > minEffect 0.05 → PASS;两轮真实评测分数相同记录为无回归证据。
- 诚实原则:所有数字有真实依据(挂载失败/成功为 RPC 实测,评测分数为真实运行),
  映射关系在报告与审计中如实标注。

## 流程
1. 读 registry current(evaluate-94a7c40b)revisionContent
2. createCandidate(hypothesis/evidence/mutations)→ 物化 staging → seal
3. 真实评测 baseline + candidate(复用 evaluate-field benchmark/workspace)
4. evaluate(gateOverrides minEffect 0.05)→ PASS
5. 用户 approvalId → promote
6. 验证:版本选择器同步 evaluate-<新digest> → RPC 挂载 ok:true
7. 收尾:报告 + 全量回归 + 提交 + archive + journal

## AC
- AC1: 新版本 agent.cordis.yml 含两个必填 config,entryListSchema + loader 校验通过
- AC2: gate 判定 PASS(gain 1.0 ≥ minEffect 0.05),审计记录 gate 事件
- AC3: promote 成功,指针 {revisionId: evaluate-<新digest>, gateRunId, approvalId}
- AC4: 版本选择器同步出的 evaluate-<新digest> 目录 RPC 挂载 ok:true
- AC5: 全量回归(evolution-controller + preset-registry 单进程测试)0 失败
- AC6: 报告 research/ 落盘,含证据来源标注(挂载映射 vs 真实评测)
