# PRD — dsh-eval 独立可安装插件

## 背景

上游 `hccccc01333/dsh-eval` 已提供完整评测能力（benchmark YAML → `runner.ts` case×trial headless 调度 → `session.jsonl` 采集 → metrics/grading/report/compare/import），但其 npm 产物（`0.2.0`/`0.3.0`）因 `package.json:files` 白名单缺失 `lib/*.js` 无法启动，且构建依赖 `workspace:^` 的 DSH 内部包与 `harness/` junction。当前 `C:\Users\daixu\.dsh\profiles\eval` 的 `dsh.profile.bundles` 已是正确结构 `["@deepseek-ai/dsh-base","dsh-eval"]`，故障仅在产物闭包不完整。本任务将 dsh-eval 修复为可在 rc.8 上一次插件安装即可使用的独立产物，保留上游 runner，并补齐启动器/模型/配置/凭据桥使 child 子进程真正到达 rc.8 headless/provider 栈。

上游锚点：`research/dsh-eval-src` @ `47f39d7c1453de16b7ed1a3846980d0765eb1f3a`；宿主锚点：`E:\github\dsh` @ `0.1.0-rc.8` / `141eb6fef8`。

rc.8 调用约定（`E:\github\dsh\apps\cli\src\args.ts` 实测）：仅 `web` 为硬编码别名，通用调用为 `dsh --profile <name> <inner-args...>`；故命令为 `dsh --profile eval run/report/compare/import`，无额外 `eval` token、无 `dsh eval` 别名（上游 README 该项为过期文档，fork 修正）。

## 目标

产出一个与 DSH 源码仓库分发/生命周期解耦、但正确依赖 DSH 公开宿主 ABI 的可安装插件：用户在已安装 DSH rc.8 上执行 `dsh plugin --profile <name> add <artifact>` 即可获得可用的 `dsh --profile eval --help` / `run`，无需本地 DSH checkout/junction/tsc。包名保持 `dsh-eval`、版本 `0.3.1-standalone.0`（drop-in 替换、`dsh.profile.bundles` 协调一致）。

## 解耦定义（本任务口径）

- **解耦 = 分发与生命周期独立 + 依赖稳定宿主 ABI。**
- **消费者/运行时保证：** 安装与运行本产物无需 DSH checkout、junction 或 TypeScript 工具链。
- **维护者构建说明（disposable SDK mirror，不改真实 DSH）：** 维护者本地构建**不把真实 DSH checkout 作为 pnpm workspace junction**（pnpm 可能在 workspace members 下写 node_modules/lib，违反只读边界）。改为 `packages/dsh-eval/scripts/prepare-sdk.mjs --dsh <checkout>`：先校验 checkout HEAD=`141eb6fef8`，再用 `git -C <checkout> archive <sha>`（或等价只读复制）把完整 tracked DSH workspace 展开到**被忽略的** `packages/dsh-eval/.sdk/dsh/`；**先构建 host、后插入 member**（避免 `tsconfig.host.json` glob/tsdown 在 host 构建阶段看到临时 eval package）：先在未插入 member 的原生镜像内 `pnpm install --frozen-lockfile` + `pnpm run build:lib:host`；**之后才**把 shipping `packages/dsh-eval` 复制进镜像 member `packages/eval/dsh-eval`；再跑第二个隔离 `pnpm install --no-frozen-lockfile`（因 pinned lock 无该新 package 的 importer；**lock 变更仅允许在 `.sdk/`**）+ `pnpm --filter dsh-eval run typecheck/build/test`；最后把构建出的 `lib/**`/测试证据**复制回** shipping package，使 `workspace:^` 与 DSH source paths 正常解析。真实 `E:\github\dsh` 只被 git 只读访问；所有 node_modules/lib/lock 变化只发生在 `.sdk/` 镜像。**tarball/prepack 闭包「排除」整个 `.sdk/**`（含其生成的 node_modules/lib/lock）、shipping `node_modules/**`、`dist/**` 自产物/链接、及任何绝对路径/symlink；「包含」`packages/dsh-eval/lib/**` 生成产物（从镜像复制回的 shipping lib 专用于打包）**。消费者仍只装 tgz、完全不需要 SDK。**打包发生在镜内 package 内**：eval typecheck/build/test 后于 `.sdk/dsh/packages/eval/dsh-eval` 内 `npm pack --json`（prepack 可重建），把该 tgz + pack JSON/shasum 复制到 `packages/dsh-eval/dist/`，解包/闭包校验同一 tgz，并把同一 tgz 装进 E2E profile；release-ready 目录由该已验证 tgz 派生（防发散）。
- **允许且应当依赖的公开宿主 ABI（消费者视角）：** `dsh.profile.bundles`/`dsh.bundle.patch`、`cmdlineArgs`/`appExit` 注入、子进程 `--profile`/`--patch`/`DSH_HOME`、plain-JSONL `session.jsonl`（header `{type:'session',id,createdAt}`），以及**消费 rc.8 已有的公开 services**：`loader.await()`、`agentDefaultModel.currentSelection()`、`llm.listProviders()`/`llm.listConfigurableProviders()`、`settings.describe({redactSecrets:true})`、`credentials.resolve(ref)`。不得直接 import DSH 私有源码路径或依赖 `composeEntries`/`applyEntryPatches` 等内部符号。
- **不依赖：** DSH 内部实现私有路径、monorepo 布局、构建时 `workspace:^` 链接、内部类型版本与插件打包时一致；消费者侧不承诺零 DSH SDK 即可从源码编译。

