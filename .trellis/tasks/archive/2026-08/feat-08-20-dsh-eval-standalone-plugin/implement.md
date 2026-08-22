# Implement Plan — dsh-eval 独立可安装插件

> 约束：本任务现已通过 H 门（用户 2026-08-20 批准；`design.md:status=approved`；独立 `design-review.md` 产出 `passed`），可进入 `task.py start`/实现。期间不得修改 `E:\github\dsh`、不得触碰 `web` profile。

## 有序步骤

### 1) Provenance baseline（溯源基线）

- 固定上游锚点：`research/dsh-eval-src` @ `47f39d7c1453de16b7ed1a3846980d0765eb1f3a`，记录 `git rev-parse HEAD` / `git log --oneline -1` / `package.json:version` / `package.json:files` / `tsconfig.build.json`；包名 `dsh-eval`、新版本 `0.3.1-standalone.0`。
- 固定宿主锚点：`E:\github\dsh` @ `0.1.0-rc.8` / `141eb6fef8`，记录消费者视角宿主 ABI 与内部实现证据的函数名区分（`composeEntries`/`applyEntryPatches` 仅研究引用，不作为运行时依赖）。
- 固定调用约定：`apps/cli/src/args.ts:13-14` — 仅 `web` 为硬编码别名，通用 `dsh --profile <name> <inner-args...>`。
- 固定 rc.8 公开 service 契约（只读消费）：`loader.await()`、`agentDefaultModel.currentSelection()`、`llm.listProviders()`/`llm.listConfigurableProviders()`、`settings.describe({redactSecrets:true})`、`credentials.resolve(ref)`（含 deepseek `DEEPSEEK_API_KEY`/pi-ai route `apiKeyEnv`）。
- 固定 shipping 布局：实现落在真实 tracked 目录 `packages/dsh-eval/`；从只读 nested provenance clone `research/dsh-eval-src/packages/eval` 导入 `src/`/`tests/`/`package.json`/`tsconfig*.json`/`README*`/`LICENSE`/`cordis.patch.yml`；绝不改 nested clone；`packages/dsh-eval/UPSTREAM.md` 记录 origin/commit/copy mapping/local delta。
- 固定本机 eval profile 基线：`C:\Users\daixu\.dsh\profiles\eval\package.json` 与 `pnpm-lock.yaml` 快照，仅作迁移前备份参照。
- **产出：** `research/compatibility-and-packaging.md` 已存在即为证据。

### 2) rc.8 build baseline（编译基线，disposable SDK mirror）

- 维护者构建**不把真实 DSH checkout 作为 pnpm workspace junction**。运行 `packages/dsh-eval/scripts/prepare-sdk.mjs --dsh <checkout>`：先校验 `git -C <checkout> rev-parse HEAD` == `141eb6fef8`，再用 `git -C <checkout> archive <sha>`（或等价只读复制）把完整 tracked DSH workspace 展开到**被忽略的** `packages/dsh-eval/.sdk/dsh/`；把 shipping 工作副本复制到镜像内匹配 `packages/*/*` 的临时 member（如 `.sdk/dsh/packages/eval/dsh-eval`）。
- 在**镜像内**执行精确顺序（为避免 `tsconfig.host.json` glob / tsdown 在 host 构建阶段看到临时 eval package，**先构建 host、后插入 member**；全部变化只在 `.sdk/`）：
  (a) `git -C <checkout> archive <sha>`（或等价只读复制）展开 pinned DSH 到 `.sdk/dsh`；
  (b) 在**未插入 member 的原生镜像**内 `pnpm install --frozen-lockfile` → `pnpm run build:lib:host`（实为 `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`，已对照 DSH 根 scripts 确认；**仅 pnpm**——DSH 为 pnpm workspace，`workspace:^` 在 npm 下会触发 `EUNSUPPORTEDPROTOCOL`，绝不使用 `npm ci`/`package-lock`）；
  (c) **之后才**把 shipping `packages/dsh-eval` 复制进镜像 member `packages/eval/dsh-eval`；
  (d) 第二个隔离安装 `pnpm install --no-frozen-lockfile`（或 `--filter` 等价）——**因 pinned lock 没有为新插入 package 生成 importer；lock 变更仅允许在 `.sdk/`**；
  (e) `pnpm --filter dsh-eval run typecheck` → `build` → `test`；
  (f) 把 shipping `lib/**` 与测试证据**复制回** shipping package。
  确认 `lib/*.js` + `lib/types/*.d.ts` + `lib/types.js` 全量产出。**绝不写笼统的根 `pnpm run build`**（隐含构建整个 DSH 产物）。真实 `E:\github\dsh` 只被 git 只读访问。
