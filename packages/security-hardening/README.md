# security-hardening（M6）

强化项：**blind holdout 服务级隔离**、**trace 泄漏清理**、**judge prompt-injection 防护**、
**paired 统计（minEffect / INCONCLUSIVE）**、**GC 保护**（已在 M2 落地）。

## 已交付

| 项 | 位置 | 说明 |
|----|------|------|
| Blind holdout 隔离 | `lib/holdout.js` | runner 只向 Gate 暴露聚合 `{passed,n,metrics}`；原始 holdout 数据对 system-evolver 不可达（Host capability + 文件系统隔离，见 M4 HOST-CAPABILITIES.md） |
| Trace 泄漏清理 | `lib/redaction.js` | 默认模式（api-key/bearer/private-key）+ 可扩展；trace 存储前默认执行 |
| Judge 不可信输入防护 | `lib/redaction.js` `sanitizeJudgeInput` | 剥离指令注入模式，fail-closed（超长/非字符串拒绝） |
| Paired 统计 | `evolution-controller/lib/gate.js` | `minEffect` 阈值；`gain <= minEffect → INCONCLUSIVE`（不 promote，可采样重跑）；`perCaseRegression` 容差 |
| GC 保护 | `preset-registry` | current / rollback 窗口 / SessionHeader 引用 / running run 全保护（M2 8/8 测试） |

## 约束（服务级，非 Prompt 约定）

1. system-evolver 无法读取 holdout 原始 case / 答案 / evaluator 内部 Prompt。
2. Candidate 输出作为不可信输入处理（judge 防注入，fail-closed）。
3. trace 默认做密钥 / 用户数据 / 答案泄漏清理。

## 后置项（可选，MVP 不回归 Gate 行为）

- HarnessEval-W 风格动态 EvalPlan / Evidence Tree
- 自动 FailureCluster / RCA
- Revision history / Candidate 管理 UI