## 范围

### In Scope

- upstream-preserving fork/package（保留 `runner.ts` 调度/分级/report 语义），包名 `dsh-eval`、版本 `0.3.1-standalone.0`，**shipping 实现落在真实 tracked 目录 `packages/dsh-eval/`**（见「实现布局」）。
- **实现布局：** `packages/dsh-eval/` 自带 `package.json`（**不必为 SDK 提供含外部 junction patterns 的 pnpm-workspace.yaml**；维护者脚本驱动镜像构建）；从只读 nested provenance clone `research/dsh-eval-src/packages/eval` **导入** `src/`、`tests/`、`package.json`、`tsconfig*.json`、`README.md`/`README.zh.md`、`LICENSE`、`cordis.patch.yml`；**绝不**在 nested research clone 内做产品修改。`packages/dsh-eval/UPSTREAM.md` 记录 origin/commit/copy mapping/local delta。构建用 **disposable SDK mirror**（见「维护者构建说明」）：`prepare-sdk.mjs --dsh <checkout>` 校验 HEAD、`git archive` 展开 tracked DSH 到被忽略的 `.sdk/dsh/`；**先 host 构建（`pnpm install --frozen-lockfile` + `pnpm run build:lib:host`）后插入 member**（shipping `packages/dsh-eval`→`packages/eval/dsh-eval`），再第二个 `pnpm install --no-frozen-lockfile`（lock 变更仅限 `.sdk/`）+ `pnpm --filter dsh-eval run typecheck/build/test`，只把 `lib/`/证据复制回。**tarball/prepack 闭包「排除」整个 `.sdk/**`（含其生成 node_modules/lib/lock）、shipping `node_modules/**`、`dist/**` 链接及任何绝对路径/symlink；「包含」shipping `packages/dsh-eval/lib/**`（从镜像复制回、专用于打包）**。消费者不需要 SDK。**tgz 权威来源 = 镜内 package**（`npm pack --json` 于 `.sdk/dsh/packages/eval/dsh-eval`，prepack 可重建），复制到 `packages/dsh-eval/dist/` 并由 release 脚本派生 release-ready 目录。
- 修复 `files`/`exports`/`main`/`types`/`prepack` 的完整 `lib/` 闭包 + tarball 闭包校验。
- `cordis.patch.yml` 与 `dsh.bundle.patch` 声明正确。
- 显式产品正确性工作（非可推迟适配）：
  - **启动器解析**：benchmark 省略 `command` 时**经当前 CLI argv 默认值成功**（`[process.execPath, resolved process.argv[1]]`，`shell:false` 保空格，无 PATH 依赖）；优先级 CLI override ＞ YAML `command` 数组 ＞ 当前启动器；**仅当**当前 launcher 无法解析或显式 argv 无效时才 fail early（可读诊断 + 退出码 1），该负例有专门可观测测试，不是「省略 command 的标准结果」；`--dsh` 改为 argv-safe（不再按空白拆分）。
  - **模型选择**：可选 `benchmark.provider`；实际选择 `{provider: benchmark.provider ?? parent.agentDefaultModel.currentSelection().provider, model: benchmark.model}`；写入 child `settings.yaml` 的 `agent-default-model`；`run.json`/report 持久化实际 provider+model；judge provider 缺省=有效 benchmark provider、judge model 缺省=benchmark model。
  - **Provider/settings 桥（限定了 MVP scope）**：仅用公开 service；经 `llm.listProviders()`（当前 live）**且** `llm.listConfigurableProviders()`（有 `settingsNs`/`settingsPath`）**同时**确认所选 route 可自动桥；仅抽该 provider 的已解析子树写 child 最小 `settings.yaml`（不整份复制父文档）；redacted 关键字段 fail-closed。**只在 configurable directory 但未 live 的 route 在启动/选择前给出可读报错**（不静默跳过）。外部 provider 的逃生口 = **显式 wrapper command 自行管理/覆盖 child profile、DSH_HOME 与凭据策略**——不要暗示仅设 `benchmark.profile` 就能在空 child home 自动安装外部 bundle。raw headers 规则收敛为精确规则（见 §3/§4）。
  - **凭据桥**：发现 `apiKeyEnv`（deepseek 缺省 `DEEPSEEK_API_KEY`；pi-ai route 用其 `apiKeyEnv`）；模型与 provider settings snapshot 每 run 固定以保证可复现，credential ref 随之确定，但 credential **value 必须每个 case×trial spawn 前调用父 `ctx.credentials.resolve(ref)`**（不可 per-run 缓存）。**runner 为保持子进程可运行仍继承 parent `process.env`（含 PATH/HOME/TEMP 及既有 ambient env）；「仅注入一个 ref/value」精确限定为：从 managed credentials store 新增到 child env 的值仅所选 provider 的一个 ref/value，不声称 child 只看到这一个凭据**（provider-native ambient discovery 亦因此可用）。凭据真值绝不落 settings/overlay/run.json/session.jsonl/临时文件，绝不日志打印；route 无命名 ref 时依赖继承环境/provider-native；命名 ref 未解析给可读诊断。
