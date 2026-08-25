# Preset 版本选择器:同步器 + 头部下拉 + owner 标记(基于生态现成件)

## Goal

在已安装的 `packages/dsh-eval-console` 插件上增加「版本选择器」:会话头部
(`conversation.session.header.actions` 插槽)出现「版本 ▾」下拉,列出真实
registry 的 history(current + previous),选中某个 revision 后 Host 侧把该
revision 的内容同步到 `$DSH_HOME/.agent-presets/evaluate-<digest8>/`
(独立版本目录,带 owner 标记防止覆盖他人目录),并在 evolution-audit
ledger 追加 `switch-to-revision` 事件。**不移动 registry 指针**——promote
语义不变,版本同步只影响"新会话默认加载哪个 preset 目录"。

背景:真实缺口(2026-08-25 实测)——registry current 已是 evaluate-94a7c40b
(第 7 代),但 `~/.dsh/.agent-presets/evaluate/` 仍是 v1 内容;7 代进化从未
同步安装目录,用户新会话实际用 v1。生态调研(research/preset-version-ui-research.md)
结论:完整功能(preset 内容版本选择器)生态空白,组件级现成件可拼装——
头部下拉+热切换 = jeffcwj/dsh-preset-switcher;目录同步器 = dsh-liangshen
src/sync.ts;owner 标记 = CTWCTW9999/dsh-agent-preset-router(临时目录+rename)。

## Requirements

- R1 同步器为纯函数模块(参考 liangshen sync.ts 思路 + router 的
  owner 标记 + 临时目录 rename 原子性),TS 实现放
  `packages/dsh-eval-console/src/domain/version-sync.ts`。
- R2 protocol.ts 增 action `{ kind: 'switch-revision'; revisionId: string }`
  (exactKeys 2 键,非破坏操作不需要 confirm token)。
- R3 host-service.apply() 增 switch-revision 分支:digestForRevision →
  revisionContent → syncRevision(目标根 = `$DSH_HOME/.agent-presets`)→
  追加审计事件 → 返回 `{ ok, action: 'switch-revision', revisionId, digest,
  targetDir, files }`。
- R4 Client 会话头部下拉:`conversation.session.header.actions` 插槽,
  id `eval-version`, order 30;数据读 GET /eval/state(history + current
  ✓ 标记),选中 POST /eval/action switch-revision,成功后提示目标目录。
  注册形态照 ui-agent-preset/src/client/index.ts:170-177 与
  dsh-session-id/src/client/index.ts 范例。
- R5 本轮不做 recompose 热切换(活跃会话即时换 preset 留后续);
  同步后新会话的模式选择器即可选中 `evaluate-<digest8>` 目录。
  fence 复用现有 isTrustedEvalRequest(loopback + sec-fetch-site)。
- R6 审计事件格式与 evolution-controller 一致:
  `{ op: 'audit', ts, event: 'switch-to-revision', logicalId, revisionId,
  digest, targetDir }`,append 到 console 已解析的 auditFile(evolution-audit
  ledger)。

## Acceptance Criteria

- [ ] AC1 同步器:revision files 写入 `<agentPresetsRoot>/evaluate-<digest8>/`
      幂等(内容一致跳过重写);owner 标记 `.dsh-preset-owner.json`
      `{ package: 'dsh-eval-console', kind: 'revision', revisionId, digest,
      syncedAt }` 写入;临时目录 `*.installing-<pid>` + rename 原子提交,
      失败清理不留残迹。
- [ ] AC2 owner 保护:目标目录已存在且 owner.package !== 'dsh-eval-console'
      → 抛错拒绝(`refusing to overwrite <dir> (owned by <pkg>)`),不写任何
      文件。
- [ ] AC3 switch-revision action:parseActionEnvelope exactKeys 校验通过;
      未知 revision → 400 错误;成功后 audit ledger 追加 switch-to-revision
      事件,事件可被现有 readAuditEntries 解析。
- [ ] AC4 头部下拉:会话头部出现「版本」下拉,列出 history(current 带 ✓),
      点击非当前版本触发同步,成功提示目标目录,失败提示错误;下拉数据
      来自 /eval/state 且随 SSE 刷新。
- [ ] AC5 真实验证:对真实 registry(C:/Users/daixu/.dsh/preset-registry,
      current evaluate-94a7c40b)执行一次同步 → 安装目录出现
      evaluate-94a7c40b/ 且内容与 revisionContent 一致;GUI 模式选择器
      (新会话)可选中该 preset。
- [ ] AC6 全量回归:packages/dsh-eval-console 测试(node:test 单进程)+
      evolution-controller + preset-registry 全部通过;registry 指针
      evaluate.current.json 不变(promote 语义未动)。

## Notes

- 不改 E:\github\dsh(DSH 本体);只改 E:\github\dsh-eval 下的
  packages/dsh-eval-console。
- 安装目录目标 id = `evaluate-<digest8>`(revisionId 本身是
  `<logicalId>-<digest8>`,满足 preset id 规则 `[a-z0-9][a-z0-9-]*`)。
- 本任务由主会话写计划并派 subagent 实施;subagent 不 git commit,
  主会话审 diff 后提交。
