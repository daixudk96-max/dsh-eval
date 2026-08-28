# 作用域化评测 / 进化 / 版本管理设计

日期: 2026-08-25 · 状态: 设计(未实施) · 触发: 用户问「如果不是针对全量(整个全域)进行评测计划和版本进化, 而是针对某一个目录或者某一个用户级别做评测、版本进化和版本管理, 具体要怎么做?」

## 0. 问题定义

现状: registry 单根(~/.dsh/preset-registry)、logical preset 单指针(pointers/<id>.current.json)、所有会话共享同一版本选择。用户想知道:

1. 在哪个地方选择「当前目录用的版本」?
2. 可以进行评测和进化的级别有哪些?(目录级? 用户级? 其他?)

## 1. 现状事实(实测)

- **registry**(packages/preset-registry/lib/registry.js): `pointers/<safeId>.current.json` 全局单指针(resolveCurrent@134 / promote@210,230 / rollback@246,248 均读它); 内容寻址 `revisions/<digest>/`; 历史链 `logical/<id>.json previous[]`(rollbackWindow=3); 审计 WAL。
- **DSH agent-presets 服务**(E:\github\dsh\packages\preset\agent-presets\src\): discovery.ts `USER_PRESET_DIR='.agent-presets'`, `scanRoot(root)` 扫描根目录下预设目录, 多根按优先级; preset.ts Plugin config `{default, roots}`; session.ts 会话绑定 = `'agent-preset/selected'` 事件(session.jsonl 内), `resolveSessionPreset(session)` 从事件重建, 会话有内容后锁定(preset-locked)。
- **会话 cwd**: session header 带 `cwd` 字段(必须绝对路径, core/session/src/types.ts:73,114); 会话文件按 `<DSH_HOME>/sessions/<cwd-bucket>/` 组织 → cwd 是会话固有属性, 可被前端读到。
- **dsh-eval-console 现状**: Config `{logicalId?, registryRoot?, auditFile?, agentPresetsRoot?}`(默认 ~/.dsh/.agent-presets); VersionSelect 已注册 `conversation.session.header.actions`(id 'eval-version', order 30); 已有 switch-revision 动作 = 同步 revision 内容到 `~/.dsh/.agent-presets/evaluate-<digest8>/`(用户级, 不动指针)。
- **评测/进化**: benchmark YAML 任意路径可跑(评测数据天然可按目录放); 进化链(proposal-check/overfit/threat/budget/near-dup/gate/promote approvalId)全部以 logicalId 为单元, 无 scope 概念。

## 2. 核心设计决策

### 决策 1: 进化与版本内容永远 user 级; 作用域只加「指针解析层」

- 版本产出(新 revision)始终进用户级 registry(单根、内容寻址、全局审计、预算/近重复/overfit 检查在单点做)。
- 目录级/会话级只是「选哪个既有版本」, 不 fork 内容、不复制 registry。
- 理由: ①preset 内容 = 角色能力, 不该按目录分叉(生态教训: dsh-evolve-modes 曾实现 project-scoped 后显式废弃回退 global-only, prompt.ts:30,165『All learned instructions are global』; continual-evolve project 第三层讨论落败——迁移 wire 成本 vs 守卫收益); ②内容分叉会破坏 near-dup/overfit/budget 的单点治理; ③用户真正需要的是「不同目录用不同版本、各自评测、各自记账」, 不是「不同目录有不同 preset 内容」。

### 决策 2: 目录级需要自己的内容变体时 = 派生独立 logicalId

- registry 已支持多 logicalId(每个有自己的指针/历史/审计)。
- 目录专属进化链 = 新 logicalId(如 `evaluate-team-a`), 从现有 revision fork 内容(registry.revisionContent → createCandidate → seal), 独立评测/进化/指针。
- 共享的只有基建(内容寻址、审计、预算框架、门禁)。

### 决策 3: 解析链(session override > workspace 绑定 > user 默认), 类 git config system→global→local

