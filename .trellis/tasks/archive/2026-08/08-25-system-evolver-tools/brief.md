# AgY 任务: system-presets 工具面接线(evolution.* 真实工具)

仓库: `E:\github\dsh-eval`(工作目录即仓库; **不要 git commit/add, 主会话负责提交**)

## 目标

把 `packages/system-presets/` 的设计稿预设改成真实可用的 DSH agent preset:
1. 新插件注册 `evolution.*` / `evaluation.*` 真实工具(execute 调真实库/CLI);
2. 两个预设重写为 DSH 合法的「插件行列表」组合(现格式是自定义结构, DSH 视为 broken);
3. 更新安装脚本与新增测试。

## 必须理解的机制

DSH 的 agent preset(`${DSH_HOME}/.agent-presets/<id>/agent.cordis.yml`)是**顶层插件行列表**
(YAML 数组, 每行 `- id: <行id>\n  name: <包名或相对路径>\n  config: {...}`)。行 name 可以是
`@deepseek-ai/dsh-*` 包名(由 host 组合解析), 也可以是**相对路径**(从 preset 目录解析,
如 `./plugins/xxx.js`)。工具由插件通过 `ctx.tools.register({ name, description, parameters,
output: { schema, render }, execute })` 注册。

**先读这两个权威范例**:
- 工具注册: `E:\github\dsh\packages\preset\agent-presets\tests\fixtures\plugins\contribute.js`
  (import-free ESM: `export const name / inject`, `export function apply(ctx, config)`,
  `ctx.effect(() => ctx.tools.register({...}))`)。
- 合法预设组合(真实可用): `E:\github\dsh-eval\eval\presets\evaluate\agent.cordis.yml`
  (persona 行 + 工具行 + agent-instructions 行)。

## 现有代码(只读参考, 不修改)

- `packages/evolution-controller/lib/proposer.js` — `propose({ runJson, baselineFiles, logicalId, llm, redactValues })` → `{ok, hypothesis, evidence, mutations, files}`(LLM 生成提案; llm 用 `lib/llm-client.js` 的 `createChatClient`)。
- `packages/evolution-controller/lib/controller.js` — `EvolutionController({registry, auditDir})` → `newRun/createCandidate/seal/evaluate/promote`。
- `packages/preset-registry/lib/registry.js` — `Registry({root})` → `createCandidate(logicalId,{sourceRevisionId,evolutionRunId})` / `patchCandidate` / `sealRevision`。
- `packages/evolution-controller/bin/dsh-evolve.js` — 完整闭环 CLI(`--benchmark/--registry/--logical/--candidate/--split/--approve/--min-effect/--out`; 归档 `--export/--import/--status`; 子命令 `failures <run.json...>`)。
- `packages/system-presets/presets/system-evolver/agent.cordis.yml` 与 `system-evaluator/agent.cordis.yml` — **现内容是设计稿, 整体替换**。
- `packages/system-presets/install.ps1` — 需更新。
- `packages/system-presets/HOST-CAPABILITIES.md` — 设计文档, 保留不动。

## 实施步骤

### P1. 新插件 `packages/system-presets/plugins/evolution-tools.js`
ESM import-free 形态(参照 contribute.js), `export const name = 'system-evolution-tools'`,
`export const inject = ['tools']`, `export function apply(ctx, config)` 注册 4 工具:

1. `evolution.propose` — 参数 `{ evidenceRun, baselineDir, outDir }`。execute:
   读 evidenceRun(失败 run.json) → require `../../evolution-controller/lib/proposer.js`
   的 `propose({ runJson, baselineFiles: <从 baselineDir 读的文件 map>, logicalId, llm: createChatClient(...), redactValues: [] })`
   → 写产物到 outDir → 返回 `{ok:true, candidateDir, hypothesis}` JSON 摘要。
2. `evolution.mutate` — 参数 `{ dir, file, op:'replace', from, to }`。execute: 读文件,
   from 不存在抛错, 替换后写回; 返回 `{ok:true, file, changed:true}`。
3. `evolution.candidate` — 参数 `{ root, logicalId, sourceRevisionId, hypothesis, evidence, mutations, files }`。
   execute: `new Registry({root}).createCandidate` → `patchCandidate` → 写 staging 内容(files);
   返回 `{ok:true, candidateId}`。
