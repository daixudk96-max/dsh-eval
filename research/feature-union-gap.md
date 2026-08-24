# 功能全集 − 已有 = 差距清单

> 输入: research/ecosystem-feature-union.md(9 仓功能全集, subagent 独立盘点) −
> research/platform-feature-inventory.md(自研平台已有)。
> 借鉴关系标注(用户原则): 🔧同语言直接改 / ⚙️不同语言拆模块改写 / ✅印证已有(无需动作) / ❌放弃(理由)。

## 一、覆盖对照(13 域)

| 域 | 已有覆盖 | 差距项 |
|---|---|---|
| A. Benchmark 能力 | yaml schema+split、确定性 check、LLM-judge rubric(钩子)、rubric 加密 | 1-6 |
| B. 评测指标 | 会话/成本/性能/判分/pooled rates、失败 cell 协议(aggregate.js) | 7,8,9 |
| C. 报告/对比/导入 | JSON run、markdown report/compare、import dsh | 10,11,12 |
| D. 判分方式 | 确定性 gate+rubric 两层、严格接受、效率维 | — |
| E. 候选生成 | LLM proposer+proposal-check 门槛、评测子进程隔离 | 13,14,15,16 |
| F. 版本/快照 | 不可变 revision 内容寻址、CAS、rollback、WAL 恢复 | 17,18,19 |
| G. 门禁 | 非回归/失败 cell/材料漂移/效率/rubric/近重复/预算 | 20,21,22,23 |
| H. 审批 | promote 强制 approvalId、状态机 staged | —(比生态更强) |
| I. 回滚 | O(1) 指针回滚、history | 24,26,27 |
| J. 审计/崩溃恢复 | WAL ledger、_recover、互斥锁 | 28,29,30 |
| K. 内容/记忆对象 | preset 内容版本化(logical/revisions) | 31-38 |
| L. 命令面 | dsh eval run/report/compare/import、dsh-evolve --auto | 39,40,41 |
| M. 平台/集成 | profile bundle、settings 页 | 42,43,44,45,46 |

## 二、差距清单(按优先级)

### P0 — 核心闭环缺口(补上才能自称「两层判定」完整落地)

1. **frozen 冻结基准**(case 级 frozen:true+digest; 基准材料不可变; digest 变化→整轮失败)
   来源: dsh-self-evolution(src/benchmark) + dsh-continual-evolve(case 生命周期 draft→calibrating→frozen)
   借鉴: ⚙️改写 benchmark.ts/types.ts(我们已从 dsh-eval-src 同构吸收, 加 split 同款增量)
   价值: 材料漂移/基准被污染是评测可信度根问题; 我们 gate 有 epochSame 概念但 benchmark 层无 frozen 契约。
2. **overfit/污染检测**(assertCandidateNotBenchmarkSpecific: digest/statement 复制、private rubric 污染、case_id 嵌入 → BENCHMARK_OVERFIT/CONTAMINATION)
   来源: dsh-self-evolution/src/candidate.ts
   借鉴: ⚙️改写为新 lib/overfit.js + 挂 proposal-check 或 gate
   价值: 候选「背题」是进化平台最大作弊路径, 我们 proposal-check 无此维度。
3. **LLM-judge 真实执行**(judge.provider/model 配置, 内嵌 judge 从 verdict null 变为真实 rubric 打分, 业务指标层入闭环)
   来源: dsh-eval-src/src/judge.ts(我们已吸收) — 配置接线 + runner 侧 llm 注入
   借鉴: 🔧直接改(钩子已在)
   价值: 用户强调「业务指标只能靠 LLM-judge」; 现状靠外部 rubric-score.mjs 补分, 不在闭环。
4. **store export/import**(备份/恢复整库)
   来源: dsh-continual-evolve(store 备份恢复)
   借鉴: ⚙️改写 registry.js 增量(纯 CJS)
   价值: 真实 registry 已有 6 代历史, 无备份手段。

### P1 — 评测工程化

5. **case 生命周期 + 标定**(draft→calibrating→frozen + CaseMeta capability/distinguisher/shortcuts/calibrationHistory)
   来源: dsh-continual-evolve/src/benchmark.ts
   借鉴: ⚙️改写(需 benchmark.json 形态扩展, 或 yaml 增量字段)