- rc.8 验证：temporary profile + temporary `DSH_HOME`，E2E-A（离线确定性，必过）与 E2E-B（本地 mock-provider，必过）、E2E-C（可选付费，单独授权）。
- 产出 `.tgz`（**权威来源 = 镜内 package 的 `npm pack --json`**，复制到 `dist/`）+ GitHub-release-ready 目录（**由该已验证 tgz 派生**）+ README（修正过期 `dsh eval` 为 `dsh --profile eval ...`）。
- 仅在真实 rc.8 兼容性失败被复现时引入窄适配器（`trace.ts`/`metrics.ts`/`judge.ts`/`types.ts`/`invariant.ts`/`command.parseCmdline`），以失败证据为门控；结构守卫基于 rc.8 精确 leaf 字段。

### Out of Scope

- 重写/替换 `runner.ts` 的调度/隔离/超时/分级/report 语义。
- 修改 `E:\github\dsh` 源码、行为、或本机 DSH 安装的 `web` profile。
- 将 npm 公开发布作为 MVP 必要条件（验证以本地 `.tgz`/GitHub release 为准）。
- 将真实外部模型付费调用（E2E-C）作为本任务必过 gate。
- 未复现真实 rc.8 失败前的预防性抽象/大范围重构；臆测 token-delta 等字段名。
- 新增与评测无关的宿主功能。
- **不在 MVP 自动桥范围内：** 外部 provider bundle、`llm.listConfigurableProviders()` 未给出 settingsNs/settingsPath 的路由、或含需透传敏感 raw headers 的 route，均**不自动复制**到 child settings（对已配置 pi-ai 之外的扩展提供方，须用**显式 wrapper command** 自行管理/覆盖 child profile、DSH_HOME 与凭据策略；仅写 `benchmark.profile` 不会在空 child home 自动安装外部 bundle）。