```
resolveEffectiveVersion(logicalId, { cwd }) =
  session 覆盖(会话事件, 不持久)         ||   // 最高优先
  workspace 绑定(最近祖先目录的绑定文件)    ||
  user 默认指针(pointers/<id>.current.json)  // 现状
```

## 3. 问题 1: 在哪个地方选择「当前目录用的版本」

三个选择位置(由浅入深):

### 3.1 会话头部下拉(已有 VersionSelect 扩展)——首选

- 下拉列表 = registry history(current + previous, 带 summary/时间戳, 已有)。
- **新增「绑定到此目录」动作**: 写 `<cwd 最近含 .dsh-eval/ 的祖先目录>/.dsh-eval/version.json`:
  ```json
  { "logicalId": "evaluate", "revisionId": "evaluate-94a7c40b", "digest": "94a7c40b…", "syncedAt": "…" }
  ```
- **新增「取消绑定」动作**: 删绑定文件 → 回落 user 默认。
- **显示当前生效作用域来源**: 下拉标题旁小标(user / workspace:<dir> / session)。
- 绑定文件可提交 git → 团队共享、多机一致(类似 .nvmrc / .node-version 模式)。

### 3.2 设置页(settings.section)——目录绑定管理

- 列出所有已有绑定文件(扫描各 workspace 的 .dsh-eval/version.json), 编辑/删除。
- 对应生态: AKS1st/dsh-skill-manager 的 settings 面板资源管理形态。

### 3.3 CLI(dsh-evolve --scope)

- `--scope dir:<path>` 让评测/进化绑定目录上下文(评测数据目录、budget 分账键、绑定写入)。
- 供脚本/CI 用(如 `dsh-evolve --scope dir:. --logical evaluate --benchmark …`)。

## 4. 问题 2: 可以进行评测和进化的级别

### 级别矩阵

| 级别 | 版本选择(指针) | 评测(数据/计划) | 进化(产出) | 记账/审计 |
|---|---|---|---|---|
| **user(用户级)** | 默认指针, 现状 | 默认 benchmark 集/样本 | 默认进化链(现状) | 现状 budget/审计 |
| **workspace(目录级)** | 绑定文件 → 指向 registry 内既有版本(决策 1); 或派生独立 logicalId(决策 2) | 目录内 benchmark.yaml/fixtures/样本会话(已支持任意路径); split dev/guard 已有 | 决策 1: 产出仍 user 级; 决策 2: 派生 logicalId 独立链 | budget 按 scope 分账(可选); 审计事件带 scope 字段 |
| **session(会话级)** | 临时选择(会话事件, 不持久; 参考 agent-preset/selected 事件先例) | 单次评测(现状即可) | 不进化(临时选择不产生版本) | 审计带 sessionId |
| host/machine | = user(同义) | — | — | — |

### 关键结论

1. **评测**: 评测数据(考卷/样本/夹具)天然按目录隔离(文件路径), 无需改造; 评测执行(隔离 temp DSH_HOME)无级别概念。需要新增的只是「评测与 scope 关联」(run.json 记 scope, 失败簇带 scope 标签喂 proposer)。
2. **进化**: 产出(新版本)永远 user 级——进化是全局的、共享的(决策 1)。目录级需要专属进化 = 派生独立 logicalId(决策 2)。
3. **版本管理**: 唯一真正新增的层 = 指针解析层(workspace 绑定 + session 覆盖), 全部指向 registry 内既有版本, 不复制内容。

## 5. 实现分层(具体怎么做)

