# design.md — system-evolver 工具面接线

## 1. 现状与根因

- `packages/system-presets/presets/{system-evolver,system-evaluator}/agent.cordis.yml`
  是「设计稿」:自定义 YAML 结构(`name/description/tools/forbidden`),不是 DSH
  合法预设(合法预设 = 顶层插件行列表,见 DSH `packages/preset/agent-presets/README.md`:
  「a composition ... is not a list of named plugin rows」→ broken)。
- 声明的 `evolution.*` / `evaluation.*` 工具无任何插件注册,调用即报不存在。
- `HOST-CAPABILITIES.md` 描述的 capability 层在真实平台未实现; 真实边界 = 工具面
  (注册即可见/可调) + CLI 人审(`--approve` 强制 approvalId)。

## 2. 方案: 真实插件注册工具 + 合法预设重写

### 2.1 插件载体

新文件 `packages/system-presets/plugins/evolution-tools.js`(ESM, import-free,
参照 DSH fixture `contribute.js` 形态):

```js
export const name = 'system-evolution-tools'
export const inject = ['tools']
export function apply(ctx, config) {
  ctx.effect(() => ctx.tools.register({ ... }))  // evolution.propose / mutate / candidate / run
}
```

- 行引用方式: preset 内相对路径行(从 preset 目录解析, 见 README「A relative
  path still resolves from the preset's own directory」)→ agent.cordis.yml 行:
  `- id: evolution-tools\n  name: ./plugins/evolution-tools.js`。
- 插件文件随预设目录复制到 `${DSH_HOME}/.agent-presets/<id>/plugins/`。

### 2.2 工具契约(4 工具)

每个工具 `ctx.tools.register({ name, description, parameters, output, execute })`,
execute 调真实库,返回字符串摘要(JSON 序列化):

| 工具 | 真实实现 | execute 行为 | readOnly |
|---|---|---|---|
| `evolution.propose` | `lib/proposer.js` | 读失败证据 run.json + baseline 内容 → LLM 生成 `{hypothesis,evidence,mutations,files}` 候选(写到指定目录) | false(写候选目录) |
| `evolution.mutate` | 文件替换逻辑 | 对候选目录应用 mutation(file 内容 replace) | false |
| `evolution.candidate` | `preset-registry` registry.createCandidate | 创建 staging 候选,返回 candidateId | false(仅 staging DRAFT) |
| `evolution.run` | `bin/dsh-evolve.js` 闭环(或 controller+registry 库) | 提交候选: seal → 评测 → gate → 输出 gate 判定(不 promote,无 approvalId) | false |

禁止项(不注册即不可调): `preset.promote/rollback/current`、`evaluation.*` 真值、
`holdout.*` — evolver 工具面不含; promote 仅 CLI `--approve`(需用户 approvalId)。

### 5. system-evaluator(只读)

`packages/dsh-eval` CLI 能力对应:
- `evaluation.run` → spawn `dsh --profile eval run <benchmark.yaml> --out <json>`
- `evaluation.status` → 读 run.json 状态
- `evaluation.report` → `dsh --profile eval report <run.json>`
- `evaluation.failures` → `dsh-evolve failures <run.json...>`

工具 readOnly: true。evolver 无权调用。

### 6. 预设文件重写(合法组合)

`system-evolver/agent.cordis.yml`:
```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config: { text: '…进化工作台 persona, 说明 CLI 与工具用法…' }
- id: evolution-tools
  name: ./plugins/evolution-tools.js
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config: { text: '…信任域规则: 只写 Candidate…' }
```
- `preset.yml`:`name: 进化工作台` / `description`(展示元数据, order 可选)。
- 安装: install.ps1 复制整个预设目录(agent.cordis.yml + preset.yml + plugins/)。

### 5. 验证路径

1. 单测(node:test, 单进程 `node test/<file>.test.js` 避开 spawn EPERM):
   - evolution-tools.js 可 import, 4 工具注册名/描述/参数 schema 断言;
   - mutate 应用逻辑纯函数单测(insert/replace);
   - propose 走 fake LLM(复用 lib/llm-client 的注入模式, 如 proposer.test.js);
   - registry createCandidate 调用断言(临时 root)。
2. 预设合法性: 用 DSH loader 方言解析 agent.cordis.yml(js-yaml + !!js 扩展,
   参照 evolution-real-fix2.mjs 的注册方式)→ 断言顶层是行列表且行 name 可解析。
3. 真实安装: install.ps1 跑一次 → `agentPresets.list()` 健康(或
   `node apps/cli/lib/bin.js --profile web --dump-config | grep system-`)。
4. 全量回归: evolution-controller(25 文件) + preset-registry(3 文件) + dsh-eval mirror。
