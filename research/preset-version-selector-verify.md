# Preset 版本选择器 — 真实验证记录 (AC5)

任务: 08-25-feat-08-25-preset-version-selector · P5 真实验证
验证时间: 2026-08-25T14:31Z(主会话执行, subagent 全程独立核验代码/测试)

## 验证对象
- 插件: packages/dsh-eval-console(已装 web profile, symlink →
  E:/github/dsh-eval/packages/dsh-eval-console, 构建产物直接生效)
- 真实 registry: C:/Users/daixu/.dsh/preset-registry(logical `evaluate`)
- 真实安装根: C:/Users/daixu/.dsh/.agent-presets

## 步骤与结果

### 1. 同步真实 current revision → 安装目录
调用 lib/version-sync.js 的 syncRevision({agentPresetsRoot, logicalId:
'evaluate', digest: current.digest, files: revisionContent.files}):

```
current: evaluate-94a7c40b 94a7c40b8283
content files: agent.cordis.yml, preset.yml, README.md
sync: {"dir":"C:\\Users\\daixu\\.dsh\\.agent-presets\\evaluate-94a7c40b",
       "targetId":"evaluate-94a7c40b",
       "written":["agent.cordis.yml","preset.yml","README.md"],
       "skipped":[],"existed":false}
pointer unchanged: true
```

### 2. 目录产物核验
```
evaluate-94a7c40b/
├── .dsh-preset-owner.json  217 B
├── agent.cordis.yml       6478 B
├── preset.yml              157 B
└── README.md              1647 B
```
owner 标记内容:
```json
{"package":"dsh-eval-console","kind":"revision",
 "revisionId":"evaluate-94a7c40b",
 "digest":"94a7c40b8283ddf70559106c172bb6700b21610711c9ce8376ab04b2164dfe71",
 "syncedAt":"2026-08-25T14:31:14.467Z"}
```

### 3. 幂等二次同步
```
second sync: {"written":[],"skipped":["agent.cordis.yml","preset.yml",
              "README.md"],"existed":true}
```
内容一致时全部 skipped,不重写(owner 校验通过, 属本插件)。

### 4. 指针不变
registry.resolveCurrent('evaluate') 前后 revisionId 均为
evaluate-94a7c40b → switch-revision 不动 registry 指针(与设计 D2 一致)。

## 结论
AC5 达成。GUI 侧(头部下拉出现 + 新会话可选 evaluate-94a7c40b)依赖
GUI 重启后由用户确认;代码路径已由 subagent 独立核验
(PASS-WITH-NOTES, 37/37 单测 + typecheck 0 错误 + 回归 200/22 全绿)。
