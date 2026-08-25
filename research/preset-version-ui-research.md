# Preset 版本 UI 生态调研(2026-08-25)

目标:前端(模式选择器/新会话)看不到也选不了 preset 版本。调研生态里谁已实现,在其基础上改。

## 结论:完整功能(内容版本选择器)生态空白,但组件级现成件已足够拼装(第二轮/第三轮调研后)

| 仓库 | 相关能力 | 可改程度 |
|---|---|---|
| **jeffcwj/dsh-preset-switcher**(已克隆 research/dsh-preset-switcher/,MIT,纯 JS) | 会话头部「当前模式 ▾」下拉:列出所有 preset、✓ 标记当前、点击切换;**已开始会话也能切**(绕过原生空白会话检查);deferred 切换(未加载会话 append `agent-preset/selected` 事件,resume 生效);失效预设修复(repair API,append-only 修正事件) | **直接改**:「会话头部选 preset」现成 UI + 热切换机制,改成「选版本」 |
| **CTWCTW9999/dsh-agent-preset-router**(已克隆 research/dsh-agent-preset-router/,MIT) | 自动模式 preset:新会话首条消息前 flash 分类 → 自动切换 → 执行;安装器复制 presets/auto/ → `$DSH_HOME/.agent-presets/auto` + **`.dsh-preset-owner.json` owner 标记**(非本插件管理的目录跳过);RPC POST /agent-preset-router/rpc classify | **直接改**:preset 安装器 + owner 标记模式(「同步安装目录」的归属保护) |
| **goecho/dsh-generation**(已克隆 research/dsh-generation/,MIT,纯 JS) | `generation_fork`(`agentPresets.copy(from,id)` + purpose 写 preset.yml)+ `generation_run`(`agents.create` + `agentPresets.mount(id)` 新 agent 跑任务,15min 超时,dispose);「make, not a compiler」;fork/run 都走人审;血统=meta session log | **直接改**:「fork preset → 新会话跑任务」= 我们的「候选→评测」的另一种实现形态(真实 agent 会话评测) |
| **Quinn2006/dsh-guise**(已克隆 research/dsh-guise/,纯 JS) | 人设库:`<dsh-home>/.persona/library/<id>.txt` 多套命名配置 + `@preset:<id>` 单行指针 + `history.json` append-only 快照(HISTORY_LIMIT=100)+ 全局/工作区局部两层覆盖 + 主开关;loopback-only `/api/dsh-persona` 路由族;纯 DOM client;mtime 缓存;sanitizePresetId CJK 安全 | **直接改**:「库 + 指针 + 历史」三件套形态与我们的 registry 同构,UI 面板形态可借鉴 |
| **dsh-web-ui/packages/dsh-liangshen** | `src/sync.ts`:preset 目录同步到 agent-presets 根 + 结构校验 + retire 旧 id;`src/schema.ts`:agent.cordis.yml 结构校验;presets/liangshen/(agent.cordis.yml + tool-bootstrap.mjs + custom-bash.mjs) | **直接改**(TS→CJS 改写):「promote 后同步安装目录」的现成实现 |
| **bpc-oss/dsh-fork-to-preset**(已克隆 research/dsh-fork-to-preset/,MIT) | 会话 Header「Fork to preset」下拉框:选任意 agent preset 分叉新会话,继承父会话轮次;依赖 `session.fork({agentPreset})`(rc.8+) | **直接改**(MIT):「会话头部选 preset」的现成 UI 形态,改成「选版本」 |
| **AKS1st/dsh-skill-manager** | 设置面板 Skill Manager 页:浏览 system/user/workspace/preset skills,文件树编辑 + zip 导入导出 + 删除(system 只读) | 借鉴:设置面板资源管理形态 |
| **MaRi23333/dsh-subagent-library** | settings 驱动的具名子代理角色名册,list_subagents/delegate 工具 + 设置页 | 借鉴:settings 页管理角色名册形态 |
| **GraySilver/dsh-evolve-modes**(已克隆) | `revision` 概念(evolution state revision 0→1→2→3,src/evolution/store.ts:402) | 印证思路:revision 是「学习状态」版本,非 preset 内容版本 |
| dsh-web-ui 全家桶 | dsh-market/dsh-doctor 的 version 是**插件包版本**;dsh-plugin-manager version.ts 是 engines.dsh 兼容性比较 | 无关 |
| dsh-continual-evolve 等其余 8 仓 | 无 preset 版本 UI | 无关 |

## 关键事实