6. **无 LLM 机械校验**(caseCheckProblems: statement≥20 字符/rubric 合法/meta 非空)
   来源: dsh-continual-evolve
   借鉴: ⚙️改写
7. **加权聚合**(case weight 加权均值, 现仅等权)
   来源: dsh-eval-src metrics
   借鉴: 🔧直接改(同构)
8. **质量反馈**(feedback→quality_score/quality_warn→usage 学习闭环)
   来源: dsh-evolution/packages/evolution-feedback
   借鉴: ⚙️改写
9. **keyless replay**(@deepseek-ai/dsh-llm-replay 无密钥 CI 重跑)
   来源: dsh-eval-src(src/runner replay.dir)
   借鉴: 🔧直接改(同构, 但依赖官方 replay 包, 需确认可用性)
10. **import codex|claude-code**(外部会话日志导入为 trial; 现仅 import dsh)
    来源: dsh-eval-src/src/import.ts
    借鉴: 🔧直接改(同构)
11. **status 命令面**(dsh-evolve status: 版本/哈希/漂移/快照一览)
    来源: dsh-self-evolution evolution_status / dsh-self-evolving CLI status
    借鉴: ⚙️改写 bin/dsh-evolve.js 增量

### P2 — 进化治理增强

12. **确定性逆编辑回滚**(从已应用内容重建逆编辑, 无 LLM 重猜; autoRollbackOnReject)
    来源: dsh-continual-evolve/src/rollback.ts
    借鉴: ⚙️改写(我们现为指针级回滚, 此为内容级)
13. **partial 回滚冲突检测**(回滚时检测中间变更冲突)
    来源: dsh-self-evolution/src/snapshot.ts
    借鉴: ⚙️改写
14. **威胁扫描**(写前 block-any: prompt-injection/exfiltration/secret 扫描, 与事后 redact 互补)
    来源: dsh-evolution/packages/evolution-threat
    借鉴: ⚙️改写
15. **failures 失败类聚合命令**(失败类门禁+benchmark 聚合视图)
    来源: dsh-continual-evolve/src/failures.ts
    借鉴: ⚙️改写
16. **decisionReport 逐 case before→after delta**(对比视图增强)
    来源: dsh-continual-evolve
    借鉴: ⚙️改写(compare 已有 B-A delta, 增量)

### P3 — 内容/记忆域(对象广度的扩展, 独立大块)

17. **harness state 四类版本化**(prompt/memory/skill/subagent spec entries, 按 id 版本+回滚)
    来源: dsh-continual-harness(ESP 协议) / dsh-continual-evolve
    借鉴: ⚙️改写
18. **skill 沉淀/提炼**(session.jsonl→SKILL.md, 参数泛化+步骤去重)
    来源: dsh-skill-evolve(src/extractor.ts+generator.ts, 39 文件最小仓)
    借鉴: ⚙️改写(39 文件小仓, 最易移植)
19. **skill 生命周期**(active→stale→archived + consolidate/restore + pinned 受护)
    来源: dsh-evolution/packages/evolution-curator
    借鉴: ⚙️改写
20. **热挂载**(skill→live 插件 / cordis 源码热挂载)
    来源: dsh-continual-evolve mount / dsh-evolve
    借鉴: ⚙️改写
21. **记忆文件**(MEMORY.md/USER.md 字符预算+dedup)
    来源: dsh-evolution/packages/evolution-memory
    借鉴: ⚙️改写
22. **ranked injection**(prompt notes 注入 ≤6/kind×180 字符, 空 store 零 token)
    来源: dsh-continual-harness / dsh-continual-evolve
    借鉴: ⚙️改写

### ❌ 放弃(明确理由)

- **Terminal-Bench/Harbor 适配**(self-evolving): 平台致命(Ubuntu/Docker/Bubblewrap), Windows 无等价物; LMAB 兼容性考察结论=不移植, 以自研 benchmark.yaml 为基准格式。
- **learning-graph**(dsh-evolution): 价值密度低, 无消费方。
- **tools/pre-execute 工具策略门**(dsh-evolve-modes): Web 域耦合。
- **requireGlobalApproval 咨询式审批**(continual-evolve): 我们 promote 强制 approvalId 更强, ✅印证。

