# system-presets — 系统级 Agent 预设(评测工作台 / 进化工作台)

两个系统级 agent preset 的真实实现:把原「设计稿工具面」接线为可用的 DSH 预设。

| 预设 | 信任域 | 工具面(由插件注册) |
|---|---|---|
| `system-evaluator` 评测工作台 | 只读评测 | `evaluation.run` / `evaluation.status` / `evaluation.report` / `evaluation.failures` |
| `system-evolver` 进化工作台 | 只写 Candidate(staging) | `evolution.propose` / `evolution.mutate` / `evolution.candidate` / `evolution.run` |

## 信任域设计

- **不注册即不可调**:preset 无 `promote` / `rollback` / `current` 写工具。
  evolver 只能写 staging 候选;evaluator 只有只读评测工具。
- **人审在 CLI**:`packages/evolution-controller/bin/dsh-evolve.js` 的 `--approve <approvalId>`
  是唯一 promote 路径,代码级强制(无 approvalId 拒绝)。
- `HOST-CAPABILITIES.md` 保留为能力设计文档(真实边界 = 工具面 + CLI 人审)。

## 结构

```
presets/<id>/
├── agent.cordis.yml    # 合法插件行列表(persona + 工具插件 + instructions + 基础工具面)
├── preset.yml          # 展示元数据(name/description)
└── plugins/            # 预设本地插件副本(相对路径 ./plugins/*.js 解析)
packages/system-presets/plugins/   # 插件源(两份预设本地副本由此复制)
```

## 安装

```powershell
powershell -File packages/system-presets/install.ps1
# 安装到 ${DSH_HOME}/.agent-presets/system-{evaluator,evolver}/
# 站立挂载:仅新会话可见;运行中会话保持原 generation
```

验证:`node E:\github\dsh\apps\cli\lib\bin.js --profile web --dump-config`
(或新开会话在模式选择器里看到「评测工作台」/「进化工作台」)。

## 测试

```bash
node packages/system-presets/test/evolution-tools.test.js   # 9 用例(工具契约 + 执行逻辑 + YAML 合法性)
```

## 工具面说明

| 工具 | execute 行为 |
|---|---|
| `evolution.propose` | 读失败 run.json + baseline 目录 → LLM 生成 `{hypothesis, evidence, mutations, candidateFiles}` → 写 outDir(proposal.json + candidate/) |
| `evolution.mutate` | 对候选文件应用字符串替换(replace;`from` 不存在则报错) |
| `evolution.candidate` | preset-registry `createCandidate` + `patchCandidate` + 写 staging 文件 |
| `evolution.run` | spawn `dsh-evolve.js` 完整闭环(benchmark ×2 → gate)→ 返回 `{decision, reason, gain, efficiencyGain}`;支持 `candidate` 透传。**无 `approve` 参数**——promote 只能走 CLI 人审 |
| `evaluation.run` | spawn `dsh --profile eval run <yaml> --out <json>` → 摘要 |
| `evaluation.status` | 读 run.json → 状态/metrics 摘要 |
| `evaluation.report` | `dsh --profile eval report <run.json>` → markdown 报告 |
| `evaluation.failures` | `dsh-evolve.js failures <runs...>` → 失败类聚合 |

> 注:`evolution.run` 不暴露 `--approve`:approvalId 只能由人审流程在 CLI 侧提供,
> 工具面不允许 agent 自造 approvalId 绕过人审绑定。