- 镜像可清理/重建（重复可复现）；`.sdk/`/`node_modules`/`lib`/`dist` 链接或产物**不进 tarball**。消费者不需要 SDK。
- **门控：** 构建前/后对真实 `E:\github\dsh` 执行 `git status --porcelain` 必须字节级一致且为空（不得以修改 DSH 完成构建）；`lib/` 在镜像内缺失即判定为构建配置问题，修复 `tsconfig.build.json`/`package.json:scripts` 后重试，不进入打包。

### 3) Red package tests（红测：先让打包失败可被捕获）

- 新增打包回归测试：在**镜内 package `.sdk/dsh/packages/eval/dsh-eval`（deps + DSH host libs 就绪）**内 `npm pack --json` 产出实际 tgz（prepack 可重建）→ 复制该 tgz + pack JSON/shasum 到 `packages/dsh-eval/dist/` → 解包后**递归校验 package 内相对 ESM import 可 Node 解析**、**每个 `exports`/`main`/`types` target 存在**（含 `./types`→`./lib/types.js`；确认 `./src/*` 已移除）；文件集含 `lib/*.js` + `lib/types.js` + `lib/types/*.d.ts` + `cordis.patch.yml` + `package.json`，不含 `research/`/`.trellis/`/DSH checkout 文件/链接/绝对路径；断言 `name=dsh-eval`/`version=0.3.1-standalone.0`。**运行 import/boot 在用「同一个 tgz」安装进临时 DSH profile 后验证**（不要求裸解包目录在无 peers 时完整执行 `lib/index.js`；不在源码根承诺直接 `npm pack`）。
- **门控：** 当前上游（`./types`→缺失的 `lib/types/types.js`、含 `./src/*`）下应为红（失败），作为修复回归锚点。

### 4) Minimal package fix（保留 runner 的最小打包修复）+ 显式产品桥（launcher/模型/provider/凭据）

打包部分（延续 + exports 修复）：
- `files → ["lib/**/*.js","lib/types/**/*.d.ts","lib/types.js","cordis.patch.yml"]`（等价全量枚举亦可）；`name=dsh-eval`、`version=0.3.1-standalone.0`；`exports`/`main`/`types` 与 `files` 一致且**每个 target 在解包 tgz 内存在**——**`./types` runtime target 改为 `./lib/types.js`**（上游错指 `lib/types/types.js`），**移除 `./src/*` public export**（内部源码入口不在 drop-in 兼容承诺内，保留 `./package.json` 等合法 target）；`prepack` 保持 `pnpm run build`；README 修正 `dsh eval run` → `dsh --profile eval run`。
- **新 run 写 `provider`**；类型/渲染允许 `provider` 缺失并显示 legacy/imported unknown，report/compare 处理旧文件不失效。

