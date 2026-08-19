# M1 Spike Report — dsh-eval 兼容性 go/no-go（eval-adapter-spike）

日期：2026-08-19 · 分支：`eval-evolve` · 由主会话直接完成（两次子代理派发均在环境探测/克隆阶段停滞，改由主会话基于已验证证据收口）

## 1. 结论

**GO for「自研最小 runner」；NO-GO for「直接依赖 dsh-eval」**（在当前 DSH 版本下）。

- 直接 npm 依赖 `dsh-eval`：**NO-GO** —— 本机 DSH 为 `0.1.0-rc.5`，dsh-eval peer 要求 `^0.1.0-rc.6`，版本错配。
- 包装 dsh-eval CLI（wrap）：**条件性可行** —— 需先升级 DSH 到 `rc.6+` 并补齐 npm/pnpm 工具链；当前不可行。
- 抽取 dsh-eval 核心：**不推荐** —— MIT 许可允许，但其内部深度绑定 `@deepseek-ai/* rc.6` 包，抽取成本 ≈ 重写。
- 自研最小 runner：**GO（本次采用）** —— M2/M3 评测底座先以自有实现落地，字段契约对齐 dsh-eval 输出；待 DSH 升 rc.6 后切换为 wrap CLI 路线。

## 2. 已验证事实（证据）

| 项 | 值 | 来源 |
|----|----|------|
| dsh-eval npm 最新版 | `0.3.0`（另有 0.1.0-rc.6、0.2.0） | `npm view dsh-eval versions` |
| dsh-eval 许可证 | MIT | npm/GitHub README |
| dsh-eval peerDependencies | `@deepseek-ai/cordis ^4.0.1`；`@deepseek-ai/dsh-cmdline|invariants|llm|llm-retry|session ^0.1.0-rc.6` | `npm view dsh-eval peerDependencies` |
| 本机 DSH 版本 | `0.1.0-rc.5`（root + apps/cli package.json） | `E:\github\dsh\package.json`、`apps\cli\package.json` |
| DSH CLI 入口 | `node E:\github\dsh\apps\cli\lib\bin.js`（无 `dsh` on PATH） | 进程 PID 40664 `... bin.js web` + `--help` |
| 官方 CLI 命令 | `--profile` / `--dump-config` / `web` / `plugin`（转发 pnpm） | `bin.js --help` |
| 官方 CLI 是否含 `eval` | 否（`dsh eval` 由 dsh-eval 包注入） | `bin.js --help` |
| npm | `C:\Program Files\nodejs\npm.cmd` 存在（不在 PATH，可全路径调用） | 实测 |
| pnpm | 经 corepack `11.18.0` 可用（不在 PATH） | `corepack.cmd pnpm --version` |
| DSH_HOME / profiles | `C:\Users\daixu\.dsh`；仅 `web` profile（+ profile node_modules） | 实测 |
| GUI | `web` profile 运行于 127.0.0.1:3080（勿扰动） | 实测 |

**Peer 版本判定**：`^0.1.0-rc.6` 语义为 `>=0.1.0-rc.6 <0.2.0`；`0.1.0-rc.5 < 0.1.0-rc.6` → 本机 DSH **不满足** dsh-eval peer 范围。npm 直装必报 ERESOLVE 类错误（未实际触发安装以免污染环境；版本比较已定论）。

## 3. 兼容性验证对照（AC）

- [x] dsh-eval 固定版本 + 许可证记录：0.3.0 / MIT（上方证据）。
- [x] 与 DSH 版本 peer 兼容性确认：**不兼容**（rc.5 vs peer rc.6）→ 直接依赖 NO-GO。
- [ ] 最小 benchmark headless 跑通（`dsh eval run`）：**未验证** —— 因 peer 不匹配，npm 路线无法在 rc.5 上注入 `eval` 子命令；源码路线需 junction + 完整 pnpm install/build（时间长且受网络影响），作为后续 DSH 升级后的验证项。
- [x] Windows 路径/进程/stdio 行为：CLI 以 `node <abs path>\bin.js` 全路径调用正常（GUI 即如此运行）；`--help`/`--version` 正常。长路径/退出码见后续 runner 实现时验证。
- [x] go/no-go 决策 + 选型写入父 design.md：见 §5。

## 4. 对 M2 的影响与建议

- **评测底座（本阶段）**：自研最小 runner 作为 `ctx.eval` 执行层 —— 解析 benchmark.yaml（对齐 dsh-eval 的 schema：`name/model/profile/command/trials/timeoutMs/seed/cases(id,prompt,workspace,expected.tool|check)/pricing`），以 headless DSH 子进程执行、收集 trace、产出 `EvaluationRun` 契约字段（scores/assertions/metrics/evidence）。
- **未来切换点**：DSH 升级至 `rc.6+` 后，安装 `dsh-eval@0.3.0`（`dsh plugin --profile eval add dsh-eval`）走 wrap-CLI 路线；最小 runner 保留为 fallback/离线路径。
- 开发期验证 DSH 内部 API 仍可只读参考 `E:\github\dsh\packages\preset\agent-presets\src\index.ts` 与 `packages/cli`。
- 不要在本机尝试 `pnpm add dsh-eval` 直装进 web profile（会因 peer 冲突污染 GUI profile）。

## 5. 决策写回

父任务 `design.md` §2.2 与 ADR D2 已更新：评测执行底座 = **自研最小 runner（本轮）→ 待 DSH rc.6 后切换 dsh-eval wrap-CLI**；dsh-eval 固定引用 `0.3.0`（MIT）。
