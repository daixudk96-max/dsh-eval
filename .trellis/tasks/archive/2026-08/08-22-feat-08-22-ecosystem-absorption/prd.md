# 生态基座吸收与改造（rubric 集成 + 模块吸收）

## Goal

把生态参考项目的既有实现按「同语言直接改 / 不同语言按架构改写」的原则吸收进本平台,
消除机制层重复造轮子;并将「确定性 Code Gate」扩展为「确定性 gate + rubric 质量评分」两层判定。
权威来源:research/evolution-plan.md(吸收/改造唯一权威清单)。

## Requirements

1. **同语言基座直接改**: hccccc01333/dsh-eval(已移植为 `packages/dsh-eval` lib/)——
   13 个对应文件只做增量修改(加字段/加分支),不重写主体逻辑;4 个适配层保留。
   - 每个被改动的模块头部加 `# absorbed-from: <repo>/<file>` 追溯注释。
2. **不同语言按架构改写**: TS 项目(continual-evolve / self-evolving / dsh-evolution / Lhy723)
   先拆模块,按对方架构用 CJS 零依赖实现;模块三选一: `直接改` / `改写` / `印证已有`,
   明确「放弃」的不实施。逐项按 evolution-plan.md §3 执行。
3. **R2 rubric 集成(本任务 P0 核心)**: Code Gate 只判确定性事实,覆盖不了「质量」——
   增加 rubric 层: LLM judge 按 rubric 逐 cell 打分,代码聚合(失败 cell 排除),
   gate 判定 rubricScore ≥ rubricMinScore 且无 rubric 维度回归;两层都过才 PROMOTED。
4. **R3 评测侧工程化(P1)**: benchmark `split` 字段(dev/guard 切分) + runner fail-closed
   (缺失/损坏/超时默认 FAIL, 仅白名单 infra 可重试)。
5. **R4 进化侧(P2)**: proposer(失败证据 → 多假设候选 + preservation tests,
   拒绝 no-change/test-only/comment-only) + budget ledger(不信候选自报) +
   近重复检测入 promote。
6. **R5 治理(P3,可选)**: 审查脱敏(照 lmzhen evolution-review/redact)、失败类聚合。

## Constraints

- **语言**: 所有落地代码 CJS(零依赖), 可被任意 DSH 进程 require; 不引入 TS 构建链。
- **上游只读**: research/ 下 clone 的参考仓库只读, 不 fork、不提交回上游。
- **评测只读 / 进化只写**: 信任域分离不变; promote 必须绑定 approvalId 人审。
- **诚实标注**: 评测引擎受限时如实记录, 不伪造评测分数; rubric 数据源(人工/归纳)如实标注。
- **真实验证**: 每阶段以真实运行(benchmark / evolution-real 脚本)验证, 不以演示数据冒充。
- **沙箱**: 本会话 approval never + danger-full-access, 不请求 escalation; node --test 用单进程模式。

## Acceptance Criteria

- [ ] **AC1**: rubric.js(AES-256-GCM 加密 `v1:` 信封 + 密钥解析 4 级)单测通过
- [ ] **AC2**: aggregate.js(失败 cell 排除、case 均值、overall)单测通过
- [ ] **AC3**: gate.js 新增 rubric 规则(rubricScore < min → FAIL; 维度回归 → FAIL; 全过 → PASS)三态单测
- [ ] **AC4**: controller.evaluate() 透传 rubric 输入, 真实 evolution-run 一轮跑通(PROMOTED 含 rubric 证据)
- [ ] **AC5**: benchmark.yaml 支持 split(dev/guard) + runner fail-closed; dev/guard 双集跑通
- [ ] **AC6**: 失败→候选的 proposer 脚本可运行(真实失败簇输入 → 输出 ≥1 个不同 hypothesis 的候选)
- [ ] **AC7**: budget ledger 记账(proposal/solver/辅助/failed 分类)单测通过
- [ ] **AC8**: 每个被吸收模块头部有 `absorbed-from` 注释; evolution-plan.md 勾选状态表与实施一致

## Notes

- 复杂任务: 已按 workflow 要求补齐 `design.md`(技术设计)与 `implement.md`(执行清单)。
- 历史决策与真实性核验见 research/reference-absorption-plan.md(附录级, 不重复)。