显式产品正确性工作（本步与 runner 语义分开实现、独立单测）：
- **loader-settle（并入 index.ts:apply）**：eval 异步执行在读取 `agentDefaultModel`/`llm`/`settings`/`credentials`/`judgeChat` 之前，先 `await ctx.get('loader')?.await()`；settlement 后缺失服务则可读 fail-fast（对齐 `headless/src/index.ts:96-106` 与 `app-boot/src/index.ts:782`）。
- **launcher.ts（新）**：`resolveLauncher({cliOverride?, benchmarkCommand?, process}, ctx)` — 优先级 CLI argv 数组 override ＞ benchmark `command` 数组 ＞ 当前 CLI argv `[process.execPath, resolved process.argv[1]]`。省略 `command` 经当前 CLI argv 默认值**成功**（`shell:false`，无 PATH 依赖）；**仅当**当前 launcher 无法解析或显式 argv 无效时才 fail early（可读诊断 + 退出码 1）；不调用上游 `splitCommand` 空白拆分。**`--dsh <argv...>` 用 Commander variadic**（逐 token 保留 shell quoting；复杂/带前导 `--` 参数优先 YAML `command`）。单测含 Windows 空格路径 + 负例。
- **model.ts（新）**：`resolveModelSelection(benchmark, ctx)` → `{provider, model}`（`provider: benchmark.provider ?? ctx.agentDefaultModel.currentSelection().provider`；`model: benchmark.model`）；**每 run 固定 snapshot**（可复现）；judge 缺省（provider=有效 benchmark provider；model=benchmark model）。
- **settings-bridge.ts（新）**：`buildChildSettings(selection, ctx)` — `llm.listProviders()`（当前 live）**且** `llm.listConfigurableProviders()`（有 ns/path）**同时**命中才自动桥；`settings.describe({redactSecrets:true})` 抽该 provider 子树；写最小 `settings.yaml`（`agent-default-model` + 单 provider 子树）。**只在 configurable directory 但未 live 的 route 启动/选择前可读报错**。外部 provider bundle/非目录 route 不自动复制、清晰报错，逃生口为**显式 wrapper command** 自行管理/覆盖 child profile、DSH_HOME 与凭据策略（不暗示仅写 `benchmark.profile` 即自动安装外部 bundle）。redacted 关键字段或**非空 raw `headers`** → fail-closed（不物化，提示用显式 wrapper command）。不整份复制父文档。
- **credential-bridge.ts（新）**：`resolveCredentialRef(selection, ctx)`（每 run 随 settings snapshot 确定 ref）+ `resolveCredentialValue(ref, ctx)`（**每个 case×trial spawn 前**调用父 `ctx.credentials.resolve(ref)`，不 per-run 缓存）→ `{ref, value}`；route 无命名 ref → none（依赖继承 env/provider-native）；命名 ref 未解析 → 可读诊断（含 ref 名副、不含值）。**仅从 managed credentials store「新增」该 ref/value 到 child env**（child 仍继承 parent `process.env`——PATH/HOME/TEMP 及既有 ambient env，不声称 child 只看到这一个凭据）；绝不落盘/日志。
- **runner.ts 接线**：保留调度语义；按上述桥传入 launch argv / child `settings.yaml` / 每 trial 单 ref env 注入；**新 run 写 `provider`+`model`**（`provider` 缺失的旧文件/import 渲染为 legacy/imported unknown，report/compare 不失效）。
- **显式保留：** 不重写 runner 调度/隔离/超时/分级/report；`cordis.patch.yml` 不新增无关层；不引入未被真实失败触发的适配器（`trace`/`metrics`/`judge`/`types`/`invariant`/`command.parseCmdline` 仍失败门控）。
- **门控：** 步骤 3 打包测试转绿；桥的单测（launcher 优先级/空格路径、model 选择、settings 子树抽取 + fail-closed、credential 注入扫描）通过；**镜内 `npm pack --json` 产出 `.tgz` 并复制 JSON+shasum 到 `dist/`**；tarball 无 DSH 绝对路径。

### 5) Temporary profile E2E（disposable test root，双根隔离）

- **隔离模型：** 创建一个 disposable test root（`New-Item -ItemType Directory -Path ([IO.Path]::GetTempPath() + "dsh-eval-standalone-<rand>")`）；在其下分配 **parent-home** 与 **trials** 两个不同根。`$env:DSH_HOME = <test-root>\parent-home`；通过 runner option 或启动环境 `TEMP`/`TMP`/`TMPDIR` 把 `tmpdir()` 约束到 `<test-root>\trials`。profile 名 `eval`（在该 test root 下即为 `<test-root>\parent-home\profiles\eval`）。断言均基于 test root，不得断言 `C:\Users\daixu\.dsh\profiles\...`。
- 安装：`dsh plugin --profile eval add <path-to-tgz>`（**使用步骤 3/4 产出的同一个 tgz**——该 tgz 就是运行 import/boot 的验证对象）；断言退出码 0、无 bundle 警告、`dsh.profile.bundles` 收敛 `["@deepseek-ai/dsh-base","dsh-eval"]`、dependencies 含本产物。
- 冒烟：`dsh --profile eval --help` 列出 `run`/`report`/`compare`/`import`；各子命令 `--help` 可达（无额外 `eval` token）。
- **G-A / E2E-A（离线确定性，必过）：** benchmark `command` 指向 `fake-dsh.mjs`（或 `replay` 用 `llm-replay`）；`dsh --profile eval run <benchmark.yaml> --out <test-root>/run.json` 完成；断言 `run.json` `aggregate`/`grading` 非空、`renderMarkdownReport` 可渲染；凭据扫描。
- **G-B / E2E-B（本地 mock-provider，必过）：** 父 home（`<test-root>/parent-home`）写 `.credentials.yaml`（fixture secret e.g. `DEEPSEEK_API_KEY: sk-test-...`）+ settings（`agent-default-model` + `llm-deepseek.baseURL` 指向本地 mock）；父 `agentDefaultModel`/`llm`/`settings`/`credentials` 桥 → 最小 child `settings.yaml` + child env → **真实 rc.8 headless/provider 栈**，本地 mock server 断言 `Authorization` 头值与所选 model 到达 mock、**无外部计费**；**断言输出 `run.json` 的 provider+model 与 mock 请求一致**；**覆盖一个省略 `command` 的 benchmark（经当前 CLI argv 默认值成功）用例**；**凭据来源隔离（必选）**：因 credentials-local 优先级 = 继承 env ＞ 父 `.credentials.yaml` ＞ 项目/用户 `.env`，run 进程用 testRoot 下 **disposable cwd** + **disposable OS-home**（`HOME`/`USERPROFILE`）且**无 `.env`**，spawn 前**按大小写不敏感移除所选 ref**（如 `DEEPSEEK_API_KEY`），使 mock 收到的 fixture `Authorization` **唯一归因于父 `.credentials.yaml`**；不全局改写/记录真实环境；此隔离仅作用于 E2E-B run 进程，产品 runner 仍继承 parent `process.env`。
- **G-D 断言：** 断言父 `<test-root>/parent-home/profiles/eval` 与每个 trial `<test-root>/trials/<...>/dsh-home/profiles/headless` 均在 test root 内；**整个 test root 扫描仅配精确路径 allowlist（父 `.credentials.yaml` 源，断言其包含 fixture），任何第二次出现即失败**；**断言无任何 child 位置存在 `.credentials.yaml` 副本**；断言该 secret 在 `run.json`/session JSONL/child `settings.yaml`/overlay/trial workspaces/log captures 中不出现（产品/插件「不持久化」）。
- 清理：删除整个 test root（parent-home + trials），不留凭据。
- **门控：** E2E-A 与 E2E-B 均绿灯是任何适配/真实迁移的前置条件；E2E-A 不得充当「真实评测可用」证据，E2E-B 才是。