## 验收标准

### 闭包 / 包标识

- [ ] **C-1** 在**镜内 package `.sdk/dsh/packages/eval/dsh-eval`** 内执行 `npm pack --json` 产出的**实际 tgz 为权威**（`npm pack --dry-run` 仅可作可选预览，**绝不单独作为 release gate**；**不在无维护者 SDK 的源码根直接承诺 `npm pack`**——其 `workspace:^` dev deps 未解析）文件列表含 `lib/index.js`、`lib/invariant.js`、`lib/benchmark.js`、`lib/command.js`、`lib/runner.js`、`lib/trace.js`、`lib/judge.js`、`lib/metrics.js`、`lib/report.js`、`lib/compare.js`、`lib/import.js`、`lib/types.js`（及 `lib/types/*.d.ts`）、`cordis.patch.yml`、`package.json`；解包后**每个 `exports`/`main`/`types` target 实际存在**，package 内相对 ESM import 可被 Node 递归解析，tarball 不含 DSH checkout 链接/绝对路径/symlink 且**包含 shipping `lib/**` 生成产物**。
- [ ] **C-2** `package.json:name=dsh-eval`、`version=0.3.1-standalone.0`，与 `0.3.0` 不冲突、可 drop-in。
- [ ] **C-3** **exports 闭包修复：** `./types` runtime target 指向**存在的** `./lib/types.js`（推荐方案；`src/types.ts` 单文件 JS 输出 `lib/types.js`，上游错指到不存在的 `lib/types/types.js`）；`files` 含 `lib/types.js`；**移除 `./src/*` public export** 并记录该内部源码入口不在 drop-in 兼容承诺内。
- [ ] **C-4** **只读 DSH 校验：** 构建前/后对真实 `E:\github\dsh` 执行 `git status --porcelain` 必须**字节级一致且为空**（绝不通过修改 DSH 来完成构建）；node_modules/lib/lock 变化仅发生在被忽略的 `.sdk/` 镜像。

### 安装 / 启动器（Launcher gate）

- [ ] **L-1** 临时空 `DSH_HOME` 上 `dsh plugin --profile eval add <tgz>` 成功，`dsh.profile.bundles` 收敛为 `["@deepseek-ai/dsh-base","dsh-eval"]`，无 bundle 声明警告。
- [ ] **L-2** `dsh --profile eval --help` 展示 eval 子命令；`run`/`report`/`compare`/`import --help` 可达（无额外 `eval` token）。
- [ ] **L-3** 一个**省略 `command` 的 benchmark** 在无 `dsh` on PATH 环境经当前 CLI argv 默认值（`[process.execPath, resolved process.argv[1]]`）**成功**启动并完成评测（无 PATH 依赖）；`shell:false`。
- [ ] **L-4** 缺省 launcher 解析为当前 CLI argv `[process.execPath, resolved process.argv[1]]`，`shell:false`；Windows 含空格路径（如 `C:\Program Files\...`）经由 YAML `command` 数组或 argv-safe override 可达并被测试覆盖。**选定 `--dsh <argv...>` Commander variadic 语义**（逐 token 保留 shell quoting，不再按空白拆分）；benchmark YAML `command` 数组仍为首选显式覆盖，文档说明复杂/带前导 `--` 的 launcher 参数优先用 YAML。`./src/*` 不再是公共导出入口。
- [ ] **L-5** 可观测负例：**仅当**当前 launcher 无法解析（如 `process.argv[1]` 缺失/不可读）或显式 argv 无效时才 fail early，给出明确可读诊断 + 退出码 1；该负例有专门测试，不被当作「省略 command 的标准结果」。

