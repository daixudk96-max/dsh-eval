# 评测 + 自进化架构：真实性核验、流程评估与整合方案

> 评估对象：2026-08-19 版《评测 + 自进化》架构文档（§1–§21）
> 核验基准：GitHub API / HTML 直查 18 个仓库 + arxiv、8 个关键仓库 README 全文、本机 DSH 源码（E:\github\dsh）与运行时（C:\Users\daixu\.dsh）
> 日期：2026-08

---

## 0. 一句话结论

**引用全部真实、能力描述基本准确、流程架构成立且与 DSH 原生机制高度兼容；但有 3 处选型定位需要修正（HarnessEval-W 是视觉世界评测、dsh-auto-review 是审批审查器、ZK 主干改造量大），整合路径 = 3 个自研插件 + 2 个系统 Preset + 业务 Preset 工具面收窄，可直接在本运行时用动态 Cordis Plugin 起步。**

---

## 1. 真实性核验（S1）：18 个仓库 + 论文全部真实存在

用 GitHub API（13 个）+ GitHub 网页状态码（5 个，API 匿名限流 403 后复验）+ web_search 完成。**无任何幻觉引用。**

| 仓库 | 存在 | 核验方式 |
|---|---|---|
| deepseek-ai/deepseek-harness（官方本体） | ✓ | API/HTML + 本机源码 |
| MirroS-Lab/HarnessEval-W（196★） | ✓ | API + README + arxiv |
| PerryLink/dsh-auto-review（40★） | ✓ | API + README |
| hccccc01333/dsh-eval | ✓ | API + README |
| ZK-Andy/dsh-continual-evolve（14★） | ✓ | API + README |
| ZTCNO0NE/dsh-loom | ✓ | API + README |
| lmzhen/dsh-evolution | ✓ | API + README |
| jasen215/dsh-continual-harness（4★） | ✓ | API |
| JayDong9130/dsh-evolution-lab | ✓ | API |
| Lhy723/dsh-self-evolution（2★） | ✓ | API + README |
| timwhitez/dsh-self-evolving（2★） | ✓ | API |
| shinjiyu/deepseek-harness-evolver | ✓ | API |
| tangzheng202202/dsh-retro / madage/dsh-self-improved / csyangwen/dsh-memory-evolve / houyongsheng/deepseek-harness-molt | ✓ | HTML 200 |
| arxiv 2608.16859「HarnessEval-W」 | ✓ | 多镜像 + 仓库内 Citation |

生态侧事实也属实：HarnessEval 由 15 家机构于 2026-08-18 发布；`dsh-evolution-lab`、`@lmzhen/dsh-evolution-*` 等 npm 包真实存在。

---

## 2. 能力描述核验（S2）：基本准确，3 处定位偏差/风险

| 文档说法 | 核验结果 | 判定 |
|---|---|---|
| HarnessEval-W 提供 Case-specific planning / Skill Registry / Atomic Sub-question / Evidence Tree | README 完全吻合（skill routing、sub-question+专职 sub-agent、parent 验证聚合、transparent evidence tree） | ✅ 准确 |
| ZK/dsh-continual-evolve 覆盖 prompt/memory/skill/subagent 版本化 mutation、审计、确定性 rollback、approval、benchmark 驱动 code-owned 验收 | README 完全吻合（4 类 versioned entries、inverse-op rollback、human approval、frozen 基准+非回归验收+两阶段 executor/reviewer+rubric AES 隔离） | ✅ 准确 |
| ZK"内部评测真值需替换为统一 ctx.eval；非 Logical Preset 版本模型" | 准确：它版本化的是 entry/state，内置 evaluate.ts 自包含 | ✅ 准确 |
| PerryLink/dsh-auto-review/eval 作"Shared Eval Core / 统一评测真值入口" | **主职是 approval 第二模型审查器**；捆绑的 dsh-eval CLI 确有 真实执行/trace/assertion/reviewer/report，但与 hccccc01333/dsh-eval 高度重叠 | ⚠️ 拔高 |
| hccccc01333/dsh-eval 提供 A/B、replay、cross-harness import、token/latency/cost/tool 指标 | README 完全吻合 | ✅ 准确 |
| dsh-loom：独立 verifier、expected trajectory、isolation、applyWithRollback、ledger | README 完全吻合（五步回路、核验器 LLM 不进判定、before/after 台账）；v1 只改 config/tool/skill | ✅ 准确 |
| lmzhen/dsh-evolution：Host+Evolution Preset 权限分层、approval/threat/state | README 完全吻合（模型可写域=memory+skills，其余 control plane） | ✅ 准确 |
| Lhy723/dsh-self-evolution 为"轻量闭环参考" | 实际**最接近文档完整闭环**：冻结 benchmark digest、Case×Run、候选白名单/路径防护、严格 `>` 门槛（平分回滚）、单调版本+快照、接受/拒绝/手工回滚——作用对象是 Agent Profile 目录 | ⚠️ 低估 |

