# system-evolver 工具面接线 (evolution.* 真实工具)

## Goal

把 system-presets 设计稿工具面接线为真实可用的 agent 工具:消除头号缺口——预设
声明的 `evolution.*` / `evaluation.*` 工具在真实平台不存在,且预设文件本身不是
合法 agent preset(自定义 `name/tools/forbidden` 结构,DSH 视为 broken)。

## Requirements

- R1: 新插件(ESM,CJS 兼容)注册真实 `evolution.*` 工具,execute 内部调用
  evolution-controller/preset-registry 真实库(或 CLI),不再是无实现声明。
- R2: `system-evolver` 预设重写为合法插件行组合(参照 `eval/presets/evaluate/agent.cordis.yml`
  与 DSH fixture `packages/preset/agent-presets/tests/fixtures/plugins/contribute.js`),
  工具由插件注册;`preset.yml` 提供展示元数据。
- R3: `system-evaluator` 预设同构重写,注册只读 `evaluation.*` 工具(run/status/report/failures),
  对应真实 dsh-eval CLI 能力。
- R4: 信任域保持:evolver 只写 Candidate,无 promote/rollback/current 写权;evaluator 只读。
  forbidden 语义由「不注册」+ 文档声明实现(平台无 capability 层,工具面即边界)。
- R5: 安装脚本 install.ps1 更新为可用的真实安装(复制插件文件 + 预设目录到
  `${DSH_HOME}/.agent-presets/`)。
- R6: 验证:预设可挂载(非 broken)、工具可注册、单测覆盖核心逻辑、真实会话 smoke。

## Acceptance Criteria

- [ ] AC1: 新插件文件注册 `evolution.propose/mutate/candidate/run` 4 工具,
  每个工具 execute 调用真实库逻辑(proposer 生成提案 / mutation 应用 / registry 候选 /
  闭环 run),单测断言返回结构。
- [ ] AC2: `system-evolver/agent.cordis.yml` 是合法插件行列表(preset id 合规、
  行 name 可解析、无自定义非法结构),DSH roster 健康检查列为非 broken。
- [ ] AC3: `system-evolver/preset.yml` 提供展示元数据(name/description),读取不报错。
- [ ] AC4: `system-evaluator` 同样合法且注册只读工具; evolver 无 promote/rollback/current 工具暴露。
- [ ] AC5: install.ps1 可把两预设+插件装进 `${DSH_HOME}/.agent-presets/`,安装后
  `agentPresets.list()` 显示两预设健康(或用 `--dump-config` 验证)。
- [ ] AC6: 全量回归通过(evolution-controller + preset-registry + dsh-eval 现有测试无失败)。

## Notes

- 关键机制(已查证):DSH agent preset 的 agent.cordis.yml 是「插件行列表」,行 name
  解析自 host composition(`@deepseek-ai/dsh-*`)或相对路径(从 preset 目录解析)。
  工具注册 API: `ctx.tools.register({ name, description, parameters, output: {schema, render}, execute })`
  见 DSH `packages/preset/agent-presets/tests/fixtures/plugins/contribute.js`(import-free ESM,
  `export const name/inject/apply`)。
- 平台真实能力: `packages/evolution-controller`(lib/proposer.js, lib/controller.js,
  lib/registry.js, bin/dsh-evolve.js)与 `packages/preset-registry`。
- 诚实原则: 工具只调真实库/CLI, 不伪造; 评测引擎故障时如实返回错误。
