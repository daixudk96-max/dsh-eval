# 评测与自进化系统 —— 技术设计（design.md）

> 本文件是父任务的技术权威：总体架构、ADR D1–D9、运行时契约（§A–§E）、权限边界、数据契约、风险缓解。各子任务的实现细节在其自身 `design.md`/`implement.md` 中。

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 业务 Agent（coding/review/… preset）                          │
│  只暴露 request_evaluation / request_evolution（2 个窄工具）   │
└───────────────┬──────────────────────────────┬──────────────┘
                │ request_evaluation (只读授权)  │ request_evolution (显式用户确认)
                ▼                              ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ ctx.eval（只读评测域）        │  │ ctx.evolution（只写 Candidate）│
│  Discovery / Validation 模式  │  │  RCA → Proposal → Mutation    │
│  EvaluationEpoch 六重锁        │  │  → Candidate 目录              │
│  EvaluationRun / Evidence     │  └──────────────┬───────────────┘
└──────────────┬───────────────┘                 ▼
               │                             Candidate
               ▼                         （staging/ 下隔离）
      FailureSignature/Cluster                 │ 同一 Frozen Epoch 验证
               │                              ▼
               └────────────► ctx.eval（Validation，Baseline vs Candidate）
                                        │
                                        ▼
                          ┌──────────────────────────────┐
                          │ evolution-controller（确定性）  │
                          │  Gate(PASS/FAIL/INCONCLUSIVE)  │
                          │  seal → promote / rollback    │
                          │  CAS + 审计                    │
                          └──────────────────────────────┘
                                        │
                                        ▼
                          ┌──────────────────────────────┐
                          │ preset-registry              │
                          │  Logical Preset / Revision   │
                          │  / Candidate / current ptr   │
                          │  resolveCurrent()            │
                          └──────────────────────────────┘
