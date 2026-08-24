# 进化作用域与权限模型 — 生态调研(2026-08-24)

> 触发:用户提问「进化针对哪个项目/预设/工作台/角色?权限谁控制?边界是啥?每个预设的进化是全局还是目录集的?」
> 方法:本地 9 个 GitHub 克隆仓库源码级 grep + web 搜索(agent-evolution-protocol / Agent libOS / Claude Code / genie)

## 一、生态中的作用域模型(进化对象范围)

| 模式 | 代表 | 语义 | 现状 |
|---|---|---|---|
| **global-only(全局单一)** | [dsh-evolve-modes](https://github.com/GraySilver/dsh-evolve-modes)(prompt.ts:30,165) | 曾支持 global/project 两层,现**显式废弃 project-scoped**:『All learned instructions are global and apply across projects. Never create a project-scoped instruction.』project-scoped proposal 直接 throw | 回退到全局。理由:跨项目噪声 vs 维护成本,project 层不值得 |
| **local/global 两层** | [ZK-Andy/dsh-continual-evolve](https://github.com/ZK-Andy/dsh-continual-evolve)(README.md:20,28) | local=per-session,global=cross-sessions(merge 语义);全局写入需人工审批;机械晋升守卫只晋升可移植/非薄内容;曾讨论加 project 第三层**落败**(迁移 wire 格式/寻址路径成本 vs 守卫+目录 cap+demote 已解决痛点,2026-08-22-sediment-quality-token-economy.md:15,20) | 两层 + 审批门 |
| **global/project 中间层(活跃需求)** | [anthropics/claude-code #41280](https://github.com/anthropics/claude-code/issues/41280)「intermediate scope between Global and Project」; [automagik-dev/genie #578](https://github.com/automagik-dev/genie/issues/578)「project-scoped agent directory — allow multiple engineers across projects」 | 用户级与项目级之间需要中间层;项目级隔离 = 多工程师/多项目共享 | 讨论中,未定型 |
| **workspace 边界(内容层)** | [Lhy723/dsh-self-evolution](https://github.com/Lhy723/dsh-self-evolution)(benchmark.js:94-97) | benchmark 私有 rubric **必须在 target workspace 外**(isPathWithin 校验),防污染被测工作区 | 内容边界强制 |
| **条目级进化单元** | continual-evolve(SKILL.md) | 进化对象 = 具体条目(prompt note/memory/skill/subagent-spec),非整 preset | 比我们更细粒度 |
| **插件代码级进化单元** | [timwhitez/dsh-self-evolving](https://github.com/timwhitez/dsh-self-evolving) | 候选 = Cordis 插件源码,TCB 只可改声明包 | 最重粒度 |

## 二、权限/边界控制模式(生态做法)

1. **人审拍板**(最普遍):continual-evolve `requireGlobalApproval`(全局写入询问用户);**我们更强** = promote 代码级强制 approvalId(无则 throw)。
2. **三区安全架构**:[YIING99/agent-evolution-protocol](https://github.com/YIING99/agent-evolution-protocol) —— AI 自主学 + 人类保持控制的显式三区隔离(safe/transparent/human-controlled)。
3. **能力控制授权**:[Agent libOS](https://arxiv.org/abs/2606.03895)(arXiv 2606.03895) —— 运行时授权矩阵,agent 能力边界,自我进化受 capability 约束。
4. **机械晋升守卫**(防垃圾晋升):continual-evolve 只晋升可移植条目 + promotionBlockPatterns(POSIX 路径/session ids/~/.dsh 不晋升);**我们** = proposal-check(no-change/test-only/comment-only/overfit)+ near-dup + threat 扫描 + budget。
5. **预算边界**:timwhitez/dsh-self-evolving budget ledger + 我们 BudgetLedger。
6. **信任域分离**:评测只读 vs 进化只写(我们进程边界 spawn;self-evolving provider 凭据不进 proposer sandbox)。

## 三、结论:我们的定位与建议

### 现状(事实)
- 进化单元 = **logical preset**(角色级,目前 1 个:`evaluate`,6 代 revision);registry 用户级全局 `~/.dsh/preset-registry/`;promote 人审(approvalId 强制)是唯一硬门禁;createCandidate/seal 无 ACL;审计 append-only。
- 与生态对照:**形态与 evolve-modes 的 global-only 回归一致**(preset 内容跨项目共享是特性不是缺陷);审批比 continual-evolve 更强;机械守卫覆盖比生态全(proposal-check/near-dup/threat/budget/overfit/frozen)。

### 建议(回答用户问题)
1. **进化针对什么**:针对**角色预设**(logical preset = 一个 agent 角色),不是 workspace、不是项目目录、不是全部预设。目前只进化了 `evaluate` 评测角色(6 代,内容:compare 命令/进化闭环指引/YAML 结构修复/效率提升)。
2. **全局还是目录集**:preset 内容 = **全局**(跨 workspace 共享,与 evolve-modes global-only 结论一致);需要 project 级隔离的场景是**评测数据/预算/审计**(genie #578 的多工程师场景),不是 preset 内容——若未来多项目共用 registry,按 project 分 budget/audit 子域,preset 保持全局。
3. **权限谁控制**:单用户本机 = 人审(promote approvalId)+ 机械守卫(proposal-check/near-dup/threat/budget)+ 审计;若多用户/多角色 = 需加「进化发起者 ACL」(仅 system-evolver 可 newRun)+ logicalId owner 概念(参考 Agent libOS 授权矩阵)。
4. **边界**:内容边界(只改自己 logicalId 的文件,TCB 同 self-evolving);作用域边界(不碰其他 logical preset);数据边界(frozen epoch:基准材料锁定,防污染,同 dsh-self-evolution 的 workspace 外 rubric 思想);行为边界(promote 人审,失败候选只写审计不碰 current)。
5. **UCB-Air 前置**:多候选并行(expand 多个候选 + 并行评测)是 UCB 调度的前提——命令面补全(--export/--budget/--registry)先行,再做多候选基础设施。

### 参考链接
- https://github.com/GraySilver/dsh-evolve-modes
- https://github.com/ZK-Andy/dsh-continual-evolve
- https://github.com/anthropics/claude-code/issues/41280
- https://github.com/automagik-dev/genie/issues/578
- https://github.com/YIING99/agent-evolution-protocol
- https://arxiv.org/abs/2606.03895 (Agent libOS)
- https://github.com/Lhy723/dsh-self-evolution
