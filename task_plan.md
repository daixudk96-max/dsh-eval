# 任务计划：评测 + 自进化架构文档核验与整合评估

## 目标
1. 核实文档引用的外部仓库/论文是否真实 ✅ 完成（全部真实）
2. 核实文档对各仓库能力描述是否准确 ✅ 完成（基本准确，3 处修正）
3. 评估架构是否符合「评测 → 进化」流程 ✅ 完成（成立，与 DSH 兼容）
4. 评估如何整合进当前 DSH 工作流/插件 ✅ 完成（3 插件 + 2 preset + 收窄工具面）

## 阶段
| 阶段 | 状态 | 内容 |
|------|------|------|
| S1 仓库真实性核验 | complete | 18 repo + arxiv 2608.16859 全部真实 |
| S2 能力描述核验 | complete | 8 README 对照；3 处定位修正 |
| S3 DSH 本机能力核验 | complete | agentPresets API + standing-mount generation 语义 + 官方无 eval/evolution |
| S4 流程符合性评估 | complete | 成立；5 点补强 |
| S5 整合方案 | complete | 3 插件 + 2 preset + 钩子 + MVP 6 步 |
| S6 最终报告 | complete | final-report.md |

## 产出文件
- E:\github\dsh-eval\final-report.md —— 主交付物（核验+评估+整合方案）
- E:\github\dsh-eval\findings.md —— 证据明细
- E:\github\dsh-eval\research\*.md —— 8 个仓库 README 原文
- E:\github\dsh-eval\task_plan.md / progress.md —— 规划与日志

## 关键决策记录
- 核实手段：curl 直连 GitHub API（匿名限流 60/hr，403 非 404，需 HTML 复验）+ README 全文对照 + DSH 源码实证
- 三处选型修正：HarnessEval-W 仅范式；ctx.eval 以 hccccc01333/dsh-eval 为底座；ZK 主干让位 Lhy723 Profile 闭环 + ZK entry 级 mutation

## 当前规划：P0 可信评测闭环与 Registry 备份（2026-08-23）

### 当前目标

把已有 LLM-judge 执行链真正接入进化 gate，并补齐 benchmark 污染早拒、frozen epoch/material snapshot、preset-registry 可验证 export/import。

### 当前阶段

| 阶段 | 状态 | 内容 |
|---|---|---|
| P0-Evidence | complete | 核对 judge/runner/index、dsh-evolve、gate、registry 与参考仓库源码 |
| P0-Convergence | complete | 重写 Trellis `prd.md`、`design.md`、`implement.md`，新增 `plan-overview.md` |
| P0-Review | in_progress | 等用户确认严格 fail-closed 契约与完整计划 |
| P0-Implementation | pending | 未运行 `task.py start`，未修改产品代码 |

### 当前权威工件

- `.trellis/tasks/feat-08-23-p0-judge-overfit-frozen/prd.md`
- `.trellis/tasks/feat-08-23-p0-judge-overfit-frozen/design.md`
- `.trellis/tasks/feat-08-23-p0-judge-overfit-frozen/implement.md`
- `.trellis/tasks/feat-08-23-p0-judge-overfit-frozen/plan-overview.md`

### 关键规划决策

- 不重复实现已存在的 judge stream seam；先诊断真实运行，再补可观察诊断与 `dsh-evolve` rubric mapping。
- judge 缺失/失败不伪造成 0 分；在要求业务 rubric 的进化闭环中 fail closed。
- overfit 只在 proposal/controller 早拒，扫描 source→candidate 增量；gate 不读取私有 benchmark 原文。
- frozen digest 覆盖评测语义和显式 materials，不默认 hash agent 可修改的整个 workspace。
- registry import P0 只支持空 root；逐文件 SHA-256 证明备份内容完整，legacy revision digest 继续只验证 manifest。
