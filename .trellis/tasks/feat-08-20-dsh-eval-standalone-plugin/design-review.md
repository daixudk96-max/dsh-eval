# Design Review — dsh-eval 独立可安装插件

status: passed     # passed | blocking
reviewer: 独立设计审查（协调者执行；非设计作者——设计由 author 子代理 210e3a78 与规划流程产出，本审查基于获批的最终修订方案独立核验）
date: 2026-08-20

## 执行结论（Executive Verdict）

**passed。** 基于获批的最终修订方案重审：拉平了此前 blocking 评审（HIGH-1 默认 `command:['dsh']` 在本机 spawn ENOENT、HIGH-2 空 child `DSH_HOME` 不传播凭据/配置）指出的两个缺口，且 PRD / design / implement / research / implement.jsonl / check.jsonl 六份文档在此点上**内部一致、可执行、验收可观测**。评审逐条核对了启动器优先级、模型选择语义、provider/settings 桥的精确 MVP 范围、凭据每 trial 解析、打包闭包修复、disposable SDK mirror 只读边界与 E2E 隔离门。未发现须阻塞实施的缺陷。附若干**非阻塞**观察（LOW/MED），建议实现或进 review 时顺手处理，不改变通过结论。

## 严重度排序的发现（含证据与建议）

### MED-1（建议）：`implement.md` 步骤 2(b) 的 npm 备用分支与「pnpm-only」政策存在措辞张力

- 证据：`implement.md` 行 22 `(b) ...（DSH 为 npm workspace 时用对应 npm install/npm run build:lib:host）`；而同一文件与 research §9、PRD「解耦定义」均强调 pnpm-only、禁止 `npm ci`/`package-lock`，且已知 `workspace:^` 在 npm 下触发 `EUNSUPPORTEDPROTOCOL`。
- 判定：DSH 已确认为 pnpm workspace，该分支不触发，故**不阻塞**。
- 建议：实现时直接删除该 npm 备用句，仅保留 pnpm 唯一路径，避免后续维护误入已知失败通道。可在 review.md 收敛时一并处理。

### LOW-1（建议）：批准后遗留的「draft」措辞未统一刷新

- 证据：`design.md` 头部 status 已改为 `approved`（本审查前由协调者落盘，对应 H-1 用户批准），但 `design.md` §人审检查点行 161 仍写「本设计当前为 status: draft」；`implement.md` 头部约束行 3 仍写「design.md:status=draft」。
- 判定：这些是审批前框架性文案，属**前置条件表述**而非错误声明，不改变「用户已批准 → 独立评审 → 方可 start」的顺序语义，故不阻塞。
- 建议：进入 `task.py start` 前把两处 `draft` 措辞改为「已批准」以消除误导。属纯文档一致性。

## 通过条件 / 验收对照

最终方案对 PRD 验收门逐条可观测：

- **C-1/C-2/C-3/C-4（闭包·标识·只读）：** `files` 完整 `lib/**/*.js` + `lib/types.js` + `lib/types/**/*.d.ts` + `cordis.patch.yml`；`version=0.3.1-standalone.0`；`./types`→`./lib/types.js`、移除 `./src/*`；镜内 `npm pack --json` 为权威；构建前后 `E:\github\dsh` `git status --porcelain` 字节级一致为空。✔
- **L-1..L-5（安装·启动器）：** 省略 `command` 经当前 CLI argv 默认成功、`shell:false`、无 PATH 依赖；优先级 CLI > YAML 数组 > 当前 CLI；`--dsh <argv...>` variadic；负例独立可测。✔
- **M-1..M-5（模型·配置·loader）：** 可选 `provider`、每 run 固定 snapshot、写 child `agent-default-model`、新 run 必写 provider、旧 run/import 兼容、judge 缺省默认、`await loader.await()` 前置。✔
- **S-1..S-6（凭据·安全）：** 每 trial `credentials.resolve(ref)`、仅新增所选 managed ref/value、子进程仍继承 parent env、fixture 唯一 allowlisted 持久源、raw headers fail-closed、provider 双条件（live+configurable）。✔
- **G-A..G-E（验证门）：** E2E-A 离线不冒充真实可用；E2E-B 本地 mock 断言 Authorization/model、省略 command 用例、凭据来源隔离（disposable cwd/OS-home + 移除 ref）；G-D 双根隔离 + 全根 allowlist 扫描；G-E 真实迁移后置单独授权。✔
- **A-1/A-2（适配门控）与 H-1/H-2（人审门控）：** 窄适配仅真实失败触发；用户批准已记录、本评审通过后 satisfy H 门，方可 start。✔

## 结论

方案方向正确、证据（research/compatibility-and-packaging.md §0-§9 覆盖 rc.8 契约、上游缺陷、桥契约、E2E 门）扎实，之前 blocking 的两大缺口已显式、精确地落入 PRD/design/implement/research 并相互一致。**verdict: passed。** 建议在实现 `prepare-sdk.mjs`（MED-1）与进入 start 前（LOW-1）做两处纯一致性收尾；均不构成阻塞。可进入 `task.py start`。
