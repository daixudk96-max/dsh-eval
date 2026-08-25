# Design — Preset 版本选择器

## D1 目标目录命名与位置

- 同步目标根:Host 侧 `agentPresetsRoot = $DSH_HOME/.agent-presets`
  (resolveHome() 同 src/index.ts,`process.env.DSH_HOME ?? os.homedir()/.dsh`)。
- 目标目录:`<root>/evaluate-<digest8>/`。revisionId 恒为
  `<logicalId>-<digest8>`,满足 preset id 规则 `[a-z0-9][a-z0-9-]*`,
  无需额外转换。digest8 取 digest 前 8 字符(与 revisionId 后缀一致)。

## D2 同步器 API(src/domain/version-sync.ts,纯函数,无服务依赖)

```
interface SyncRevisionOptions {
  agentPresetsRoot: string   // $DSH_HOME/.agent-presets
  logicalId: string          // 'evaluate'
  digest: string             // 64-hex
  files: Record<string, string>  // revisionContent().files(relPath -> text)
  ownerPackage?: string      // 默认 'dsh-eval-console'
}
syncRevision(opts): Promise<{ dir, targetId, written: string[], skipped: string[], existed: boolean }>
```

- targetId = `${logicalId}-${digest.slice(0, 8)}`;dir = join(root, targetId)。
- owner 文件 `.dsh-preset-owner.json` 内容:
  `{ package, kind: 'revision', revisionId: targetId, digest, syncedAt: ISO }`。
- 流程(参考 dsh-agent-preset-router 安装器 + liangshen sync.ts):
  1. 若 dir 存在:读 owner 文件(容错:不存在按非本插件处理?)——
     **决策:目录存在但 owner 缺失或 owner.package !== 本插件 → 抛错拒绝**
     (保守,防覆盖;与 AC2 一致)。
  2. 幂等:对每个 relPath,已存在且内容相同 → 记 skipped;否则待写。
  3. 无待写且 owner 已是最新 → 直接返回(existed: true, written: [])。
  4. 原子提交:临时目录 `${dir}.installing-${process.pid}`,写全部文件 +
     owner,rename 到 dir;失败清理临时目录(rm -rf try/catch)。
- 路径安全:files 键必须是相对路径,拒绝绝对路径与 `..` 段
  (path.resolve 校验在 dir 内)。

## D3 protocol 扩展(src/domain/protocol.ts)

- `EvalAction` 增:
  `| { kind: 'switch-revision'; revisionId: string }`
- parseActionEnvelope 增分支:exactKeys(action, ['kind','revisionId']),
  revisionId 非空 string。非破坏操作,无 confirm token。
- `EvalActionResult` 增:
  `| { ok: true; action: 'switch-revision'; revisionId: string; digest: string; targetDir: string; files: Record<string,string> }`

## D4 host-service.apply() 分支

```
case 'switch-revision': {
  const digest = await this.digestForRevision(action.revisionId)
  if (digest === null) throw new Error(`unknown revision: ${action.revisionId}`)
  const content = await this.registry.revisionContent(digest)
  if (content === null) throw new Error(`revision content unavailable: ${digest.slice(0,8)}`)
  const result = await syncRevision({
    agentPresetsRoot: this.agentPresetsRoot,
    logicalId: this.logicalId,
    digest,
    files: content.files,
  })
  await appendAuditEvent(this.auditFile, { op:'audit', ts: new Date().toISOString(),
    event: 'switch-to-revision', logicalId: this.logicalId, revisionId: action.revisionId,
    digest, targetDir: result.dir })
  return { ok: true, action: 'switch-revision', revisionId: action.revisionId,
    digest, targetDir: result.dir, files: content.files }
}
```

- EvalConsoleHostOptions 增 `agentPresetsRoot: string`(index.ts 传入
  `path.join(resolveHome(), '.agent-presets')`)。
- 审计追加:新 `appendAuditLine(file, entry)` helper(直接
  fsp.appendFile(file, JSON.stringify(entry)+'\n'),与 evolution-controller
  fs-store.appendLedger 同模式;失败不阻塞同步结果,但 console.error
  记录——审计尽力而为,同步本身已成功)。放 src/audit.ts。

## D5 Client 头部下拉

- 注册(照 ui-agent-preset/src/client/index.ts:170-177 + dsh-session-id
  src/client/index.ts 模式):
  ```
  ctx.slots.inject('conversation.session.header.actions', () => {
    try {
      return ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'eval-version',
        order: 30,
        locale: NS,
        inject: () => ({}),
      }, VersionSelect)
    } catch { return () => {} }
  })
  ```
- VersionSelect 组件(client/VersionSelect.tsx):
  - 挂载与 SSE:fetch GET /eval/state 拿 {current, history};SSE
    /eval/events 收到 revision 变化时重拉 state(复用 host-api.ts 现有
    通道,或新增轻量 fetch;组件内部自持)。
  - 渲染:小按钮「版本 ▾」+ 下拉列表:current 行 ✓ + `evaluate-<digest8>`,
    previous 行按 history 顺序(带 digestShort);点击当前版本 → 无操作;
    点击 previous → POST /eval/action
    `{ requestId, action: { kind:'switch-revision', revisionId } }` →
    成功显示 `已同步到 <targetDir>,新会话可选`;失败显示错误消息。
  - 只读优先:同步不触碰指针;fence 复用现有 isTrustedEvalRequest。

## D6 明确不做(本轮范围外)

- recompose 热切换(活跃会话即时换 preset)——preset-switcher 机制,
  需 agentPresets/agents 服务与 recompose 调用,风险高,留后续。
- promote 后自动同步安装目录(CLI 侧自动同步)——留后续任务。
- 版本回滚入口(UI 已有 rollback,不重复)。

## D7 测试

- test/version-sync.test.js(node:test 单进程,tmpdir 真文件系统):
  写入/幂等/owner 拒绝/原子提交失败清理/路径逃逸拒绝。
- test/protocol.test.js 增 switch-revision 用例(exactKeys 通过/缺键拒绝/
  空 revisionId 拒绝)。
- test/service.test.js(或 host-service 现有测试)增 apply 分支:
  mock registry + mock audit append 断言调用链与返回值。
- 真实验证:node 脚本或直接对真实 registry 跑 syncRevision 一次
  (AC5,由实施 subagent 完成并留产物;GUI 浏览器验证由主会话协调,
  用户侧确认)。

## 风险

- conversation.session.header.actions 的 owner props 面(rc.8
  ConversationHeaderActionOwnerProps)若注册时要求特定 inject,按
  ui-agent-preset/ui-jobs 范例提供;最坏回退:conversation.view
  evolution 标签内嵌版本条(AC4 仍满足)。
- 审计文件写权限:evolution-audit ledger 由 evolution-controller
  追加,console 追加同一文件并发安全(appendFile 原子行写)。
