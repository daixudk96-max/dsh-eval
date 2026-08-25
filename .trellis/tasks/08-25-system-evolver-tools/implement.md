# implement.md — system-evolver 工具面接线

> 执行者: AgY(盲执行, 无会话上下文)。此文件自包含, 按序执行。
> 仓库: E:\github\dsh-eval。测试形态: evolution-controller/preset-registry 用
> node:test 单进程(`node test/<file>.test.js`, 勿用 `node --test` 目录=spawn EPERM)。

## P1. 插件 `evolution-tools.js`(核心)

新建 `packages/system-presets/plugins/evolution-tools.js`(ESM, import-free 形态):

```js
export const name = 'system-evolution-tools'
export const inject = ['tools']
export function apply(ctx, config) { /* 注册 4 工具 */ }
```

工具注册(参照 DSH fixture `packages/preset/agent-presets/tests/fixtures/plugins/contribute.js`):

```js
ctx.effect(() => ctx.tools.register({
  name: 'evolution.propose',
  description: '...',
  parameters: { type: 'object', properties: {...}, additionalProperties: false },
  output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
  execute: async (args) => { ... }
}))
```

4 工具 execute 实现(全部调真实库, 用 `createRequire` 从插件文件 require 相对路径):

| 工具 | 参数 | execute 内部(真实实现) |
|---|---|---|
| `evolution.propose` | `{ evidenceRun, baselineDir, outDir }` | require `../../evolution-controller/lib/proposer.js` 的 `propose({ runJson: 读 evidence, baselineFiles: 读 baselineDir, logicalId, llm: createChatClient(...), redactValues: [] })`; 产物写 outDir; 返回 `{ ok, candidateDir, hypothesis }` JSON |
| `evolution.mutate` | `{ dir, file, op: 'replace', from, to }` | 读 file, 替换 from→to(替换校验: from 存在否则抛错), 原子写回; 返回 `{ ok, file, changed: true }` |
| `evolution.candidate` | `{ logicalId, sourceRevisionId, hypothesis, evidence, mutations, files }` | require `preset-registry/lib/registry.js` `Registry({ root })` → `createCandidate` → `patchCandidate`(mutations) → 写 staging 内容(files); 返回 `{ candidateId }` |
| `evolution.run` | `{ benchmark, registryRoot, logicalId, candidateId, split, minEffect }` | spawn `node bin/dsh-evolve.js --benchmark <yaml> --registry <root> --logical <id> --split <split> --min-effect <n> --out <tmp>`(child_process.execFile 包装 Promise); 返回 gate.json 内容 `{ decision, reason, gain, efficiencyGain }` |

- execute 出错时返回 `{ ok: false, error: message }` 字符串而非 throw(工具面友好)。
- `output.schema` 恒为 `{ type: 'string' }`(JSON 摘要), render 恒 text。

## P2. system-evolver 预设重写

`packages/system-presets/presets/system-evolver/agent.cordis.yml` 整体替换为合法组合:

```yaml
# system-evolver — 只写 Candidate 的进化工作台 Preset(合法插件行组合)
# 信任域: 只写 Candidate; promote/rollback/current 不在工具面(不注册即不可调)。
# 安装: packages/system-presets/install.ps1

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are the "进化工作台" (evolution) assistant. 你的职责 = RCA → Proposal →
      Mutation → Candidate, 只写 Candidate(staging 隔离区), 无权 promote/rollback。
      可用工具: evolution.propose(读失败证据生成提案) / evolution.mutate(应用修改) /
      evolution.candidate(创建 staging 候选) / evolution.run(提交闭环评测, 不含 promote)。
      CLI 等价物: node E:\github\dsh-eval\packages\evolution-controller\bin\dsh-evolve.js
      (完整闭环需用户 approvalId 才能 promote)。
- id: evolution-tools
  name: ./plugins/evolution-tools.js
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    text: >-
       - 信任域: 只写 Candidate。不可写 Source Revision / Rubric / Benchmark / current pointer。
       - 禁止: promote / rollback / current(工具面未暴露, CLI 需 approvalId)。
       - 评测是只读域: 消费 run.json 失败证据, 不直接读评测真值/holdout 原始数据。
       - 诚实: 评测引擎故障时如实报告, 不伪造分数, 不为 promote 而伪造。
```