### 模型 / 配置（Model & config gate）

- [ ] **M-1** 可选 `benchmark.provider` 生效；实际选择 = `{provider: benchmark.provider ?? parent.agentDefaultModel.currentSelection().provider, model: benchmark.model}`，写入 child `settings.yaml` 的 `agent-default-model`；headless 子进程读取同一选择（`currentSelection()`）。
- [ ] **M-2** **新 run 必须写 `provider`**（不缺失）；为**旧 `run.json` 与 import 保持兼容**——类型/渲染允许 `provider` 缺失并显示 legacy/imported unknown，不能使 report/compare 处理旧文件失效。
- [ ] **M-3** `judge.provider` 缺省解析为有效 benchmark provider（非硬编码 `deepseek`）；`judge.model` 缺省为 benchmark model。
- [ ] **M-4** child `settings.yaml` 只含 `agent-default-model` + 该所选 provider 的单一 `settingsNs`/`settingsPath` 子树，**不整份复制父 settings**；经 `llm.listConfigurableProviders()` 定位 ns/path。

- [ ] **M-5** eval 异步执行在读取 `agentDefaultModel`/`llm`/`settings`/`credentials`/`judgeChat` **之前先 `await ctx.get('loader')?.await()`**（loader settlement）；settlement 后缺失服务则可读 fail-fast（对齐 `headless/src/index.ts:96-106` 与 `app-boot/src/index.ts:782` 模式）。

### 凭据 / 安全（Credential & security gate）

- [ ] **S-1** 模型与 provider settings snapshot 每 run 固定（可复现）；credential ref 随该 snapshot 确定；credential **value 在每个 case×trial spawn 前调用父 `ctx.credentials.resolve(ref)`**（不 per-run 缓存）。**runner 继承 parent `process.env`（PATH/HOME/TEMP 及既有 ambient env）以保持子进程可运行**；从 managed credentials store **新增**到 child env 的值仅所选 provider 的**一个 ref/value**（不声称 child 只看到这一个凭据；provider-native ambient discovery 因此可用）。
- [ ] **S-2** **产品/插件「不持久化」，而非「整个 testRoot 无该 fixture」：** 凭据真值绝不写入 `settings.yaml`、overlay、`run.json`、`session.jsonl`、trial workspaces 或日志；`.credentials.yaml` 不随空 child home 传播（**child 位置不得出现 `.credentials.yaml` 副本**），真实评测凭据经 env 桥注入（已知限制 + 本文档化的受支持路径）。父 `<test-root>/parent-home/.credentials.yaml` 是**唯一故意保留的 fixture 来源**。
- [ ] **S-3** redacted 关键配置字段（`settings.describe({redactSecrets:true})` 掩蔽）需要时 **fail-closed** 而非物化真值。**精确 raw-headers 规则：** 所选 provider subtree 含**非空 `headers`** 时自动桥 **fail-closed**，并以可读提示引导使用显式自管 child profile/command（不再保留「allowlist 或 fail-closed」的未决措辞）。
- [ ] **S-4** route 未命名 credential ref（pi-ai ambient）时不注入、依赖继承环境/provider-native discovery；命名 ref 未解析给出可读诊断（含 ref 名、不含值）。
- [ ] **S-5** **provider scope：** MVP 自动桥要求 route **同时**出现在 `llm.listProviders()`（当前 live）与 `llm.listConfigurableProviders()`（有 settingsNs/settingsPath）——即 DeepSeek + 已配置 pi-ai；**只在 configurable directory 但未 live 的 route 在启动/选择前给出可读报错**。外部 provider bundle/非目录 route **不自动复制**并清晰报错，逃生口为**显式 wrapper command** 自行管理/覆盖 child profile、DSH_HOME 与凭据策略（不暗示仅设 `benchmark.profile` 即自动安装外部 bundle）。
- [ ] **S-6** **fixture 扫描（带精确 allowlist）：** 父 `<test-root>/parent-home/.credentials.yaml` 是**唯一故意/allowlisted 的 fixture 来源**（证明 managed-store 桥），断言它**包含**该 fixture 且未被复制（**任何 child 位置不得出现 `.credentials.yaml` 副本**）。断言该 secret 在**所有插件生成/输出位置**（`run.json`、session JSONL、child `settings.yaml`、overlay、child homes/profiles、trial workspaces、stdout/stderr/log captures、release/tgz）**均不出现**。此为**产品/插件「不持久化」证据**；child 仍继承 parent `process.env`，故只证明 non-persistence、**不证明环境无其他 secret**。