4. `evolution.run` — 参数 `{ benchmark, registryRoot, logicalId, split='dev', minEffect=0.05 }`。
   execute: spawn `node <repo>/packages/evolution-controller/bin/dsh-evolve.js --benchmark <yaml> --registry <root> --logical <id> --split <split> --min-effect <n> --out <tmpDir>`
   (child_process.execFile 包装 Promise, 超时 600s), 读 `out/gate.json` → 返回
   `{ok:true, decision, reason, gain, efficiencyGain}`。

execute 出错返回 `{ok:false, error: message}`(JSON 字符串)而非 throw。
`output.schema` 恒为 `{type:'string'}`, render 恒 text。

### P2. 新插件 `packages/system-presets/plugins/evaluation-tools.js`(只读 4 工具)
1. `evaluation.run` — `{ benchmark, out }` → spawn `node E:\github\dsh\apps\cli\lib\bin.js --profile eval run <yaml> --out <json>` → 摘要。
2. `evaluation.status` — `{ runJson }` 读文件 → `{status, taskSuccessRate, steps}`。
3. `evaluation.report` — `{ runJson }` spawn `... --profile eval report <run.json>` → markdown 摘要。
4. `evaluation.failures` — `{ runJsons: [] }` spawn `node <repo>/packages/evolution-controller/bin/dsh-evolve.js failures <runs...>` → 失败类聚合。

### P3. 预设重写(替换现有文件)

`packages/system-presets/presets/system-evolver/agent.cordis.yml`(顶层数组):
- 行 1 persona: `name: '@deepseek-ai/dsh-persona'`, config.text 描述进化工作台职责
  (RCA→Proposal→Mutation→Candidate, 只写 Candidate, 无权 promote/rollback, 可用 4 工具, CLI 等价物)。
- 行 2 evolution-tools: `name: ./plugins/evolution-tools.js`(插件文件复制到
  `presets/system-evolver/plugins/evolution-tools.js`, 相对路径从 preset 目录解析)。
- 行 3 agent-instructions: `name: '@deepseek-ai/dsh-agent-instructions'`, config.text 信任域规则。
- 新建 `presets/system-evolver/preset.yml`: `name: 进化工作台` / `description`。

**system-evaluator** 同构: persona + `./plugins/evaluation-tools.js` + instructions;
preset.yml `name: 评测工作台`。

插件文件布局自选(每预设自带 plugins/ 或共用 packages/system-presets/plugins/ + 恰当相对路径),
但相对路径必须能解析。

### P4. install.ps1 更新
改为复制整个预设目录(`presets\$p` → `${DSH_HOME}/.agent-presets/$p/`, -Recurse),
保持输出信息与验证提示。

### P5. 测试
新建 `packages/system-presets/test/evolution-tools.test.js`(node:test, **单进程运行**
`node test/<file>.test.js`, 勿用 `node --test` 目录——spawn EPERM)。用例:
- 插件可 import, 导出 name/inject/apply; apply(fake ctx `{effect: f=>f(), tools:{register: d=>arr.push(d)}}`) 注册 4+4 工具名;
- `evolution.mutate` execute 临时目录: replace 成功 / from 缺失报错;
- `evolution.candidate` 临时 registry root: candidateId 返回;
- `evolution.run` mock spawn(fake execFile)断言 gate 摘要;
- `evaluation.status` 临时 run.json fixture;
- YAML 解析断言: agent.cordis.yml 顶层是数组、行 name 存在(js-yaml + !!js 标签注册, 参照 research/evolution-real-fix2.mjs 的注册方式)。

## 验证 gate(必须跑并报告数字)
1. `node packages/system-presets/test/evolution-tools.test.js` 全绿;
2. 全量回归(逐文件单进程): `packages/evolution-controller/test/*.test.js` 与
   `packages/preset-registry/test/*.test.js` 全绿;
3. 真实安装: 运行 `powershell -File packages/system-presets/install.ps1`, 检查
   `${HOME}/.dsh/.agent-presets/system-{evaluator,evolver}/` 含 agent.cordis.yml + preset.yml + plugins/。

## 报告契约(最终输出)
1. 工具注册名与 execute 摘要(4+4 表);
2. 测试通过/失败数字;
3. 安装验证输出;
4. 诚实标注未完成/受限项。

## 铁律
- 不 git commit / add(主会话做); 不改 DSH checkout(E:\github\dsh); 不跑 prepare-sdk;
  不修改 evolution-controller/preset-registry/dsh-eval 现有源码(只读参考)。
- 测试一律单文件单进程(`node test/x.test.js`), 不用 `node --test` 目录。