### P4 — 后备(用户点名要做, 排后)

23. **Web UI 进化控制台**(✅ 2026-08-23, 任务 feat-08-23-p4-webui-console 已归档)
    基底选型: research/webui-base-selection.md 裁决采纳 **dsh-task-board**(dsh-web-ui 家族, @linxin666/dsh-client-ui-task-board v0.3.2, Apache-2.0)为代码基底; dsh-evolve-modes 否决(无 webServer/SSE、无看板、无 conversation.view)。
    交付: **packages/dsh-eval-console**(新 Cordis 插件包): Host webServer 三端点 GET /eval/state + POST /eval/action(requestId 信封, 只读动作 detail/rollback/refresh, promote 不可达) + GET /eval/events(SSE 15s 心跳, revision 增量); Client conversation.view 标签 id:evolution order:20(rc.8 契约, 对齐 ui-trajectory 范例), 六列看板(SEALED/EVALUATING/ACCEPTED/PROMOTED/REJECTED/INCONCLUSIVE) + 当前版本条(gateRunId/approvalId 芯片) + 详情 modal + 回滚确认短语(ROLLBACK:<revisionId>) + 审计时间线(真实 ledger.jsonl); 真实数据 smoke: 20 行/6 列/103 事件, current evaluate-c4d8aec0。
    验证: tsc 0 错, tsdown lib/client.js 49.48 kB(gzip 11.13 kB, 仅 react externals, 0 @deepseek-ai 值引用), 单测 22/22, smoke-routes 10/10, 回归 evolution-controller 168 + preset-registry 21 全绿。GUI 浏览器挂载验证待 DSH 重启后由主会话协调(未做)。
24. **UCB-Air expand-vs-evaluate 调度**(用户问「UCB-Air 这个是啥呀」后表示要做, 放后面)
    来源: dsh-self-evolving specs/03(search 包)
    说明: UCB-Air = 把「生成新候选(expand)」vs「继续评测已有候选(evaluate)」建模为多臂老虎机, 每个候选按 UCB 分数 = 平均收益 + 探索项(sqrt(2 ln N / n)) 排序, 调度阈值 (N+P_eval)^alpha >= T(alpha=0.6) 决定下一步动作; 目的=有限预算下自动分配评测资源。
    适用条件: 需要「一次多候选并行 + 自动连续进化」才体现价值; 当前单轮驱动架构(用户发起一轮→评测→gate→promote)用不上, 未来做多候选搜索/自动多轮时引入(dsh-self-evolving 搜索算法仅此一项值得借鉴, 其余 clade Thompson/wave scheduler 已放弃)。

### ✅ 印证已有(无需动作)

- 失败 cell 协议(aggregate.js 已吸收 continual-evolve score.ts)
- 材料漂移检测(aggregate.flagMaterialDrift 已吸收)
- 效率门(continual-evolve totalDurationMs ↔ 我们 steps efficiencyGain)
- 人工审批(我们强制 approvalId > requireGlobalApproval 咨询式)
- 审计日志 JSONL 轮转(我们 WAL ledger 同构)
- 快照验证(verifyRevisionDigest ↔ self-evolution snapshot 验证)
- 内容寻址不可变版本(self-evolution digest+单调版本 ↔ 我们 revisions/<digest>)
- 预算(growth/预算域: 我们 BudgetLedger 3 桶 + self-evolving 双式记账同向)

## 三、建议实施顺序

1. **P0-3 LLM-judge 真实执行**(🔧最小改动, 直接打通用户强调的业务指标层)
2. **P0-2 overfit 检测**(⚙️~1 模块, 防作弊关键)
3. **P0-1 frozen 基准**(⚙️benchmark.ts 增量, 与 split 同款模式)
4. **P0-4 export/import**(⚙️registry.js 增量)
5. P1 按需(1-2 项/轮), P2 增强, P3 内容域独立任务(可并行走 skill 提炼 P3-18)

每项开工前: 读来源仓对应源码 → 写 absorbed-from 头注 → CJS/ESM 对齐 → node:test 或 vitest 增量 → 真实闭环验证。
