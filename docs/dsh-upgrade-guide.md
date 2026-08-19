# DSH 升级指南（git clone 方式，rc.5 → rc.7）

> 环境基准（2026-08-19 核实）：
> - 代码仓库：`E:\github\dsh`（`deepseek-ai/deepseek-harness`，master，当前 `47f943859b` = 0.1.0-rc.5）
> - 最新版：`dsh-v0.1.0-rc.7`（origin/master = `99f6f02fec`；另有 rc.6）
> - dsh CLI：`node E:\github\dsh\apps\cli\lib\bin.js`（**不在 PATH**）
> - DSH_HOME：`C:\Users\daixu\.dsh`（profiles 仅 web）
> - node v24；npm = `C:\Program Files\nodejs\npm.cmd`；pnpm 经 corepack 0.33.0
> - **`apps/cli/lib` 不入 git**（`git ls-files apps/cli/lib` = 0）→ 升级后必须重新 build

---

## 阶段 0：升级前准备与体检

1. **确认工作区干净**：
   ```powershell
   cd E:\github\dsh
   git status --short
   git rev-parse HEAD          # 期望 47f943859b（rc.5），记录此值用于回滚
   ```
   有本地改动先 `git stash` 或提交，避免 pull 冲突。

2. **备份运行时数据**（升级不改 `C:\Users\daixu\.dsh` 配置，但重装依赖会动 profile 的 `node_modules`）：
   ```powershell
   Copy-Item C:\Users\daixu\.dsh C:\Users\daixu\.dsh.bak-rc5 -Recurse
   ```

3. **升级前插件体检（基线）**：
   - 在 GUI 会话中运行内置体检（`dsh-plugin-clinic@0.1.2` / `plugin_health`）。
   - 当前基线：critical 0 / warning 64。其中大量 `peer ^0.1.0-rc.6 … installed 0.1.0-rc.5` 告警是**预期**的（rc.5 落后于插件要求），升级到 rc.7 后自动消失。
   - 真正需要**预先处理**的只有 `@dsh-external/workflow@0.1.2`（peer 要求 `^0.0.1-rc.2`，rc.7 的 `0.1.0-rc.7` 永远不满足）：先查它是否有适配 rc.7 的新版本；没有就准备在阶段 5 停用。

---

## 阶段 1：拉取新版本代码

```powershell
cd E:\github\dsh
git fetch origin --tags
git checkout master
git pull origin master                 # master → 99f6f02fec（含 rc.7）
# 或固定到 tag：git checkout dsh-v0.1.0-rc.7
git rev-parse HEAD                     # 验证 = 99f6f02fec / rc.7
```

---

## 阶段 2：重装依赖

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
```
（npm 会自动跑 `postinstall`（lefthook）。若仓库约定用 pnpm：`corepack enable` 后 `pnpm install`。）

---

## 阶段 3：重建编译产物（必做，`bin.js` 不入库）

```powershell
# 最小可跑 GUI（host 侧）：
& "C:\Program Files\nodejs\npm.cmd" run build:lib:host
# 完整构建（含 web 前端，需要 pnpm 可用）：
# corepack enable
& "C:\Program Files\nodejs\npm.cmd" run build
```
验证产物存在：`Test-Path E:\github\dsh\apps\cli\lib\bin.js` → True。

---

## 阶段 4：更新 / 停用受影响的插件

按升级前体检清单处理（关键项）：

| 插件 | 动作 |
|---|---|
| `@aaravarr/dsh-subagent-max@0.1.1` | 无需处理 —— rc.7 满足其 `^0.1.0-rc.6` peer，告警自愈 |
| `dsh-plugin-clinic@0.1.2` | 无需处理 —— 同上自愈 |
| `@banana-peeljj12/dsh-trellis@0.1.0-rc.4` | 无需处理 —— 同上自愈 |
| `@dsh-external/workflow@0.1.2` | **停用或升级到适配 rc.7 的新版本**；无新版则：`node E:\github\dsh\apps\cli\lib\bin.js plugin --profile web remove @dsh-external/workflow`（已核实：`dsh plugin` 是 profile 场景下 pnpm 的透明包装，子命令为 pnpm 的 add/remove/update/install 等） |
| `@dsh-adaptive/*`、`@xilin3/dsh-prompt-persona` | 保留观察（`cordis not installed` 类解析告警，与版本无关） |
| `dsh-eval`（尚未安装） | M1 结论：rc.7 ≥ rc.6，`dsh plugin --profile web add dsh-eval` 路线可选；可后置决定 |

> bundle 插件的版本跟随 DSH 仓库构建/发布；若重启后体检仍显示旧版本 bundle，用 `bin.js plugin` 子命令按报告更新。

---

## 阶段 5：重启 GUI

```powershell
# 1) 停止当前 GUI（关闭窗口 / 任务管理器结束对应 node 进程）
# 2) 用新构建启动：
node E:\github\dsh\apps\cli\lib\bin.js web
```
注意：DSH 运行中占用旧 `bin.js`，**必须先停后启**；升级期间 GUI 不可用属预期。

---

## 阶段 6：升级后验证

1. 版本确认：`git -C E:\github\dsh rev-parse HEAD` = `99f6f02fec`（或 rc.7 tag）；GUI 启动日志版本 = 0.1.0-rc.7。
2. **升级后体检**：再跑一次 `plugin_health`，确认：
   - `subagent-max` / `plugin-clinic` / `dsh-trellis` 的 rc.6 peer 告警消失；
   - `@dsh-external/workflow` 已被停用或更新（若选择处理）；
   - critical 保持 0。
3. **功能冒烟**：开一个会话，确认工具列表与 approval 正常。
4. **验证 Eval+Evolution 包不受影响**（独立仓库，无需重装）：
   ```powershell
   cd E:\github\dsh-eval
   node --test packages/preset-registry/test packages/evolution-controller/test packages/security-hardening/test
   # 期望 18/18 通过
   ```
5. （可选）按 M1 决策切换到 `dsh-eval@0.3.0` wrap-CLI 路线 —— 单独执行，不在本次升级范围内。

---

## 阶段 7：回滚方案

```powershell
cd E:\github\dsh
git checkout 47f943859b                 # 回 rc.5
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run build:lib:host
node apps\cli\lib\bin.js web            # 重启
```
- 若 profile 的 `node_modules` 已被新版本覆盖：用备份恢复 `C:\Users\daixu\.dsh.bak-rc5` 或重装 rc.5 对应依赖。
- `E:\github\dsh-eval` 完全独立，无需回滚。

---

## 风险与注意

- `git pull` 前必须确认 `E:\github\dsh` 无本地改动（该仓库此前约定只读）。
- 完整 `build` 依赖 pnpm；若只构建 host 侧（`build:lib:host`）即可跑 GUI，可跳过 web 前端构建。
- 升级会短暂中断当前 GUI 会话；进行前请保存未完成工作。
- 本指南不修改任何文件；执行由用户确认后进行。