### 6) Conditional adapters（失败门控的窄适配）

- 仅当步骤 5 在 rc.8 上以真实错误失败时，才按 `research/compatibility-and-packaging.md §5` 候选表引入适配，且每次仅一个失败：`trace.ts` ← `decodeStorageRecord`/`SessionId` 失败；`metrics.ts` ← `isTokenDelta` 导入失败（复现后基于 rc.8 精确 leaf 字段）；`judge.ts` ← `llm.stream` 不可用；`types.ts`/`invariant.ts` 仅在启动失败时；`command.ts:parseCmdline` 仅在 `ctx.cmdlineArgs` 解析漂移时。
- 每个适配附 `research/adapters/<name>.md`（失败日志、rc.8 版本、复现命令、适配前后 trace 对比）+ 最小回归用例。
- **说明：** launcher/模型/provider/凭据桥为显式产品工作（步骤 4），不属于本门控。
- **门控：** 若步骤 5 已绿灯，以「零适配绿灯」结案，不引入预防性代码。

### 7) Docs / release artifact（文档与发布产物，自 `packages/dsh-eval/`）

- 在 `packages/dsh-eval/` 内：`dist/*.tgz`（`dsh-eval-0.3.1-standalone.0.tgz`）**= 镜内 package `npm pack --json`（prepack 可重建）产出的已验证 tgz 的直接拷贝**（连同 pack JSON/shasum）；`dist/release/dsh-eval/` GitHub-release-ready 目录（`lib/` 完整 + `cordis.patch.yml` + `package.json` + `README.md` + `LICENSE`）**由该已验证 tgz 派生**（防发散），均不含 DSH 文件/链接/绝对路径；`packages/dsh-eval/UPSTREAM.md` 记录 origin/commit/copy mapping/local delta。
- prepack/闭包门（权威 = 镜内 package 的 `npm pack --json`，prepack 可重建）必须**排除**整个 `.sdk/**`（含其生成 node_modules/lib/lock）、shipping `node_modules/**`、`dist/**` 自产物/链接及任何绝对路径/symlink；**包含** shipping `packages/dsh-eval/lib/**` 生成产物（从镜像复制回专用于打包）。（`.sdk/` 在 package-local `.gitignore`。）
- 文档：`README.md` 新增「One-command install」+「Benchmark launcher & credentials」章节（省略 `command` 经当前 CLI argv 默认值成功、`command` 数组写显式覆盖或把 DSH bin 加 PATH、`agent-default-model` 选择、**runner 继承 parent `process.env`、仅从 managed store 新增所选 provider 的一个 ref/value、`.credentials.yaml` 不随空 child home 传播、每 trial 解析凭据、非空 raw `headers` fail-closed 与显式 wrapper command 逃生口（child profile/DSH_HOME/凭据策略自管）、Windows 空格路径、fixture 扫盘只证不持久化不证环境无其他 secret、E2E-A 不等于真实评测可用**）。
- **门控：** 镜内 `npm pack --json` tgz 的闭包校验与 `dist/`（验证后拷贝）一致性 + 凭据扫描通过。

