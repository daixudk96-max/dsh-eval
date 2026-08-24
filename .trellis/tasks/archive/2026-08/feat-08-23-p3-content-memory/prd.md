# P3: 内容/记忆域(skill 提炼/harness state 四类/热挂载/记忆文件)

## 背景

差距清单 P3(第 17-22 项): 进化对象的广度扩展——目前只版本化 preset 内容, 生态已覆盖 prompt/memory/skill/subagent spec 四类 harness state、skill 提炼/生命周期/热挂载、记忆文件与注入形态。这是独立大块, 可拆分实施。

## 范围

### In Scope
- P3-1: skill 沉淀提炼(session.jsonl → SKILL.md; 参数泛化+步骤去重; 吸收 dsh-skill-evolve extractor/generator, 39 文件小仓最易移植)。
- P3-2: harness state 四类版本化(prompt/memory/skill/subagent spec entries, 按 id 版本+回滚; ESP 协议, 吸收 continual-harness)。
- P3-3: skill 生命周期(active→stale→archived + consolidate/restore + pinned 受护; 吸收 evolution-curator)。
- P3-4: 热挂载(skill→live 插件; 吸收 continual-evolve mount / dsh-evolve)。
- P3-5: 记忆文件(MEMORY.md/USER.md 字符预算+dedup; 吸收 evolution-memory)。
- P3-6: ranked injection(prompt notes 注入 ≤6/kind×180 字符, 空 store 零 token; 吸收 continual-harness)。

### Out of Scope
- Web UI(P4)、UCB-Air(P4)、评测侧工程化(P1)

## 验收标准

- [ ] AC1: 真实 session → SKILL.md 提炼成功(至少一个真实会话样例)。
- [ ] AC2: 四类 entries 版本化+按 id 回滚单测。
- [ ] AC3: skill 生命周期状态迁移 + restore 单测。
- [ ] AC4: 热挂载 skill→live 插件真实挂载验证(或记录不可行结论)。
- [ ] AC5: 记忆文件预算/dedup 单测。
- [ ] AC6: ranked injection 注入形态单测。
- [ ] AC7: 全量回归全绿。

## 约束与风险

- 本任务量大, 实施时可按 P3-1 → P3-2/3 → P3-4 → P3-5/6 拆多轮提交。
- 热挂载涉及真实插件加载(同 harness 权限), 需在隔离 DSH_HOME 验证。
- 上游只读 + absorbed-from 头注。

## 相关代码/文档

- research/feature-union-gap.md(P3 第 17-22 项)
- research/dsh-skill-evolve/src/extractor.ts / generator.ts(最小仓)
- research/dsh-continual-harness/src/(ESP 协议/ranked injection)
- research/dsh-evolution/packages/evolution-curator / evolution-memory
- research/dsh-continual-evolve/src/mount-command.ts / mount.ts