### 三处必须修正的选型
1. **HarnessEval-W 是"视觉世界（world model/video）评测"**，不是通用 Agent 评测工具。把它当"范式"（自研 Eval Planner / Skill Registry / Evidence Tree）正确；把它当可 clone 的评测底座则踩空。
2. **统一评测真值入口应基于 hccccc01333/dsh-eval（+ PerryLink 的 dsh-eval CLI 作补充）自研 ctx.eval**，而不是 fork dsh-auto-review 本体（那是审批链审查器）。
3. **ZK 主干改造量大**（剥离内置 evaluate + 改 Candidate-first 整 Preset mutation + 接 PresetRegistry）；Lhy723/dsh-self-evolution 的"Profile 版本化闭环"其实更贴近目标骨架。建议 **Lhy723 做 Profile 级版本闭环骨架、ZK 做 entry 级（memory/skill/prompt/subagent）mutation 引擎**——二者互补而非二选一。

---

## 3. 流程符合性评估（S4）：架构成立，与 DSH 机制兼容

### 3.1 流程正确性
`request_evaluation（只读）→ EvaluationRun → 用户确认 → request_evolution（只写 Candidate）→ 同 Frozen Epoch 验证 → code Gate → 用户确认 → promote（current pointer）`——**符合"评测→进化"的正确语义**，且每一步在生态里都有先例：

- **评测/进化两信任域分离** = dsh-loom 的"核验器独立于改进模型"、dsh-continual-evolve 的"executor 永不见 rubric"、Lhy723 的"Evaluator/Optimizer 隔离"——生态共识，✅。
- **Candidate-first + Frozen Epoch** = Lhy723 的冻结 benchmark digest + 严格接受/回滚、dsh-continual-evolve 的 benchmark freeze + material-drift 检测，✅ 有现成实现可参照。
- **Code-owned Gate（非回归+关键维度+canary）** = 生态"model proposes, code guarantees"原则，✅。
- **Logical Preset + Immutable Revision + current pointer** = 文档最原创的部分；**DSH 原生机制正好兼容**（见 3.2）。
- **老 Session 不自动升级、新 Session 强制 resolveCurrent** = 与 DSH standing-mount 语义一致，✅。

### 3.2 与 DSH 原生机制的兼容性（本机源码实证）
- `AgentPresets` Service 提供 list/resolve/read/copy/remove/mount/recompose/composeFrom/serviceFor/defaultId/authorable + `agent-preset/selected` 事件——文档 §8 声称的底层能力**全部属实**。
- **standing mounts 按文件 file-stamp 区分 generation：运行中 Session 保留已挂载 generation，编辑文件只影响之后新建的 Session**（`packages/preset/agent-presets/src/index.ts` standing map 注释）→ 文档 §9.2/§15"current pointer 只控制新 Session、不强制迁移旧 Session"**直接成立**。
- **Discovery 不缓存**：新写入/删除的 preset 下次 list/resolve 立即可见（同一文件 "Discovery is unmemoized"）→ 文档 §15"新写入的 Preset 可被后续发现"**属实**。
- 官方 packages 中**没有** ctx.eval / ctx.evolution / presetRegistry → 文档"自研 + 插件化"前提成立。
- 用户 preset 根 `~/.dsh/.agent-presets` 当前未创建 → system-evaluator / system-evolver 落地无冲突。

### 3.3 需要补强的点
1. **resolveCurrent() 的强制点**：DSH 没有"Logical Preset"概念。实现上把 Logical Preset 作为 PresetRegistry 的产品层 ID（文档 §15 已正确指出），强制点 = 在 agent factory setup（调用 `agentPresets.mount` 的地方）包一层钩子：`logicalId → registry.resolveCurrent() → mount(physicalRevisionId)`，并把 revision+digest 固化进 Session header。
2. **Candidate 写权限**：Candidate 目录（如 `~/.dsh/.agent-presets/coding-candidate-*`）需靠 preset 工具面（agent.cordis.yml 工具过滤）+ 文件沙箱策略隔离；普通业务 preset 不放写工具。
3. **用户确认**：映射到 DSH approval/answerer 链（approval/asked → decided 事件），而不是自然语言提示。注意：当前会话 approval policy 被设为 never，生产部署必须开 human answerer（或借鉴 dsh-auto-review 的第二模型审查做半自动）。
4. **EvaluationEpoch 六重锁**：生态现有实现只覆盖部分（Lhy723 有 benchmark+profile digest；ZK 有 caseHash/material-drift）。六重全锁需自研，但模式已被证明。
5. **perCaseRegressionWithinTolerance / canary**：文档 Gate 公式里这两个目前无现成实现，需自研；canary 可复用 dsh-eval 的 benchmark.yaml（少量 case 先跑）。

---

## 4. 整合方案（S5）：以插件 + Preset 双层落进当前运行时

当前运行时：web profile 组合为空根 + bundles/patch 叠加（插件 = node_modules 包 + cordis.patch.yml）；本会话具备 dynamic Cordis Plugin 开发载体。

### 4.1 落地形态（三层）