```

## 2. 模块与职责

### 2.1 preset-registry（自研核心，DSH 完全空白）→ 子任务 `08-19-preset-registry`
- 数据：`~/.dsh/preset-registry/` 下 `logical/<logicalId>.json`（current/previous/candidates）、`revisions/<digest>/`（内容寻址存储，seal 后只读）、`pointers/<logicalId>.current.json`、`ledger/`（append-only）、`staging/`（Candidate 隔离区）。
- API：`resolveCurrent` / `createCandidate` / `patchCandidate` / `sealRevision` / `promote`（CAS）/ `rollback`（O(1)）/ `history` / `gcCandidates` / `gcRevisions`（受 R10 保护）。
- 底层依赖：`ctx.get('agentPresets')`（copy/resolve/mount）；mount 时始终传 **physical revisionId**，Logical Preset 仅是产品层 ID。

### 2.2 eval-adapter（= ctx.eval，统一评测真值）→ 子任务 `08-19-eval-adapter-spike`
- **M1 决策（2026-08-19，见 `research/m1-spike-report.md`）**：当前 DSH 为 `0.1.0-rc.5`，`dsh-eval@0.3.0`（MIT）peer 要求 `@deepseek-ai/* ^0.1.0-rc.6` → 直接依赖 **NO-GO**。
  - **本轮采用**：自研最小 runner 作为执行层（benchmark YAML schema 对齐 dsh-eval 0.3.0：`name/model/profile/command/trials/timeoutMs/seed/cases(id,prompt,workspace,expected.tool|check)/pricing`），以 headless DSH 子进程执行、收集 trace、产出 `EvaluationRun` 契约。
  - **切换点**：DSH 升级至 `rc.6+` 后，安装 `dsh-eval@0.3.0`（`dsh plugin --profile eval add dsh-eval`）走 wrap-CLI 路线；最小 runner 保留为 fallback/离线路径。
- 输出契约：`EvaluationRun { id, subject, mode, evaluationEpochId, planIds, scores, assertions, evidenceTreeRef, failureSignatures, artifacts }`。
- 两模式：Discovery（允许动态、产出诊断）vs Validation（Frozen，仅供 Gate）。
- 硬规则：确定性事实（exitCode/schema/digest/tool error/指标）由代码判定；LLM judge 仅处理语义维度（需求遵循/过度实现/误导性说明）。

### 2.3 evolution-core（mutation 引擎）→ 供子任务 `08-19-evolution-controller` 使用
- entry 级：`ZK/dsh-continual-evolve`（prompt/memory/skill/subagent 版本化 mutation、rollback、approval）→ 输出 Candidate 内 entry 变更。
- Profile 级：参照 `Lhy723/dsh-self-evolution` 的冻结 benchmark + 候选白名单 + 路径防护 + 严格 `>` 门槛 + 快照验证，改造为对 Candidate 目录生效。
- 产出：MutationRecord[] + Candidate digest 变化；**永不直接写 current**。

### 2.4 evolution-controller（自研确定性核心）→ 子任务 `08-19-evolution-controller`
- 状态机：`DRAFT → SEALED → EVALUATING → ACCEPTED | REJECTED | INCONCLUSIVE → PROMOTED | FAILED`（见 §B）。
- Gate（代码，见 §B.3）：PASS / FAIL / INCONCLUSIVE / INVALID。
- Promote：调用 preset-registry 的 CAS 事务；approvalId 由用户确认事件绑定（approval/asked → decided）。
- 审计：每个决策 append 到 `ledger/`（before/after、理由、证据 refs、gateRunId、ruleSetVersion、approvalId）。

### 2.5 权限与信任边界（Host 层强制）→ 子任务 `08-19-system-presets` / `request-api-integration`
| 组件 | 可写 | 禁止 |
|------|------|------|
| Business Agent | 业务工作区；request_* | Eval 真值、Candidate、current pointer |
| system-evaluator preset | EvaluationRun/Evidence/Report | 业务代码、Candidate、Rubric/Benchmark 自修改 |
| system-evolver preset | Candidate 内容、EvolutionRun | Source Revision、Eval Core、Gate、current pointer |
| Controller | Gate 决策、promote/rollback、审计 | 生成语义评测结论 |
| 用户 | 确认 Evolution / 确认 Promote / 手工 Rollback | — |

- 实现：Host Service 方法签名级 capability 检查（调用者 fiber/身份），而非 `presetId === 'system-evolver'` 字符串判断；Preset 工具面只负责「可见性」，不承担安全边界。

## 3. 与 DSH 原生机制集成

- **agent factory setup 钩子**：新 Session 创建时用 `presetRegistry.resolveCurrent(logicalId)` 取代直接 mount 物理 presetId；把 revision+digest 写入 Session header。
- **standing mounts**：`agentPresets.mount()` 天然保留老 Session generation —— 直接复用，不做额外迁移逻辑。
- **用户确认**：走 DSH approval answerer 链（`approval/asked → decided` 事件）；可借鉴 `PerryLink/dsh-auto-review` 的第二模型审查做半自动（生产须保留 human answerer）。
- **组合方式**：插件以 profile bundle（`dsh.bundle` + cordis.patch.yml）安装进 web profile（空根 + patch 叠加模型）；开发期用动态 Cordis Plugin（define → run → inspect → 修复）迭代。
- **Epoch 冻结**：benchmark 目录放 Target workspace 之外；digest 纳入 Benchmark/EvalPlan/Rubric 全部资产。

## 4. 关键数据契约

```ts
EvaluationRun { id; subject; mode:'discovery'|'validation'; evaluationEpochId; planIds; scores; assertions; evidenceTreeRef; failureSignatures; artifacts }
EvolutionRun  { id; source; triggerEvaluationRunId; selectedFailureClusters; userApprovedAt; proposal; mutations; candidate?; validation?; decision:'proposed'|'candidate-created'|'rejected'|'accepted'|'promoted'|'rolled-back'; promotedRevision? }
PresetRevision{ logicalId; revisionId; digest; parentRevision?; sourceEvolutionRunId?; createdAt; sealedAt; status:'active'|'previous'|'retired' }
EvaluationEpoch{ benchmarkVersion; benchmarkDigest; evalPlanVersion; planSetDigest; skillRegistryVersion; digest; rubricVersion; digest; evaluatorVersion; aggregationPolicyVersion }
SessionHeader { logicalPreset; revision; presetDigest; evolutionRunId?; evaluationEpochId? }
```

## ADR（架构决策记录）

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| D1 | 评测与自进化 | 分离两个信任域，Controller 编排 | 防止 Candidate 改评分真值；评测可独立复用 |
| D2 | 统一评测真值 | 自研最小 runner（本轮，因 DSH rc.5 < dsh-eval peer rc.6 直装 NO-GO）；DSH 升 rc.6+ 后切换 `dsh-eval@0.3.0` wrap-CLI | 证据见 `research/m1-spike-report.md`；非 fork dsh-auto-review |
| D3 | Mutation 引擎 | entry 级用 `ZK/dsh-continual-evolve`；Profile 级闭环参照 `Lhy723/dsh-self-evolution` | ZK 改造量大；Lhy723 更贴近整 Preset 版本闭环 |
| D4 | 权限 | Host Service 内 capability 检查 + Preset 工具面双重 | Preset 名称不是安全边界 |
| D5 | 版本发布 | Immutable Revision + CAS current pointer（内容寻址 + WAL） | O(1) Promote/Rollback；防 TOCTOU；崩溃可重放 |
| D6 | 老 Session | 不自动升级 | 保证工具/Prompt/历史可重放 |
| D7 | 新 Session | 强制 resolveCurrent(logicalId) | 统一最新版本入口 |
| D8 | Gate | 代码拥有 + 统计阈值 + blind holdout（服务级隔离） | 禁止 LLM 自证；防 benchmark 过拟合 |
| D9 | 落点 | 独立实现仓库 `E:\github\dsh-eval` + profile bundle 集成；`E:\github\dsh` 只读 | 与 DSH「空根+patch」组合模型一致；不侵入 DSH monorepo |

## A. 运行时契约：`request_*` 异步结果如何返回

业务 Agent 只有两个入口；每个请求是一个**异步 Job**：

```ts
RequestJob {
  requestId;            // 唯一
  type: 'evaluation' | 'evolution';
  idempotencyKey;       // 幂等键：同键重复提交去重
  status: 'queued'|'running'|'succeeded'|'failed'|'cancelled'|'timeout';
  createdAt; startedAt?; finishedAt?;
  budget: { maxTokens?; maxRuns?; deadline? };   // 预算与截止
  resultRef?;           // EvaluationRun / EvolutionRun id
}
```

- **查询**：两个工具均支持 `submit` / `status` / `result` 操作（同一窄工具，不新增第三个工具）；或由 Controller 通过 **Session 事件**投递最终结果。
- **语义**：幂等键去重；超时/取消/预算/并发上限由 Controller 强制执行；失败允许按 requestId 重试（新 requestId 或同键重试由调用方选择）。
- **隔离**：业务 Agent 拿不到底层 evaluator/controller 能力（Host capability 层拒绝）。

## B. 运行时契约：Candidate 状态机与封存

```
DRAFT → SEALED → EVALUATING → ACCEPTED → PROMOTED
                          ↘ REJECTED
                          ↘ INCONCLUSIVE（→ 采样重跑 → 回 EVALUATING）
                          ↘ INVALID（协议失败，如 digest 漂移）
```

- `DRAFT` 可写；`SEALED` 后内容与父 Revision 不可改（registry 只读区 + digest 校验）。
- Epoch 绑定 Candidate hash；Gate 只接受已封存 Candidate。
- Promote 前重新校验 Candidate digest 与 baseline revision；Promote 用 CAS，current 已变化则失败而非覆盖。

## C. 运行时契约：Blind holdout 服务级隔离

- 不能只在 Prompt 中告诉 evolver「不要看 holdout」；必须 Host capability 强制：
  - system-evolver 无法读取 holdout 原始 case / 答案 / evaluator 内部 Prompt；
  - Candidate 无法访问 evaluator 内部 Prompt、答案与判定器；
  - evaluator 只向 evolver 提供聚合结果或脱敏失败分类；
  - trace 默认做密钥、用户数据与答案泄漏清理；
  - 候选输出作为不可信输入处理（防 judge prompt-injection，fail-closed）。
- 完整实现落在 `08-19-security-hardening`；`08-19-evolution-controller` 预留 holdout 接口位。

## D. 运行时契约：外部依赖兼容性 Spike（M1 前置）

- M1 go/no-go 检查清单：固定 commit SHA / 发布版本；许可证；直接依赖 vs 包装 CLI vs 抽取核心；Windows 路径与子进程行为；DSH headless Session 接入；失败 → 自研最小 runner fallback。
- 决策物写回 §2.2 与 ADR D2；被 M2 采用。

## E. 运行时契约：Gate ruleSet 版本化

- Gate 规则集版本化并绑定 Epoch；禁止静默改规则 —— 改动必须产生新 ruleSet + 新 Epoch，历史 run 可复现。

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM judge 波动导致误 Promote | paired runs + minEffect + INCONCLUSIVE 三态 + holdout |
| benchmark 过拟合 | blind holdout 服务级隔离（Evolver 不可见）；Epoch 六重锁 |
| Promote TOCTOU | CAS 事务（expectedCurrent + digest + gateRunId + approvalId） |
| Preset 文件被绕过修改 | revisions/ 只读区 + digest 校验 + authoring API 拒绝 |
| 老 Session 引用被 GC | GC 保护 SessionHeader 引用（R10） |
| 权限靠 Preset 名 | Host capability 检查（R1/D4） |
| dsh-eval 集成失败 | M1 go/no-go + 自研最小 runner fallback（ADR D2） |
| 崩溃写坏 pointer | WAL（先 ledger 后 rename）+ 重放恢复 |
| HarnessEval-W 范式误用 | 仅范式后置，MVP 用确定性 EvalPlan + 指标 |

## 6. 里程碑 → 子任务映射

| 里程碑 | 子任务 |
|--------|--------|
| M1 评测闭环（eval-adapter + dsh-eval go/no-go） | 08-19-eval-adapter-spike |
| M2 版本骨架（preset-registry） | 08-19-preset-registry |
| M3 治理核心（evolution-controller） | 08-19-evolution-controller |
| M4 系统 Preset | 08-19-system-presets |
| M5 入口收窄 | 08-19-request-api-integration |
| M6 强化 | 08-19-security-hardening |