1. **registry 版本体系(指针/历史/回滚)是自研的,生态无人做「preset 内容版本选择器」**——需要自建 UI 逻辑,但组件可借。
2. **dsh-liangshen sync.ts 行为**(src/sync.ts:1-15, 170-181):把 sourceRoot 下每个 preset 目录同步进 targetRoot(agent-presets 发现根);按目录复制、幂等;同步后校验 agent.cordis.yml 结构;retire 参数删除不再拥有的 preset id;只动自己拥有的 id,不碰用户其他 preset。测试齐全(sync.test.ts:复制/中文路径/retire/文件替换目录/校验失败报 failed)。
3. **dsh-fork-to-preset 形态**(README.zh.md):Header 下拉框 → 选 preset → 分叉新会话继承父轮次。MIT,lib/ 已构建产物(index.js/client.js),cordis.patch.yml 挂载。
4. **DSH 前端机制**(查证):模式选择器读 `agentPresets.list()`(扫描 ~/.dsh/.agent-presets/ 目录),不认识 registry;`settings.section` 插槽有 AgentPresetSection(id 'agent-presets')占用者;`conversation.session.header.actions` 插槽可加头部按钮;`agent-preset/selected` 事件记录会话实际用的 preset。
5. **真实缺口**:~/.dsh/.agent-presets/evaluate/ 仍是 v1(4436B,无 compare/unattended/Failure clusters),registry current 是 v7(evaluate-94a7c40b)——7 代进化从未同步到安装目录,用户新会话实际用 v1。
6. **dsh-preset-switcher 热切换机制**(lib/index.js:202-333):核心 = `agentPresets.recompose(agent.ctx, presetId)`(原生 `agentPresets.select` 拒绝有历史的会话,recompose 是同一原子原语但绕过空白检查;新组合先确保完成再移动链接,坏预设不伤会话);成功后 `agent.session.append('agent-preset/selected', {agentPreset})` 同步投影;未加载会话 = `sessionPersistence.inspect(sessionId)` + `sessionPersistence.append(sessionId, [selectionEvent(seq=事件数, presetId)])` deferred 生效;repair = 扫描 `sessionPersistence.list()`,最后一个 `agent-preset/selected` 事件(否则 header)引用失效 → append 修正事件(append-only,不重写日志);fence = loopback + `webRuntime.trustedHosts` + sec-fetch-site/origin 校验;子代理会话拒绝(header.origin==='subagent')。API 面:`agentPresets.list()/defaultId/composedPreset(agent.ctx)/recompose(agent.ctx, presetId)`。
7. **dsh-agent-preset-router 安装器**(lib/index.js:100-122):复制 `presets/<id>/` → `$DSH_HOME/.agent-presets/<id>`;先读目标 `.dsh-preset-owner.json`,`owner.package !== PACKAGE_NAME` 则跳过(不覆盖他人目录);临时目录 `${target}.installing-<pid>` + 写 owner 标记 + rename。preset 锁事实:会话一旦产生内容(首个 turn/start)就固定 preset(`agent-preset-locked`),路由必须在首条消息前(客户端包装 api.sessions.prompt)。
8. **dsh-generation fork/run**(src/index.js):`agentPresets.copy(from, id)` 复制预设到新 id(拒绝覆盖);`agents.create` + `agentPresets.mount(id)` 起新 agent 跑任务(15min 超时 dispose);fork/run 都走 `tools/pre-execute` ask 人审;不依赖 @deepseek-ai/dsh-tools/dsh-llm(原始定义注册)。
9. **dsh-guise store.js**(lib/store.js:1-373):库目录 `library/<id>.txt`(首行 `# 名称` 显示名)+ 全局 `global.txt`(直接文本 | `@preset:<id>` 指针 | `off`)+ 工作区局部 `<cwd>/<localFile>` 存在即优先 + 主开关 `enabled.txt` + 编辑历史 `history.json`(覆盖前快照,上限 100)+ mtime 缓存;`sanitizePresetId` 保留 CJK(Unicode 字母数字,其余转 `-`,40 字符上限)。

## 建议改造路径(基于现成件,第二轮更新)

1. **同步器**:参考 dsh-liangshen sync.ts 写 CJS 版 `syncPresetDir(source, target)`(幂等复制 + 结构校验 + 只动自己拥有的 id),挂到 promote 成功后自动执行(registry 侧或 dsh-evolve CLI 侧)。
2. **版本选择 UI**:参考 dsh-preset-switcher 的会话头部下拉形态(React + fenced POST 路由,已开始会话也能切),在 conversation.session.header.actions 加「版本」下拉:列出 registry history(current + previous),选中 → Host 同步该 revision 内容到安装目录 → 提示后开新会话即用该版本(不动 registry 指针,写审计 switch-to-revision)。活跃会话切换可复用 `agentPresets.recompose` 机制(需先同步目录再 recompose 到该目录 id)。
3. **owner 标记**:同步安装目录时写 `.dsh-preset-owner.json`(参考 router),防覆盖用户手装目录;promote 自动同步也先查 owner。
4. **设置页版本区块**(可选):settings.section 注册「版本管理」,展示每模式版本链 + 回滚按钮(复用 P4 控制台数据)。
5. **载体**:扩展现有 packages/dsh-eval-console 插件(P4 已装,Host webServer 三端点 + Client conversation.view 标签)。

## 参考链接

- https://github.com/jeffcwj/dsh-preset-switcher
- https://github.com/CTWCTW9999/dsh-agent-preset-router
- https://github.com/goecho/dsh-generation
- https://github.com/Quinn2006/dsh-guise
- https://github.com/AKS1st/dsh-skill-manager
- https://github.com/MaRi23333/dsh-subagent-library
- https://github.com/bpc-oss/dsh-fork-to-preset
- https://github.com/GraySilver/dsh-evolve-modes
- https://github.com/zhu1090093659/dsh-web (dsh-liangshen 所在全家桶)
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-agent-preset/README.md