### 验证门（Verification gates）

- [ ] **G-A（E2E-A，离线确定性，必过）** 临时 profile + 一次性 `DSH_HOME`，`dsh --profile eval run <benchmark.yaml> --out <tmp>/run.json` 走 `fake-dsh.mjs` 或 `llm-replay`，产出 `run.json`（`aggregate`/`grading` 非空）且 `report`/`compare`/`import` 可达；**不得把 E2E-A 绿灯声明为真实评测可用**。
- [ ] **G-B（E2E-B，本地 mock-provider，必过）** disposable test root 下，父 home 写 `.credentials.yaml` + settings →（`agentDefaultModel`/`llm`/`settings`/`credentials` 桥）→ 最小 child `settings.yaml` + child env → **真实 rc.8 headless/provider 栈**，经本地 mock server 断言 `Authorization` 头与所选 model 到达 mock、且**无外部计费**；**断言输出 `run.json` 的 provider+model 与该 mock 请求一致**；**E2E-B 同时覆盖省略 `command`（经当前 CLI argv 默认值成功）的用例**；**凭据来源隔离（必选）**：因 credentials-local 优先级 = 继承 env ＞ 父 `.credentials.yaml` ＞ 项目/用户 `.env`，为把 mock 收到的 fixture `Authorization` **唯一归因于父 `.credentials.yaml`**，run 进程须用 testRoot 下的 **disposable cwd** 与 **disposable OS-home**（`HOME`/`USERPROFILE`）且**无 `.env`**，并在 spawn 前**按大小写不敏感移除所选 ref**（如 `DEEPSEEK_API_KEY`）；不全局改写/记录真实环境；此隔离仅作用于 E2E-B run 进程，**产品 runner 仍继承 parent `process.env`**。
- [ ] **G-C（E2E-C，可选）** 付费外部真实模型 smoke，单独授权/计费，不作为必过 gate。
- [ ] **G-D** 隔离精确化：父 `DSH_HOME` 与 runner trial tempRoot 为**两个不同根**，都在 disposable test root 下；通过 runner option 或启动环境 `TEMP`/`TMP`/`TMPDIR` 把 `tmpdir()` 约束到 `<test-root>/trials`。断言父 `<parent-home>/profiles/eval` 与每个 trial `<...>/dsh-home/profiles/headless` 均在 test root 内；**整个 test root 扫描仅配以精确路径 allowlist（父 `.credentials.yaml` 源），任何第二次出现即失败**；随后清理整个 test root，未触碰真实 home。
- [ ] **G-E** 不回归已正确结构：`C:\Users\daixu\.dsh\profiles\eval` 的 `dsh.profile.bundles` 语义不受本任务文档影响；真实迁移以备份/回滚为前提、仅在临时绿灯后、单独批准。

