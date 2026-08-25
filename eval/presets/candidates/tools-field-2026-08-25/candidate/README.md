# 「评测」Agent Preset

前端可选的「评测」agent preset：默认把已有的 DSH 会话导入成评测报告，
也可运行 benchmark 生成新评测。

## 安装

把本目录两个文件复制到用户 preset 根（目录 id 即 preset id，必须为
`[a-z0-9][a-z0-9-]*`）：

```
C:\Users\daixu\.dsh\.agent-presets\evaluate\
├── preset.yml         # name: 评测, description, order: 2
└── agent.cordis.yml   # 组合：persona(评测指令) + shell/fs/jobs/skills/todo
```

复制后重启 GUI（或新开会话），模式选择器即出现「评测」。

## 工作方式

- **默认模式——评测已有 session**：列出 `%DSH_HOME%\sessions\<cwd-bucket>\<session-id>\session.jsonl.zstd`
  让用户挑选，然后
  `node E:\github\dsh\apps\cli\lib\bin.js --profile eval import dsh <path> --out <out>.json --case-id <id>`
  并用 `report <out>.json` 渲染指标。
- **备选模式——运行 benchmark**：`... --profile eval run <benchmark.yaml> --out <out>.json`。

两个模式都依赖已安装的 dsh-eval profile bundle（见 `packages/dsh-eval`）。

## 约束

- 该 preset 属于 `user` trust 根（`${DSH_HOME}/.agent-presets`），与 shipped
  presets（`E:\github\dsh\apps\cli\config\agent-presets`）互不影响。
- 组合只含模型面消费行（persona/instructions/工具），无服务发布，无需 isolate realm。

## 对比与进化

- 用 `compare` 子命令对比两次运行报告(baseline vs candidate), 见 persona 指引。
- 评测失败簇是进化闭环的输入: 平台 evolution-controller 以评测为只读域。

- dsh-evolve: candidate v1 (see audit ledger)
