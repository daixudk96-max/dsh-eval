# 自动进化闭环: proposer + 评测集 + 系统 preset 治理

## Goal

把进化闭环的**最后一个手工环节**自动化,并扩大闭环的真实覆盖面:

- **A. proposer 自动生成**: LLM 读失败证据(failure clusters + 真实 run.json/trace)→ 自动生成
  hypothesis + 变异内容 → 走 proposal-check 门槛 → seal/gate/promote。从此
  `dsh-evolve` 可在无 `--candidate` 时全自动完成一轮进化(人只在 promote 时给 approvalId)。
- **B. 评测集扩充**: 新增 2+ 个真实 benchmark case(与 fix-multiply 同风格: 小任务 + 确定性 check),
  并按 P1 的 split 机制分配 dev/guard, 让失败聚类有更宽的证据面。
- **C. 系统 preset 纳入治理**: system-evaluator / system-evolver(shipped presets)
  作为第二/第三个 logical preset 纳入 registry(初始安装 + 可进化),
  验证多 logical 并行进化与 shipped preset 版本化。
- **D. 收尾**: 全量回归 + 清理历史产物 + journal + plan 勾选。

## Requirements

### A. Proposer 自动生成
- 新模块 `packages/evolution-controller/lib/proposer.js`(CJS 零依赖, 可注入 judge/llm 客户端):
  - 输入: `{ runJson, baselineFiles, logicalId }`(run.json 失败 case + 标签 + 当前 revision 内容)
  - 输出: `{ hypothesis, evidence[], mutations[], candidateFiles }` — candidateFiles = 变异后的文件内容
  - LLM 调用可注入(测试用 fake; 真实走 clipa 兼容的 OpenAI 协议端点, 与 research/rubric-score.mjs 同法)
  - 生成内容必须通过 proposal-check 才能进 createCandidate(不绕过门禁)
  - 失败证据先 redact 再进 prompt(复用 lib/redact.js)
- `bin/dsh-evolve.js` 增 `--auto` 模式: 无 --candidate 时调用 proposer 生成(替代现在的 README marker 占位)

### B. 评测集扩充
- 新增 2 个真实 benchmark: 如 `eval/benchmarks/refactor-rename-benchmark.yaml`(重命名+测试通过)、
  `eval/benchmarks/readme-write-benchmark.yaml`(读代码写 README + check 关键词)
  —— 风格照 fix-multiply-benchmark.yaml(provider: clipa, workspace + expected.check)
- 每个 case 标记 split: dev 为主, 至少 1 个 guard case 真实验证 fail-closed 与揭盲路径
- 真实跑通(dev + guard), 归档 run.json

### C. 系统 preset 纳入治理
- `packages/system-presets/presets/system-evaluator/` 与 `system-evolver/` 内容
  作为 logical `system-evaluator` / `system-evolver` 初始安装进真实 registry
  (expectedCurrent: null 首个版本, 如同 evaluate 首次安装)
- 验证 resolveCurrent/history 对多 logical 独立工作; 后续进化走同一 dsh-evolve CLI

### D. 收尾
- evolution-controller 全量 node:test + dsh-eval vitest 全量回归
- 清理 run-short* / probe-* 历史产物(不提交)或归档到 research/archive
- evolution-plan.md 勾选本阶段; git 提交; 归档任务

## Acceptance Criteria

- [ ] **AC1**: proposer 单测(fake LLM 返回变异): 输出过 proposal-check; 缺证据 → 拒绝; redact 生效
- [ ] **AC2**: `dsh-evolve --auto` 无 --candidate 跑通一轮(真实 LLM): hypothesis/evidence/candidate 生成,
      无 approvalId → 拒绝; 带 approvalId → promote(或按 gate 判定诚实拒绝)
- [ ] **AC3**: 新增 2 benchmark, dev 全过 + 至少 1 guard case 跑通并记录
- [ ] **AC4**: system-evaluator/system-evolver 初始安装进真实 registry, resolveCurrent 正常
- [ ] **AC5**: 全量回归通过; 收尾提交完成

## Notes

- 诚实原则: proposer 是生成侧, proposal-check 是门槛 —— 生成内容不过门槛就拒绝, 不绕过。
- LLM 调用与现有 rubric-score.mjs 同构(clipa 本地端点, 凭证从 ~/.dsh/.credentials.yaml)。
- 不引入新依赖; proposer 的 LLM 客户端用 fetch(环境内可用)或注入。