### 8) Real eval profile migration（真实 eval 迁移，仅临时绿灯后 + 单独授权）

- 人审前置：出示步骤 5 临时绿灯证据（E2E-A 与 E2E-B）+ 用户显式批准。
- 备份：`Copy-Item -Recurse C:\Users\daixu\.dsh\profiles\eval C:\Users\daixu\.dsh\profiles\eval.bak.<timestamp>`，记录 SHA。
- 迁移：`dsh plugin --profile eval add <path-to-tgz>`，重复步骤 5 冒烟 + 最小 E2E-A；凭据桥经 E2E-B 已验证，不重复真实付费。
- **回滚：** `dsh plugin --profile eval remove dsh-eval` + 恢复备份 + `dsh --profile eval --help` 校验。

### 9) trellis-check（质量门）

- 执行 `.trellis/spec/` 定义的质量门：`pnpm run build` + `pnpm test`（含步骤 3 打包回归 + 桥单测）；`npm pack --json` 产 tgz + 解包 exports/main/types target 存在断言；一次性 profile E2E-A/B 日志与 `run.json` 摘要（含凭据扫描）；真实迁移（若获批）附备份 SHA 与回滚演练。

## 验证

- `pnpm run build`（`tsc -p tsconfig.build.json`）无错误。
- 打包回归：在**镜内 package `.sdk/dsh/packages/eval/dsh-eval`** 内 `npm pack --json` 产实际 tgz（prepack 可重建）→ 复制到 `dist/` → 解包递归校验相对 ESM import + 每个 `exports`/`main`/`types` target 存在（含 `./types`→`./lib/types.js`，无 `./src/*`）、`version=0.3.1-standalone.0`、无 DSH 残留；**运行 import/boot 在用该 tgz 安装进临时 profile 后验证**。
- 桥单测：launcher 优先级 + Windows 空格路径 + **省略 `command` 成功** + **launcher 无法解析/显式 argv 无效的负例**；loader settlement（缺失服务 fail-fast）；model 选择（`benchmark.provider` vs parent 默认，每 run 固定 snapshot）；settings 子树抽取 + redacted fail-closed + **非空 raw `headers` fail-closed** + **provider scope（DeepSeek/pi-ai；外部 route 报错）**；credential ref 每 run 固定 + **value 每 trial resolve（不 per-run 缓存）** + 不落盘扫描。
- 隔离 E2E-A：disposable test root（parent-home + trials）内 `dsh --profile eval run` 产出 `run.json` 且 grading/report 非空、`--help` 展示子命令、无 bundle 警告、凭据扫描。
- 隔离 E2E-B：本地 mock-provider 断言 Authorization/model 到达 mock、无外部计费、**覆盖省略 `command` 用例**、双根 profile 归属；**整个 test root 扫描配精确 allowlist（父 `.credentials.yaml` 源）、断言无 child `.credentials.yaml` 副本、插件生成/输出位置无 fixture**。
- 真实迁移（仅获批后）：备份 SHA、迁移日志、回滚演练、凭据扫描。

## Review / 验证门

- [ ] 已按项目质量门验证（`trellis-check`），证据记录在本文件与 review.md。
- [ ] Tarball 闭包测试纳入回归，`files` 回退在 CI 失败而非用户安装时失败。
- [ ] launcher/模型/provider/凭据桥有对应单测 + E2E-B 证据；任何窄适配器有真实 rc.8 失败证据归档，否则未引入。
- [ ] E2E-A 未被声明为真实评测可用证据；E2E-B 为「真实 rc.8 headless/provider 栈可用」的必过 gate。
- [ ] 若仅文档改动：注明无需运行验证（本任务不适用）。

## 回滚点

- 步骤 4 前：`git checkout -- packages/dsh-eval/package.json` + 删除 `packages/dsh-eval/dist/` 回滚打包修复；桥为新增文件，删除即可。
- 步骤 5：删除整个 disposable test root（parent-home + trials）；不影响真实 `eval` profile。
- `.sdk/` 镜像：仅维护者脚本创建，进 `.gitignore`、不进 git/tarball；重建 = 删除 `.sdk/` 后重跑 `prepare-sdk.mjs`。真实 `E:\github\dsh` 从不写入（`git status --porcelain` 恒净空）。
- 步骤 8：`dsh plugin --profile eval remove dsh-eval` + 恢复 `eval.bak.<timestamp>` + `dsh --profile eval --help` 校验；`healProfilesModuleFallback` 由 DSH 启动时自动完成。
