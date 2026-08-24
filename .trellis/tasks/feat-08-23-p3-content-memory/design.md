# Feature Design

status: draft   # draft | approved
execution_lane: standard   # quick | standard

## 目标与非目标

- 目标: 进化对象从「preset 内容」扩展为「harness state 四类 + skill 生命周期 + 记忆文件 + 注入形态」。
- 非目标: Web UI、UCB-Air、评测侧。

## 方案

### 边界

- P3-1: evolution-controller/lib/skill-extract.js(新, 吸收 dsh-skill-evolve extractor/generator)。
- P3-2: preset-registry 增量: 支持非 preset 内容对象(entries 按 kind 版本化)或新 packages/state-store(待定)。
- P3-3: evolution-controller/lib/skill-lifecycle.js(新)。
- P3-4: 热挂载需 DSH 插件能力(ctx.skills / slots), 以 Cordis 插件形态交付或记录不可行结论。
- P3-5/6: evolution-controller/lib/memory.js(新)+ 注入渲染。

### 数据流

```text
P3-1: session.jsonl → extractor(user msg→taskDescription, tool/call→步骤序列, 参数泛化) → SKILL.md
P3-2: entries {id, kind, version, content, updatedAt} → registry revisions 内容寻址 → 按 id 回滚
P3-3: skill lifecycle active→stale→archived(30/90 天)+ consolidate/restore + pinned
P3-4: SKILL.md → live 插件注册(挂载验证)
P3-5: MEMORY.md/USER.md 写入(字符预算+dedup)
P3-6: prompt notes 注入 ≤6/kind×180 字符(空 store 零 token)
```

### 契约变更

- registry: 内容对象类型扩展(或独立 state-store)。
- evolution-controller: skill-extract/skill-lifecycle/memory 模块。
- dsh-evolve: extract-skill / skill list 子命令(可选)。

### 取舍

- P3-2 形态: 优先复用 preset-registry 内容寻址(同 digest 语义), 不新建存储; 若类型冲突再独立 state-store。
- 热挂载以「验证可行 + 文档」为最低交付, 不强行集成。
- 注入形态与现有 preset 内容注入分离(轻量 prompt notes)。

## 风险与回滚

- 热挂载权限风险: 隔离 DSH_HOME 验证, 不加载未知来源。
- 量大: 分轮提交, 每轮独立可验证。
- 全部新模块纯函数化, 便于单测。

## 验证计划

- 真实会话提炼演示(P3-1)。
- 单测覆盖 AC2/3/5/6。
- 热挂载隔离环境验证(P3-4)。
- 全量回归。

## 人审检查点

- [ ] 设计已获用户确认（status=approved）后再进入实现
