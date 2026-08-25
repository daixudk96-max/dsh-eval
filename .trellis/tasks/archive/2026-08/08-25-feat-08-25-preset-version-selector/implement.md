# Implement — Preset 版本选择器

执行顺序(全部由实施 subagent 完成;主会话负责审 diff、跑全量回归、提交)。

## P1 同步器(src/domain/version-sync.ts + test/version-sync.test.js)

- 按 design D2 实现 syncRevision,纯函数、node:fs/promises、无服务依赖。
- 测试(9 用例):写入新目录 / 幂等 skipped / owner 拒绝(他人 owner)/
  owner 缺失拒绝 / 原子提交(临时目录+rename 成功)/ 失败清理(注入
  mkdir 失败或用不可写文件名)/ 路径逃逸拒绝(`../`、绝对路径)/
  targetId 正确(8 位 digest)/ 空 files 合法(只写 owner)。
- 运行:node test/version-sync.test.js(单进程,勿 node --test 目录)。

## P2 protocol 扩展(src/domain/protocol.ts + test/protocol.test.js)

- EvalAction/EvalActionResult/parseActionEnvelope 增 switch-revision
  (design D3)。测试 +3 用例。

## P3 host-service 分支(src/host-service.ts + src/audit.ts + src/index.ts)

- EvalConsoleHostOptions 增 agentPresetsRoot;index.ts 传
  `path.join(resolveHome(), '.agent-presets')`。
- audit.ts 增 `appendAuditLine(file, entry)`(fsp.appendFile 一行 JSON,
  失败 console.error 不抛出)。
- apply() 增 switch-revision 分支(design D4)。
- 测试:service 测试增 2 用例(mock RegistryLike + mock audit 文件,
  断言调用链:digestForRevision → revisionContent → syncRevision →
  审计行追加;未知 revision 抛错)。运行 node:test 单进程。

## P4 Client 头部下拉(src/client/VersionSelect.tsx + src/client/index.tsx)

- 注册 conversation.session.header.actions(id 'eval-version', order 30)
  + VersionSelect 组件(design D5);复用 host-api.ts 现有 fetch/SSE
  通道;locales.ts 增版本选择器文案(zh/en)。
- 测试:若现有 client 测试形态允许,加组件纯逻辑测试;否则以
  tsc 通过 + 真实 GUI 验证(主会话协调)为准。

## P5 构建与安装验证

- 包构建方式按 dsh-eval-console 既有流程(tsdown/tsc 等,查 package.json
  scripts);web profile 已装 dsh-eval-console(link:
  E:/github/dsh-eval/packages/dsh-eval-console),构建产物直接生效,
  重启 GUI 后新代码加载。
- 真实验证(AC5):node 脚本调用 syncRevision 对真实 registry
  (C:/Users/daixu/.dsh/preset-registry, logical evaluate, current
  evaluate-94a7c40b)同步 → 断言 C:/Users/daixu/.dsh/.agent-presets/
  evaluate-94a7c40b/ 存在且 3 文件内容与 revisionContent 一致、owner
  标记正确、registry 指针未变。产物报告写入任务目录或
  research/preset-version-selector-verify.md。
- GUI 验证(主会话协调):重启后会话头部出现「版本」下拉;模式选择器
  新会话可选 evaluate-94a7c40b。

## P6 全量回归

- packages/dsh-eval-console:node 单进程跑全部 test/*.test.js。
- evolution-controller + preset-registry:node 单进程全量。
- 0 失败。

## P7 报告与收尾

- research/preset-version-selector-verify.md:同步验证输出 + 测试数字 +
  审计事件样例。
- 报告完成状态给主会话;不 git commit(主会话提交)。

---

## 完成状态(2026-08-25, 主会话记录)

- [x] P1 同步器: src/version-sync.ts(移根至 src/, 因 client tsconfig
  include src/domain 且 types:[] 会因 node:fs 报错;移根后 typecheck 通过)
  + test/version-sync.test.js 9/9。
- [x] P2 protocol 扩展: parseActionEnvelope switch-revision 严格
  exactKeys(['kind','revisionId']);protocol.test.js 10/10。
- [x] P3 host-service 分支 + audit.ts appendAuditLine + index.ts
  agentPresetsRoot 透传;service.test.js 4/4。
- [x] P4 Client 头部下拉: conversation.session.header.actions 注册
  (id 'eval-version', order 30) + VersionSelect.tsx(index.tsx:56-70)。
- [x] P5 构建与安装验证: npm 11.4.2 arborist bug('Cannot read properties
  of null (reading \'edgesOut\')' @ loadPeerSet) → 改用 pnpm 安装成功;
  6 个 DSH 包 junction 链接(@deepseek-ai/dsh-host-webserver 等, 从
  E:\github\dsh\packages\<host|client>\* lib 已构建) → typecheck 0 错误 +
  build(tsc+tsdown) 成功。web profile 的 dsh-eval-console 是 symlink
  指向源目录, 重新 build 即生效, 无需同步(注意: 勿沿 symlink Remove
  源 lib)。真实验证见 research/preset-version-selector-verify.md:
  同步 evaluate-94a7c40b → .agent-presets/evaluate-94a7c40b/ 3 文件
  written, owner 标记正确, 二次同步全 skipped, registry 指针不变。
- [x] P6 全量回归: dsh-eval-console 6 文件 37/37; evolution-controller
  25 文件 200/200; preset-registry 3 文件 22/22。
- [x] P7 报告: research/preset-version-selector-verify.md 已写。
- [x] 独立核验: subagent 236b3b16 VERDICT PASS-WITH-NOTES(4 个低危
  观察: locales.ts 三键死文案 version.none/failed/noop; VersionSelect
  SSE 首拉失败靠后续帧自愈; version-sync logicalId 未校验 [a-z0-9-]
  字符集; host-routes 错误 message 原样进 400 暴露绝对路径)。
- [x] 根 .gitignore 新增: research/dsh-*/、research/llm-space/、
  _compare/、.scratch/、run-short*、run-p0-judge(防误提交克隆仓库)。
- [ ] GUI 侧用户确认: 重启后头部出现「版本」下拉 + 新会话可选
  evaluate-94a7c40b(依赖 GUI 重启, 由用户确认)。