- **P0(最小可用)**: workspace 绑定文件 + VersionSelect「绑定到目录/取消绑定」+ snapshot 显示作用域来源。改动: 新 `packages/dsh-eval-console/src/scope-resolve.ts`(纯函数: 按 cwd 向上找 .dsh-eval/version.json + digest 校验 + 解析链折叠), protocol.ts EvalSnapshot 增 `scope: {kind:'user'|'workspace'|'session', key?, revisionId?, source?}`, service.apply 增 switch-revision 写绑定文件分支(审计 `switch-to-revision` 带 scope), client VersionSelect 增绑定按钮 + 作用域标。
- **P1**: 评测关联 scope(run.json 记 scope; proposer evidence 带 scope; budget 按 scope 分账——BudgetLedger 增 scope 桶键)。
- **P2**: 派生 logicalId 工具(CLI: `dsh-evolve fork --logical evaluate --new-logical evaluate-team-a` → revisionContent → 初始安装 → 独立进化链)。
- **P3**: 会话级临时选择(写会话事件 eval-version/selected, 会话内生效; 重启后随会话保留——比不持久更自然, 但需与 DSH 会话事件机制对齐)。

## 6. 生态对照(已有调研, research/evolution-scope-permission-research.md)

- **dsh-evolve-modes**(EvolutionScope='global'|'project'): project 已废弃 → 教训: 内容层不做 project 分叉(与决策 1 一致)。
- **continual-evolve**(local/global 两层 + requireGlobalApproval): local=会话级, global=用户级晋升 → 与我们的 session 覆盖/user 默认同构。
- **claude-code #41280** / **genie #578**(project-scoped agent directory, 多工程师): 对应 workspace 绑定 + 派生 logicalId(多工程师各自目录各自进化链)。
- **Agent libOS**(arXiv 2606.03895): 授权矩阵 → 多 scope 下谁可写绑定/派生, 后续治理话题。

## 7. 待实施计划(用户 2026-08-25 定稿: 留待以后, 先固化)

### 版本选择器扩展: 三入口形态(方案 A + B)

目标: 「同一个 preset 二级选版本」的体验, 同时让新会话选择页保持干净。

- **A. 同步策略改为 evaluate 单目录**: 不再把每个版本同步成 `evaluate-<digest8>` 目录; 只保留一个 `evaluate` 目录, 其内容 = 当前选中版本。切换版本 = 更新 evaluate 目录内容(现有 switch-revision 机制改目标目录名)。清理已同步的 `evaluate-94a7c40b` / `evaluate-c4d8aec0` 遗留目录。
- **B. 设置页二级区块**(settings.section, 新注册): 「evaluate」卡片 → 二级版本列表(带 summary/时间戳/批准人, 数据已有) → 点击切换(evaluate 目录内容更新 + 审计 `switch-to-revision` 带 scope)。
- 三入口最终形态:
  - 新会话选择页: 只有一个「evaluate」(永远 = 当前版本, 不脏不乱)
  - 会话进行中: 头部下拉切版本(已有 VersionSelect)
  - 设置页: evaluate ▸ 二级版本列表(切换/绑定/回滚)
- 前置: 原生选择页无法做二级(ui-agent-preset 按目录扁平渲染, 插件无插槽), 故二级放设置页。
- 关联: 目录级绑定(workspace 绑定文件 .dsh-eval/version.json)与作用域解析链见 §2-§5, 同批或后续实施。

## 8. 风险与开放问题

- **绑定文件跨机**: revisionId 在另一台机器 registry 不存在 → 启动时 digest 校验 + 提示「该版本未同步, 请先 export/import 或重新绑定」。
- **cwd 向上查找开销**: 绑定文件查找每次快照/挂载触发 → 缓存(按 cwd 缓存最近祖先 + mtime)。
- **session 覆盖持久性**: P0 不做(不持久, 仅当前会话内存态); P3 事件化需查 DSH 会话事件 schema 扩展成本。
- **绑定写权限**: workspace 文件写入 = 目录级写权限, 与 registry 用户级写权限分离; 是否需要 ACL(仅 system-evolver 可写)留后续。
- **派生 logicalId 命名**: 需防与现有逻辑冲突(preset id 规则 [a-z0-9][a-z0-9-]*)。
