# P0 开工计划总览：把评测证据变成可信进化决策

> 状态：`planning / draft`。这是给人审阅的概览，不是实施批准；当前不启动 Trellis、不修改产品代码。

## 一句话目标

在现有 dsh-eval judge、evolution-controller gate、preset-registry 版本链之上，补齐四个真实缺口：**judge 业务分数进入 gate、候选不得背题、冻结 benchmark epoch、registry 可验证备份恢复**。

## 为什么现在做

当前项目的确定性 check 能判断“任务是否完成”，但业务质量（最终答案、幻觉、rubric）必须由 LLM-judge 提供。judge 执行链本身已经在 `packages/dsh-eval/src/judge.ts`、`packages/dsh-eval/src/runner.ts`、`packages/dsh-eval/src/index.ts` 中存在并有测试；真正断点在 `packages/evolution-controller/bin/dsh-evolve.js:90-106,226-232` 没有把 `run.grading.finalAnswerScore/hallucinationRate` 映射到 controller/gate。

同时，`packages/evolution-controller/lib/proposal-check.js` 尚未检查 benchmark 污染；`packages/dsh-eval` 尚未持久化 frozen/material digest；`packages/preset-registry/lib/registry.js:236-242` 的 `verifyRevisionDigest()` 只验证 manifest，不验证 revision 内容树。

## In Scope

### A. Judge 真实可观察 + Gate 接线

- 先对当前 eval profile 做 smoke diagnostic，分辨无 llm seam、provider/凭证、调用失败、输出解析失败。
- 不重写已存在的 judge prompt/stream seam；只补可选 status/errorCode/run-level diagnostics。
- `dsh-evolve` 从 run grading 生成 0–100 rubric evidence（默认阈值 60），把 score、hallucination regression、validity 传进 `controller.evaluate(...)`。
- 不可用 judge 证据不能降级成 0，也不能被 `INCONCLUSIVE` 绕过。

### B. Overfit/污染早拒

- 新增 CJS 零依赖 `packages/evolution-controller/lib/overfit.js`。
- 检查 benchmark digest、长 statement、`case_id: <id>`、private rubric 四类 exact-text 污染。
- 扫描 source→candidate 新增/修改文本；在 registry staging 前拒绝；审计只记录 code/kind/caseId/path，不泄漏 rubric。

### C. Frozen benchmark epoch

- `frozen:false` 默认兼容；`frozen:true` 捕获语义 snapshot。
- digest 覆盖 case 顺序/id/split/prompt/expected/judge rubric/materials；不默认 hash agent 可修改的整个 workspace。
- 运行结束重载并校验；漂移生成 invalid run、保留 mismatch、无 grading、非零退出。
- baseline/candidate epoch 不同进入 gate `INVALID`。

### D. Registry export/import

- 新增 file-hashed JSON package v1，包含全部 logical/pointer/revision/ledger，不含 DRAFT staging 和临时文件。
- 逐文件 SHA-256 + packageDigest + legacy manifest digest 双重验证。
- import 仅支持空 root，先完整校验再写临时目录；非空 merge/覆盖不在 P0。
- `dsh-evolve --export/--import` 作为独立运维模式，不启动 benchmark。

## Out of Scope

- 重写 judge prompt/评分算法、Terminal-Bench/Harbor/LMAB 适配。
- 语义级 overfit、case 生命周期/calibration、weighted aggregate、keyless replay/cross-harness import。
- 逆编辑回滚、partial conflict、威胁扫描、failure feedback、skill/memory、WebUI、UCB-Air。
- registry 非空 root merge/覆盖；改变已有 revision digest；导出 staging；judge 成本预算联动。

## 四阶段排期与独立验收门

| 阶段 | 主要产物 | 必须看到的证据 |
|---|---|---|
| 0. 诊断与契约 | smoke 诊断结果、judge/rubric/epoch/export schema 定稿 | 无凭证泄漏；null/invalid 语义明确 |
| 1. Judge 接线 | `dsh-evolve` rubric mapping、gate validity、诊断字段 | fake seam 映射测试；真实 run `finalAnswerScore != null` 或精确环境阻塞报告 |
| 2. Overfit | `overfit.js`、controller early reject | 四类污染单测；staging 不创建；`proposal-rejected` audit |
| 3. Frozen | benchmark snapshot/caseHash/run invalid | 未变正常；运行中变更 invalid；epoch mismatch → `INVALID` |
| 4. Export/Import | registry API、CLI、file-hashed package | 新空 root round-trip；篡改/path/schema/非空目标均拒绝 |
| 5. 集成收尾 | README、research plan、Trellis journal | 全量回归、真实闭环、可回滚提交 |

## 关键契约（当前推荐稿）

1. judge score 归一化为 0–100，默认 `rubricMinScore=60`；score/null 不混为一谈。
2. candidate hallucinationRate 高于 baseline 记 rubric regression；judge 无有效分数的 evolution run fail closed。
3. frozen 是“本次评测 epoch 不漂移”，不是 case lifecycle；显式 materials 优先，workspace 不默认纳入。
4. `verifyRevisionDigest()` 继续验证 legacy manifest；export package 的逐文件 hash 才证明备份内容完整。
5. import 只落到空 root，避免 P0 引入 merge/覆盖冲突语义。
6. 同语言逻辑直接吸收改造；不同语言只拆机制，用项目现有 CJS/ESM 约束重写；不整体 fork 参考仓库。

## 主要风险

- 当前 profile 是否真的挂载 llm 仍需 smoke；历史 `finalAnswerScore:null` 不能简单归因于某一层。
- dsh-evolve 需要安全取得 benchmark metadata 才能做 private rubric exact-text 检查；私有 rubric 只允许内存比较，不进 run/audit。
- frozen drift 的 invalid run 会影响 report/compare/CLI exit，需要先定义可选兼容字段。
- Windows 下 import 临时目录提交不能照搬 POSIX rename，必须有失败隔离测试。
- exact-text overfit 检测不能识别语义改写，这是刻意保留的 P0 边界。

## 计划文件状态

- `prd.md`：已按源码事实重写，删除“从零接线”断言。
- `design.md`：已写数据流、状态契约、兼容性、隐私与事务边界。
- `implement.md`：已写 0→1→2→3→4→集成顺序、验证门、命令与回滚点。
- 本文：供用户审阅的高层计划。
- `task.json`：仍为 `status: planning`；未运行 `task.py start`。

## 下一步

请先确认“严格 fail-closed”这一组策略，再对完整计划做最终批准；批准前不写产品代码、不派实现子代理。