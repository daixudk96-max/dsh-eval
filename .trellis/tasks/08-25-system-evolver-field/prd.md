# PRD — 实战: system-evolver 驱动真实进化闭环

## 背景
平台能力已齐(评测/registry/controller/gate/proposer/CLI/P4 WebUI),全部为库与 CLI 层。实战 = 让已安装的 **system-evolver agent preset**(registry 已有初始安装 system-evolver-5fac7f0b)以真实 agent 工作流端到端驱动一次进化,暴露「预设本身能否指导 agent 完成闭环」与「CLI/流程真实缺口」。

起点证据:已有真实失败评测 `eval/benchmarks/run-evalpreset-p2-2026-08-22.json`(evaluate preset 大样本评测 590s 超时, taskSuccessRate 0)——真实评测产物,非伪造。

## 需求
- R1: 读 system-evolver preset 配置(packages/system-presets/presets/system-evolver/),总结其 persona/工具面对「进化闭环」的指导能力;标注实战中实际用到/缺失的部分。
- R2: 进化 agent 按 system-evolver persona 驱动:分析真实失败证据 → 产出候选(假设+证据+真实内容变异)→ 写入候选目录。
- R3: dsh-evolve CLI 闭环执行:baseline+candidate 真实评测(clipa)→ gate → 用户批准(approvalId)→ promote 到真实 registry。
- R4: 复盘报告落盘 research/system-evolver-field-report.md:缺口清单(CLI 缺什么/persona 缺什么/流程哪里卡/耗时成本)。

## 验收(AC)
- AC1: system-evolver 配置总结完成(persona 原文要点 + 工具面清单 + 对闭环各步的覆盖度)。
- AC2: 进化 agent(按 persona 驱动, 非默认闲聊)产出候选:假设指向真实失败证据、内容变异真实(经 proposal-check)、候选目录落盘。
- AC3: CLI 闭环真实跑通:baseline+candidate 评测 → gate 判定 → promote(带用户 approvalId)到真实 registry;审计 ledger 含完整事件链。
- AC4: 复盘报告落盘,含至少 3 条真实缺口(无论大小)。
- AC5: 全量回归:evolution-controller/preset-registry 测试全绿。

## 范围外
- 多轮循环/UCB 跨轮(用户已定实战先行, 多轮后续)。
- 修改 system-evolver preset 本身(复盘缺口中提出, 另行任务)。