**Layer 1 — 插件（profile bundle / 动态 Cordis Plugin）**
| 插件 | 职责 | 依据 |
|---|---|---|
| `preset-registry`（自研核心） | Logical Preset / Revision / Candidate / current pointer / history / GC；底层调 agentPresets.copy/resolve/mount；对外 `resolveCurrent(logicalId)`；状态存 `~/.dsh/preset-registry/` | 文档 §8/§9；DSH 完全空白 |
| `eval-adapter`（= ctx.eval） | 统一评测真值入口：Discovery/Validation 两模式、EvaluationEpoch 锁、EvaluationRun/Evidence/FailureSignature 输出；执行引擎优先 hccccc01333/dsh-eval，补充 PerryLink dsh-eval CLI | 文档 §4；修正 §2 偏差 |
| `evolution-controller`（自研确定性核心） | 状态机 proposed→candidate-created→validated→gate→promoted/rolled-back、code-owned Gate、promote/rollback、审计 | 文档 §14/§12 |
| `evolution-core`（可选接主干） | mutation 引擎：entry 级接 ZK/dsh-continual-evolve；Profile 级版本闭环参照 Lhy723/dsh-self-evolution | 修正 §2 偏差 |

**Layer 2 — Preset（`~/.dsh/.agent-presets/<id>/agent.cordis.yml`）**
- `system-evaluator`：只读工具面（评测执行端、EvalPlan/报告查看、Benchmark 管理）
- `system-evolver`：Candidate 写工具面（request_evolution 执行端、mutation、候选查看/丢弃）
- 业务 preset（coding/standard…）：agent.cordis.yml 只暴露 `request_evaluation` / `request_evolution` 两个窄工具，**不暴露任何 evolve_***（借 lmzhen 分层做法）

**Layer 3 — 钩子**
- agent factory setup 钩子：新 Session 走 `presetRegistry.resolveCurrent(logicalId)` 再 mount 物理 revision；Session header 固化 revision+digest+epochId
- 用户确认：approval answerer 链（human）承接"确认自进化 / 确认 Promote"

### 4.2 当前工作流的最小侵入整合
1. 不动现有 web profile 组合结构（仍空根+patch），新增插件走 `dsh plugin --profile web add` 或动态 define→run。
2. 先装 `dsh-eval`（hccccc01333）跑通 benchmark YAML → 立即获得"真实执行+指标+报告"的评测闭环，作为 ctx.eval 前身。
3. 用动态 Cordis Plugin 迭代自研 `preset-registry` 与 `evolution-controller`（define→run→inspect→修复，见效快）。
4. system-evaluator / system-evolver 建到 `~/.dsh/.agent-presets/`，业务 preset 不动，只在其上收窄工具面。
5. 关键权限（Candidate 目录只写、current pointer 只由 controller 写）通过 preset 工具面 + 沙箱策略落地。

### 4.3 MVP 顺序（对齐文档 P0–P9，收敛为 6 步）
1. **P1'** 装 dsh-eval，跑通 benchmark 评测（真值闭环第一步）
2. **P4'** preset-registry 插件（logical/current/rollback/digest）
3. **P8'** evolution-controller（gate + promote/rollback + 审计）
4. **P6'** system-evaluator / system-evolver 两个 preset
5. **P6''** 业务 preset 收窄为 request_* 两工具
6. **后置** HarnessEval-W 范式动态 EvalPlan / Evidence Tree；ZK 或 Lhy723 mutation 主干接入

---

## 5. 结论与建议

1. **信任度**：文档引用全部真实，核心机制（Logical Preset + Immutable Revision + current pointer、code-owned Gate、Frozen Epoch、权限分层）方向正确且与 DSH 原生语义兼容。可放心按此架构推进。
2. **必须先修正的三处**：HarnessEval-W 仅作范式（视觉世界评测，需自研通用化）；统一评测真值以 hccccc01333/dsh-eval 为底座自研 ctx.eval（不要 fork dsh-auto-review 本体）；ZK 主干改造量大，优先复用 Lhy723 的 Profile 版本闭环 + ZK 的 entry 级 mutation。
3. **落地**：当前运行时即可起步——先装 dsh-eval 跑通评测，再用动态 Cordis Plugin 迭代 preset-registry 与 evolution-controller，最后建两个系统 Preset 并收窄业务 Preset 工具面。

### 引用
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) · [MirroS-Lab/HarnessEval-W](https://github.com/MirroS-Lab/HarnessEval-W) · [HarnessEval-W Paper](https://arxiv.org/abs/2608.16859)
- [PerryLink/dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) · [hccccc01333/dsh-eval](https://github.com/hccccc01333/dsh-eval)
- [ZK-Andy/dsh-continual-evolve](https://github.com/ZK-Andy/dsh-continual-evolve) · [ZTCNO0NE/dsh-loom](https://github.com/ZTCNO0NE/dsh-loom) · [lmzhen/dsh-evolution](https://github.com/lmzhen/dsh-evolution)
- [Lhy723/dsh-self-evolution](https://github.com/Lhy723/dsh-self-evolution) · [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)