### 适配器门控

- [ ] **A-1** 若引入任一 DSH 窄适配器，PRD/Design 记录触发它的真实 rc.8 失败（日志、版本、复现步骤），否则不引入；launcher/模型/provider/凭据桥为显式产品工作，**不属于**此门控。
- [ ] **A-2** 若 E2E-B 零适配绿灯，以「零适配绿灯」结案记录，不引入预防性代码。

### 人审门控

- [ ] **H-1** `design.md:status` 保持 `draft` 直至用户显式批准本版（含 launcher/模型/provider/凭据桥变更）。
- [ ] **H-2** 批准后由独立 design-review 子代理基于本版产出 `passed` 的 `design-review.md`，之后方可 `task.py start`（`task.json:status` 方能 `planning`→`in_progress`）。

## 约束与风险

- **只读 DSH：** 任务期间不修改 `E:\github\dsh`；验证经临时 `DSH_HOME`/临时 profile 隔离；实现前维护者构建可只读引用该 checkout 作 SDK，产物闭包不得含其文件/路径。
- **凭据限制声明：** 真实评测依赖经 env 桥注入的 `apiKeyEnv` 值（父 `ctx.credentials.resolve(ref)` 解析）；DSH_HOME 内 `.credentials.yaml` 不随空 child home 传播，列为已知限制 + 安全兜底（插件不主动落凭据、凭据扫描保留）。
- **阶段规则：** `status` 保持 `planning`、`design.md:status=draft`、`work.stage=design-review` 直至用户批准与 design-review 通过。
- **上游保留：** 保留 `runner.ts` 及 benchmark/report/compare/import 语义；fork 可追溯 `47f39d7…`。
- **确定性验证：** `expected.check` 不绕过模型调用；E2E-A 离线 smoke 走 `fake-dsh.mjs`/`llm-replay`，不依赖真实模型。
- **风险：** 上游再发带缺陷 tarball 不影响本产物闭包校验；DSH 事件形态演进经窄适配隔离而非重写 runner。
- **回滚：** 任何对真实 `eval` profile 的变更前备份 `package.json`/`dsh.profile.bundles`/`pnpm-lock.yaml`，提供 `dsh plugin --profile eval remove` + 还原备份的回滚路径。

## 相关证据/文档

- `research/compatibility-and-packaging.md`（本任务权威证据，含 launcher/模型/provider/凭据桥契约位点）
- `E:\github\dsh\apps\cli\src\args.ts`（仅 `web` 硬编码别名）
- `E:\github\dsh\packages\boot\app-boot\src\profile.ts`（`DEFAULT_PROFILE_BUNDLES`/`healProfilesModuleFallback`/`resolveBundleDir`）
- `E:\github\dsh\apps\cli\src\plugin.ts` / `profile-boot.ts`（profile add + reconcile 时机）
- `E:\github\dsh\packages\core\agent-default-model\src\index.ts`（`AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE='agent-default-model'`、`currentSelection()`）
- `E:\github\dsh\packages\llm\llm\src\index.ts` / `types.ts`（`listProviders`/`listConfigurableProviders`/`settingsNs`/`settingsPath`）
- `E:\github\dsh\packages\llm\llm-deepseek\src\index.ts`（`apiKeyEnv` 缺省 `DEEPSEEK_API_KEY`；`settingsNs='llm-deepseek'`）、`packages\llm\llm-pi-ai`（route `apiKeyEnv`；`llm-pi-ai`/`['providers',<route>]`）
- `E:\github\dsh\packages\settings\settings\src\index.ts`（`describe({redactSecrets:true})`）、`credentials\credentials-local\src\index.ts`（`credentials.resolve(ref)` 层级）
- 上游源：`research/dsh-eval-src/packages/eval/src/runner.ts`、`benchmark.ts`、`command.ts`、`package.json:files`、`tests/fixtures/fake-dsh.mjs`
