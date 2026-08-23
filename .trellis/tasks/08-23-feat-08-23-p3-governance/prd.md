# P3 治理: 审查脱敏 + 进化命令面

## Goal

P3 治理收尾(evolution-plan.md §5 最后阶段):
1. **审查脱敏(redact)**: 失败证据(会话 trace)进 proposer 前剔除凭证/绝对路径/会话 id ——
   照 lmzhen/dsh-evolution `evolution-review/redact.ts` 改写(CJS 零依赖)。
2. **进化命令面**: 把「评测 → 失败聚类 → 变异候选 → seal → gate → promote」闭环
   从 research/*.mjs 手工接力脚本, 升级为 dsh-eval 的正式 CLI 命令
   (`dsh --profile eval evolve ...`), 一条命令跑完整轮。

## Requirements

### R1 脱敏模块(evolution-controller/lib/redact.js, 新增)
- `redactReviewText(text, {keys, patterns})` → 替换凭证值(长度>0 的 env/credential 值)、
  内网/本地绝对路径(盘符/UNC/`~`)、session id(token 形)、api key 形串(`sk-`/`Bearer ` 后串)。
- 脱敏替换为 `<redacted:<type>>`, 长度不泄露。
- 失败簇/evidence 字符串在进入 controller.createCandidate(evidence 字段) 与
  proposer prompt 之前必须经 redact; 审计 ledger 也只记录脱敏后文本(防泄漏回滚)。

### R2 evolve 命令(dsh-eval lib/evolve.js, 新增 + command.js 注册)
- `dsh --profile eval evolve --benchmark <yaml> --registry <root> --logical <id>
  [--approve <approvalId>] [--min-effect 0.05] [--guard]`
- 流程(单命令闭环): ① 评测 baseline(profile 自身, --split dev 默认) →
  ② 失败聚类(确定性: 从 run.json 取失败 case + 标签, 生成 hypothesis + evidence,
     evidence 先 redact) → ③ createCandidate + 变异(占位: 第一版从候选内容目录读
    `--candidate <dir>` 或对 preset 做确定性小变异, 完整变异生成器留给后续)
    → ④ seal → ⑤ 评测 candidate(同一 benchmark, split 同 baseline) →
          ⑥ gate(minEffect/效率/回归/rubric 全走代码) → ⑦ 结果:
    ACCEPTED + --approve → promote + 导出; 否则打印拒绝原因。
- 每步真实输出到 --out 目录(run.json ×2, gate.json, result 摘要), 供审计与 WebUI。

### R3 真实闭环验证
- 用现有 evaluate-preset benchmark 跑完整 evolve 一轮(小样本), 展示:
  无 approvalId → 拒绝; 带 approvalId → promote + 指针更新 + 审计事件。

## Acceptance Criteria

- [ ] **AC1**: redact 单测: 凭证/路径/长 token 被替换为 <redacted>, 原串不残留
- [ ] **AC2**: 审计 ledger 中 evidence/失败文本不含原凭证串(grep 验证)
- [ ] **AC3**: `dsh --profile eval evolve --help` 显示参数; 无 --approve 跑一轮 → 拒绝路径正确
- [ ] **AC4**: 带 --approve 跑一轮真实 evolve → promote 成功, 指针/审计/产物齐全
- [ ] **AC5**: 全量回归(dsh-eval vitest + evolution-controller node:test)通过

## Notes

- 轻量任务 PRD-only 起步; 若 evolve 命令编排复杂, 补 design.md 再实施。
- 用户定稿原则: 同语言直接改; CJS 零依赖; 诚实原则(无真实评测证据不 promote)。
- 前置已完成: P0 rubric / P1 split-failclosed / P2 proposer-budget / 效率维度。