同时写 `packages/system-presets/presets/system-evolver/preset.yml`:
```yaml
name: 进化工作台
description: 进化工作台 — RCA → Proposal → Mutation → Candidate(staging 隔离区)。
```
新建 `packages/system-presets/presets/system-evolver/plugins/`(插件文件复制, 或与根级共用:
install.ps1 复制时携带 plugins 目录)。

## P3. system-evaluator 同构重写

`packages/system-presets/presets/system-evaluator/agent.cordis.yml` 合法化:

```yaml
# system-evaluator — 只读评测工作台 Preset
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are the "评测工作台" (evaluation) assistant, 只读评测能力。
      使用 evaluation.run(发起评测) / evaluation.status(查询) / evaluation.report(报告) /
      evaluation.failures(失败聚合)。无任何写 Candidate / promote 工具。
      CLI: node E:\github\dsh\apps\cli\lib\bin.js --profile eval run|report|compare|import ...
- id: evaluation-tools
  name: ./plugins/evaluation-tools.js
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    text: >-
       - 信任域: 只读评测。不可写 Candidate / current / Rubric。
       - 禁止: candidate.* / preset.promote|rollback|current / evolve.*(工具面未暴露)。
```

`preset.yml`:`name: 评测工作台` / description。

新增 `packages/system-presets/plugins/evaluation-tools.js`(只读 4 工具):
- `evaluation.run` → spawn `node E:\github\dsh\apps\cli\lib\bin.js --profile eval run <yaml> --out <json>` → 返回 run 摘要
- `evaluation.status` → 读 `<run.json>` → `{ status, taskSuccessRate, steps }`
- `evaluation.report` → `... --profile eval report <run.json>` → markdown 摘要
- `evaluation.failures` → spawn `node bin/dsh-evolve.js failures <run.json...>` → 失败类聚合

## P4. install.ps1 更新

`packages/system-presets/install.ps1` 改为复制整个预设目录(含 plugins/):

```powershell
foreach ($p in @("system-evaluator", "system-evolver")) {
  $target = Join-Path $dest $p
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item -Force -Recurse (Join-Path $src "presets\$p") $target   # 目录级复制
  Write-Host "installed: $target"
}
```
删除旧的仅复制 agent.cordis.yml 的逻辑。

## P6. 测试与验证(全部 node:test 单进程)

1. 新建 `packages/system-presets/test/evolution-tools.test.js`(node:test):
   - 断言插件可 import(动态 import), 导出 name/inject/apply;
   - apply 后注册 4 工具名存在(fake ctx: `{ effect: f=>f(), tools: { register: def => defs.push(def) } }`);
   - `evolution.mutate` execute 纯逻辑单测(临时目录, replace 成功/from 缺失报错);
   - `evolution.candidate` execute 用临时 registry root, 断言 candidateId 返回;
   - `evolution.run` 用 fake spawn(注入 execFile mock)断言 gate 摘要返回;
   - `evaluation.status` execute 用临时 run.json fixture。
2. YAML 合法性: 解析 agent.cordis.yml(js-yaml + !!js 标签注册), 断言顶层为数组且
   行 name 存在; 断言 preset.yml 可读(name/description)。
3. 真实安装: 运行 install.ps1 → 检查 `${DSH_HOME}/.agent-presets/system-*` 含
   agent.cordis.yml + preset.yml + plugins/。用
   `node E:\github\dsh\apps\cli\lib\bin.js --profile web --dump-config` 或
   `agentPresets.list()` 健康检查(如 CLI 不便, 记录输出并说明)。
4. 全量回归: evolution-controller `node test/*.test.js` 逐个单文件跑; preset-registry 同;
   dsh-eval mirror 无改动可跳过(如改到, 需 prepare-sdk 流程)。

## P7. 收尾

- 更新 `packages/system-presets/README.md`(如存在)或新建 README.md 说明安装/工具面。
- 不提交 git(由主会话提交)。完成后在最终报告给出:
  1. 各工具注册名与 execute 行为摘要;
  2. 测试通过数/失败数;
  3. 安装验证输出;
  4. 诚实标注任何未完成/受限项。
