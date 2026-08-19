# Findings：仓库真实性与能力核验（S1-S3 完成）

## S1 仓库存在性核验 —— 全部真实
方法：curl 直连 GitHub API（13 个成功）+ GitHub HTML 状态码（5 个，因 API 匿名限流 403 误报后复验全部 200）+ web_search（arxiv 论文）。

| 仓库 | 存在 | Star | API 描述（权威，截断） |
|------|------|------|------|
| MirroS-Lab/HarnessEval-W | ✓ | 196 | Agentifying the Evaluation of Visual Worlds |
| PerryLink/dsh-auto-review | ✓ | 40 | Second-model AI auto-review for DSH approval requests: read-only reviewer subagent returns structured verdict |
| hccccc01333/dsh-eval | ✓ | 1 | Agent evaluation platform for DSH: benchmark YAML, headless orchestration, trace metrics, LLM judge |
| ZK-Andy/dsh-continual-evolve | ✓ | 14 | Continual self-evolution plugin: versioned, auditable, rollback-safe harness state refined from sessions |
| ZTCNO0NE/dsh-loom | ✓ | 1 | Loom (织机) — external coach / second verifier |
| lmzhen/dsh-evolution | ✓ | 1 | Hermes-inspired agent self-evolution plugin family |
| jasen215/dsh-continual-harness | ✓ | 4 | continual self-evolution: persistent memory, periodic review-and-refine |
| JayDong9130/dsh-evolution-lab | ✓ | 0 | Proof-carrying Skill self-evolution |
| Lhy723/dsh-self-evolution | ✓ | 2 | Benchmark-driven: 冻结基准上 评测→候选→严格接受/回滚 |
| timwhitez/dsh-self-evolving | ✓ | 2 | Evidence-first, crash-resumable self-evolution engine |
| shinjiyu/deepseek-harness-evolver | ✓ | 1 | stage, score, solidify in-memory plugin trials to disk |
| tangzheng202202/dsh-retro | ✓ | html 200 | — |
| madage/dsh-self-improved | ✓ | html 200 | — |
| csyangwen/dsh-memory-evolve | ✓ | html 200 | 五轨记忆+技能自我进化+会话评审 |
| houyongsheng/deepseek-harness-molt | ✓ | html 200 | — |
| deepseek-ai/deepseek-harness | ✓ | html 200 | 官方本体（本机 E:\github\dsh 即此） |

arxiv 2608.16859「HarnessEval-W」✓（bytez/alphaxiv/hyper.ai/arxiv 均有）。

## S2 能力描述核验（对照 8 个 README）
- **HarnessEval-W** ✓：Case-specific skill routing / 子问题分解+专职 sub-agent / 父 agent 验证聚合 / transparent evidence tree / arXiv 论文。⚠️ **定位：视觉世界（world model/video）评测**，非通用 Agent 评测。文档将其作为"范式"借鉴是正确的，但不能 clone 即用。
- **ZK-Andy/dsh-continual-evolve** ✓：prompt/memory/skill/subagent 四类 versioned entries、evidence trail、确定性 inverse-op rollback、human approval(global)、benchmark-driven validation（code-owned 聚合、非回归验收、rubric AES-256-GCM 隔离、两阶段 executor/reviewer、failure-cell 协议）。⚠️ 文档判断准确：它版本化的是 **entry/state**（非整个 Preset）；内置 evaluate.ts 是自包含真值（非统一 ctx.eval）。
- **PerryLink/dsh-auto-review** ⚠️：**主职是 approval answerer（第二模型审查批准链）**，不是评测核心。捆绑的 `dsh-eval` CLI 确含真实执行/trace/assertion/reviewer/report，与 hccccc01333/dsh-eval 功能高度重叠。文档将其列为"统一评测真值入口"**略拔高**。
- **hccccc01333/dsh-eval** ✓ 完全吻合：A/B compare、keyless replay、cross-harness import(codex/claude-code)、token/latency/cost/tool metrics、benchmark.yaml、headless 执行、LLM judge。**最匹配"Shared Eval Core 主干"**。
- **ZTCNO0NE/dsh-loom** ✓：独立核验器（隔离真实执行+预期轨迹对齐，LLM 不进判定）、执行器安装/回滚、ledger（before/after+证据）、五步回路 观察→判断→设计→核验→安装。⚠️ v1 只改 config|tool|skill，loop 锁死；"外部教练治理"定位准确。
- **lmzhen/dsh-evolution** ✓：Host(无工具) + Evolution Preset(才暴露 memory/skill_manage)、approval 分层、threat 检查、state 分层（JSON provider）、Capability governance。⚠️ "模型可写域=memory+skills，其余全 control plane" 与文档描述一致。
- **Lhy723/dsh-self-evolution** ⚠️重要补充：**最接近文档完整闭环的现成实现**（冻结 benchmark digest、Case×Run、候选白名单+路径防护、严格 > 门槛、平分回滚、单调版本+快照、接受/拒绝/手工回滚），但作用对象是 **Agent Profile 目录（AGENTS.md/runtime.json/skills/config）**，非 Logical Preset+current pointer。文档列为"轻量闭环参考"合理，但可能**低估**了其可复用性。
- **csyangwen/dsh-memory-evolve**：记忆/待办/技能/评审插件，非 eval 核心，文档未作主干正确。

## S3 DSH 本机能力核验
- 官方 packages 中 **无** ctx.eval / ctx.evolution / presetRegistry（grep evolution|presetRegistry|ctx.eval 零命中）→ 文档"必须自研+插件化"的前提成立。
- **AgentPresets Service 真实 API**（packages/preset/agent-presets/src/index.ts）：
  - Config: { default, roots[{path,trust:system|user}], includeUserRoot }；user root = ~/.dsh/.agent-presets
  - defaultId / list() / resolve(id?) / resolveMountable / mount / recompose / composeFrom / copy / remove / read / serviceFor / composedPreset / standingKeyFor；事件 agent-preset/selected
  - **standing mounts 按文件 file-stamp 分 generation：老会话保留已挂载 generation，文件编辑只影响之后新会话** → 与文档 §9/§15 的"current pointer 只控制新 Session"语义完全兼容 ✓
  - Discovery 不缓存：新写入/删除的 preset 下次 list/resolve 立即可见 ✓（文档 §15 声称属实）
- 运行时组合（C:\Users\daixu\.dsh\profiles\web\cordis.yml = 空根 `[]`）：组合由 bundles + cordis.patch.yml 叠加；插件=node_modules 包+patch。已装：@dsh-external/workflow、@dsh-external/tdd-pipeline、dsh-test-runner、dsh-active-context-pruning、dsh-plugin-clinic、dsh-capability-inspector、@dsh-adaptive/*、@xilin3/dsh-prompt-persona 等。
- 用户 preset 目录 ~/.dsh/.agent-presets **尚未创建**（glob 报不存在）→ 新建 system-evaluator/system-evolver 无冲突。
- 本会话具备 dynamic Cordis Plugin 机制（cordis_define/cordis_run），可作插件开发与试运行载体。
