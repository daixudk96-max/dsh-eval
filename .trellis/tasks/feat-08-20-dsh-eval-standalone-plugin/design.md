# Design — dsh-eval 独立可安装插件

status: approved   # draft | approved（用户 2026-08-20 明确批准修订后的方案；现转入独立 design review 门禁）
execution_lane: standard   # quick | standard

## 目标与非目标

**目标：** 以 `47f39d7c…`（hccccc01333/dsh-eval）为基线，产出一个在 rc.8 上一次 `dsh plugin --profile <name> add <artifact>` 即可使用的独立插件产物；修复 `files` 闭包导致 `lib/*.js` 缺失的确定性失败，保留 `runner.ts` 的 case×trial 调度/隔离/超时/分级/report 语义不变。将「启动器解析、模型选择语义、provider/settings 桥、凭据桥」确立为**显式产品正确性工作**（不再是可推迟的失败门控适配），使 child 子进程能真正到达 rc.8 本地 headless/provider 栈。包名 `dsh-eval`、版本 `0.3.1-standalone.0`，tarball/profile drop-in 替换。

**非目标：** 重写 runner 的调度/隔离/超时/分级语义；改动 `E:\github\dsh`；把 npm 公开发布作为 MVP 必要条件；把真实外部模型付费调用作为本任务必过 gate（E2E-C 为可选、单独授权）；预防性地抽象全部 DSH 内部包。

## 方案

### 边界

- **Fork/package 形态：** `research/dsh-eval-src`（pinned `47f39d7…`）→ **shipping 实现落在真实 tracked 目录 `packages/dsh-eval/`**。从只读 nested provenance clone `research/dsh-eval-src/packages/eval` **导入** `src/`、`tests/`、`package.json`、`tsconfig*.json`、`README.md`/`README.zh.md`、`LICENSE`、`cordis.patch.yml`；**绝不在 nested research clone 内做产品修改**。`packages/dsh-eval/UPSTREAM.md` 记录 origin/commit/copy mapping/local delta。该目录自带 `package.json`（**无须为 SDK 提供含外部 junction patterns 的 pnpm-workspace.yaml**；维护者脚本驱动镜像构建）。构建用 **disposable SDK mirror（不改真实 DSH）**：`packages/dsh-eval/scripts/prepare-sdk.mjs --dsh <checkout>` 先校验 HEAD=`141eb6fef8`，用 `git -C <checkout> archive <sha>`（或等价只读复制）把完整 tracked DSH workspace 展开到被忽略的 `packages/dsh-eval/.sdk/dsh/`；**先 host 构建、后插入 member**（避免 `tsconfig.host.json` glob/tsdown 在 host 构建阶段看到临时 eval package）：在未插入 member 的原生镜像内 `pnpm install --frozen-lockfile` + `pnpm run build:lib:host`，之后才把 shipping `packages/dsh-eval` 复制到镜像 member `packages/eval/dsh-eval`，再跑第二个隔离 `pnpm install --no-frozen-lockfile`（pinned lock 无该新 package importer；**lock 变更仅允许在 `.sdk/`**）+ `pnpm --filter dsh-eval run typecheck/build/test`；只把 `lib/**`/测试证据复制回 shipping package。真实 `E:\github\dsh` 仅被 git 只读访问（构建前后 `git status --porcelain` 一致/为空）；node_modules/lib/lock 变化只在 `.sdk/`。**tarball/prepack 闭包「排除」整个 `.sdk/**`（含其生成 node_modules/lib/lock）、shipping `node_modules/**`、`dist/**` 链接及任何绝对路径/symlink；「包含」shipping `packages/dsh-eval/lib/**` 生成产物（从镜像复制回专用于打包）**。消费者无需 SDK。作为独立可打包 npm 包 `dsh-eval` @ `0.3.1-standalone.0`。
- **宿主侧（消费者视角的稳定契约）：** profile 清单与 bundle patch（`dsh.profile.bundles` / `dsh.bundle.patch`）、`dsh plugin --profile <name> add` 的 reconcile、一次性 `DSH_HOME` 隔离、`cmdlineArgs` / `appExit` 注入、子进程 `--profile` / `--patch` / `DSH_HOME`、plain-JSONL `session.jsonl`（header `{type:'session',id,createdAt}`）。**消费 rc.8 已有的公开 services**：`loader.await()`、`agentDefaultModel.currentSelection()`、`llm.listProviders()` / `llm.listConfigurableProviders()`、`settings.describe({redactSecrets:true})`、`credentials.resolve(ref)`。`composeEntries` / `applyEntryPatches` 等 rc.8 内部实现仅作研究证据，不作为插件运行时依赖。
- **产物体侧：** `lib/` 完整闭包 + `cordis.patch.yml` + `dsh.bundle` 声明 + `exports`/`main`/`types` + `prepack` 校验；`index.ts:apply` 装配 launcher/模型/配置/凭据桥与评测命令；`dsh --profile eval --help` 直接展示 eval 子命令（`run`/`report`/`compare`/`import`）。
- **验证侧：** 临时 `DSH_HOME` / 临时 profile 隔离；E2E-A（离线确定性，必过）、E2E-B（本地 mock-provider，必过）、E2E-C（可选付费外部模型，单独授权）。断言路径位于 `<temp-DSH_HOME>\profiles\...`，不触碰真实 `C:\Users\daixu\.dsh\profiles\eval`。

### 数据流

```text
dsh --profile eval run benchmark.yaml --out run.json
dsh --profile eval --help / report / compare / import
  │
  ├─ (DSH launcher, args.ts) 仅 web 为硬编码别名；通用 dsh --profile <name> <inner-args...>
  │     prepareProfile → healProfilesModuleFallback → loadProfile(name, INSTALL_ANCHOR)
  │     bundles=[dsh-base, dsh-eval] → patches → boot
  │
  ├─ (dsh-eval bundle) index.ts:apply(ctx)
  │     await ctx.get('loader')?.await()            // loader settlement：先于读取服务，见 §0/§2
  │     ctx.cmdlineArgs ──parseCmdline──▶ EvalStartupValues {kind:'run'|'report'|'compare'|'import', ...}
  │     resolveLauncher(values, ctx) ──▶ argv[0..n]   // 见「显式工作 §1」
  │     resolveModelSelection(benchmark, ctx) ──▶ {provider, model}   // §2，每 run 固定 snapshot
  │     buildChildSettings(selection, ctx) ──▶ 最小 settings.yaml   // §3
  │     per-trial: credentialValue = await ctx.credentials.resolve(ref)   // §4，每 case×trial spawn 前，不 per-run 缓存
  │     executeEval(values, internals, {launcher, selection, childSettings, ref})
  │        │
  │        ├─ loadBenchmark(yaml) ──▶ Benchmark {cases, command?, profile, trials, timeoutMs, pricing, judge?, replay?, provider?}
  │        ├─ runBenchmark(benchmark, {launcher, selection, childSettings, credential, judgeChat?})
  │        │     for each case × trial:
  │        │       mkdir tempRoot/case-trial/{workspace,dsh-home}
  │        │       cp(case.workspace → workspace)
  │        │       write eval.cordis.yml (session-persistence-jsonl plain, sandbox-policy, approval:never)
  │        │       write dsh-home/settings.yaml (agent-default-model + 该 provider 的 ns/path 子树)
  │        │       env = {...process.env, DSH_HOME: dshHome, [ref]: value?}
  │        │             // runner 继承 parent process.env（PATH/HOME/TEMP 及既有 ambient env）以保持子进程可运行；
  │        │             // 从 managed credentials store「新增」到 child env 的值仅所选 provider 的一个 ref/value（不声称 child 只看到这一个凭据）
  │        │       spawn(launcher, [...argv-tail, '--profile', profile, '--patch', overlay, prompt],
  │        │             {cwd: workspace, env, shell:false, timeoutMs})
  │        │       findSessionLogs(dshHome) → loadTrace/mergeTraces → computeMetrics(events, pricing)
  │        │       gradeTrial(...)  // expected.check 为事后校验，不绕过模型
  │        │       tryJudgeTrial(...)  // judge provider 缺省=有效 benchmark provider
  │        │     aggregateMetrics(completed) + gradingOf(results) → EvalRun {provider, model, ...}
  │        ├─ writeRunReport(run, outPath) + internals.stdout summary
  │        └─ ctx.appExit(code)  (0 on aggregate non-null, else 1)
  │
  └─ run.json ──▶ report/compare/import（含持久化的实际 provider+model）
```

### 显式产品正确性工作（非失败门控适配）

#### §0 Loader settlement（加载基调平）

- eval 的异步执行在读取 `agentDefaultModel` / `llm` / `settings` / `credentials` / `judgeChat` 之前，**必须先 `await ctx.get('loader')?.await()`**，确保插件树完整挂载后再取服务，避免半组合的 tools/adapters。
- settlement 后若所需服务缺失（`ctx.get(...)` 为 `undefined`），则以**可读 fail-fast** 报错，而非静默部分执行。
- 依据：`E:\github\dsh\packages\bundle\headless\src\index.ts:96-106`（`await ctx.get('loader')?.await()` 后检查 agents/agentDefaultModel/sessions 缺失即 return）与 `E:\github\dsh\packages\boot\app-boot\src\index.ts:782`（boot 亦 `await ctx.get('loader')?.await()`）。

#### §1 启动器解析（Launcher resolution）

- benchmark 省略 `command` 时**经当前 CLI argv 默认值成功**：argv `[process.execPath, resolved process.argv[1]]`，`shell:false` 保留含空格路径，无 PATH 依赖。
- **优先级：** ① CLI 显式覆盖（argv 数组形式）＞ ② benchmark YAML `command` 数组 ＞ ③ 当前启动器。
- **失败仅发生于此：** 当前 launcher 无法解析（如 `process.argv[1]` 缺失/不可读）或显式 argv 无效时，才 fail early（可读诊断 + 退出码 1，提示 YAML `command` 数组写绝对 launcher 或把 DSH bin 加入 PATH）；不静默变成全 error。该负例有专门可观测测试。
- 替换上游 `command.ts:57 splitCommand` 按空白拆分 `--dsh` 的语义，**选定 `--dsh <argv...>` Commander variadic**——逐 token 保留 shell quoting，不再按空白拆分；benchmark YAML `command` 数组仍为首选显式覆盖，文档说明复杂/带前导 `--` 的 launcher 参数优先用 YAML（其本身不参与 `--dsh` 拆分）。
- 测试覆盖 Windows 含空格路径（如 `C:\Program Files\...`）。

#### §2 模型选择语义（Actual model semantics）

- 新增可选 `benchmark.provider`。实际选择 = `{ provider: benchmark.provider ?? parent agentDefaultModel.currentSelection().provider, model: benchmark.model }`（`benchmark.model` 不再仅用于 pricing/report）。**该模型 + provider settings snapshot 每 run 固定**以保证可复现。
- 读取 `agentDefaultModel.currentSelection()` 前先经 §0 loader settlement。
- 每次 `run` 将该选择写入 child 最小 `settings.yaml` 的 `agent-default-model` 段（`AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE='agent-default-model'`；headless 子进程读取 `ctx.agentDefaultModel.currentSelection()`，见 `E:\github\dsh\packages\core\agent-default-model\src\index.ts:21` 与 `packages\bundle\headless\src\index.ts:101-106`）。
- **新 run 必须写 `provider`。** 为**旧 `run.json` 与 import 保持兼容**：类型/渲染允许 `provider` 缺失并显示 legacy/imported unknown，report/compare 对旧文件不失效。`run.json`/report 持久化并报告实际 provider+model。
- Judge：`judge.provider` 缺省解析为有效 benchmark provider（不再硬编码 `deepseek`）；`judge.model` 缺省为 benchmark model。

#### §3 Provider/settings 桥（Provider & settings bridge）

- 仅消费 rc.8 公开 service：`agentDefaultModel.currentSelection()`、`llm.listProviders()`、`llm.listConfigurableProviders()`、`settings.describe({redactSecrets:true})`、`credentials.resolve(ref)`。
- **MVP provider scope（精确）：** 自动桥要求 route **同时**出现在 `llm.listProviders()`（**当前 live**）与 `llm.listConfigurableProviders()`（有 `settingsNs`/`settingsPath`）——即 **DeepSeek**（`llm-deepseek`/`[]`）与**已配置 pi-ai route**（`llm-pi-ai`/`['providers',<route>]`）。**只在 configurable directory 但未 live 的 route 在启动/选择前给出可读报错**。**外部 provider bundle、或非目录 route（无 settingsNs/settingsPath）不自动复制**，给出清晰报错；逃生口为**显式 wrapper command** 自行管理/覆盖 child profile、DSH_HOME 与凭据策略（**不暗示仅写 `benchmark.profile` 就能在空 child home 自动安装外部 bundle**）。
- 仅抽取该所选 provider 的已解析 settings 子树，写入 child 最小 `settings.yaml`（`agent-default-model` + 该单一 provider 的 ns/path）。**不整份复制父 settings 文档。**
- redacted 关键字段（`settings.describe({redactSecrets:true})` 掩蔽的 secret 位点）需要时**失败**而非物化真值（secret 走 §4 凭据桥注入 env，绝不落 settings）。
- **raw headers 精确规则：** 所选 provider subtree 含**非空 `headers`** 时，自动桥 **fail-closed**，以可读提示引导使用显式自管 child profile/command；不再保留「allowlist 或 fail-closed」未决措辞。

#### §4 凭据桥（Credential bridge）

- 从所选 provider 的已解析配置发现 `apiKeyEnv`：deepseek-official 缺省 `DEEPSEEK_API_KEY`；pi-ai route 用其配置 `apiKeyEnv`。
- **模型/provider settings snapshot 每 run 固定** ⇒ credential **ref** 随该 snapshot 确定（可复现）；但 credential **value 必须在每个 case×trial spawn 之前调用父 `ctx.credentials.resolve(ref)`** 解析——**不 per-run 缓存**。
- **每个 trial 仅从 managed credentials store 新增该 ref/value 到 child env**；但 **runner 为保持子进程可运行仍继承 parent `process.env`（PATH/HOME/TEMP 及既有 ambient env）——不声称 child 只看到这一个凭据**，provider-native ambient discovery 也因此可用。把凭据真值注入 child env 时不写盘：**绝不**写入 `settings.yaml`、overlay、`run.json`、`session.jsonl` 或任何临时文件；绝不日志打印值。
- route 未命名 credential ref（如 pi-ai ambient）时，不注入，依赖继承环境/provider-native discovery。
- 命名 ref 未解析时给出可读诊断（含 ref 名，不含值）。

### 契约变更

- **打包闭包（延续 + exports 修复）：** `files` 修复为完整 `lib/**/*.js` + `lib/types/**/*.d.ts` + `lib/types.js` + `cordis.patch.yml`；`exports`/`main`/`types` 一致且**每个 target 在解包 tgz 内实际存在**。**`./types` runtime target 改为 `./lib/types.js`**（上游错指不存在的 `lib/types/types.js`）；**移除 `./src/*` public export**（内部源码入口不在 drop-in 兼容承诺内，仅保留 `./package.json` 等合法 target）。`prepack` 保持 `tsc -p tsconfig.build.json`；`name=dsh-eval`、`version=0.3.1-standalone.0`；`dsh.bundle.patch=./cordis.patch.yml`；README 修正过期 `dsh eval run` 为 `dsh --profile eval run`。
- **Schema 扩展（本产物新增）：** benchmark 顶层新增可选 `provider: string`；`command` 数组为推荐的显式 launcher 覆盖；`judge.provider` 缺省=有效 benchmark provider、`judge.model` 缺省=benchmark model。移除/替换上游 `--dsh` 空白拆分语义为 argv-safe。
- **宿主侧契约（不变更）：** `dsh.profile.bundles` / `dsh.bundle.patch` / reconcile / `DSH_HOME` / `cmdlineArgs` / `appExit` / 可选 `llm` / 子进程 `--profile`/`--patch`/`DSH_HOME` / plain-JSONL 沿用 rc.8；`agentDefaultModel` / `llm` / `settings` / `credentials` 为公开 service 的只读消费。新增子进程以 `--patch` overlay 写入 child 最小 `settings.yaml`（`agent-default-model` + 单 provider 子树），不改 child cordis 组合。

### 取舍

- **默认启动器 = 当前 CLI argv（而非 PATH `dsh`）：** PATH-less 安装与 Windows 含空格路径下唯一稳健方案；避免 HIGH-1 的 spawn ENOENT。代价：显式用例需在 YAML 写 `command` 或用 CLI override，文档明示。
- **模型/explicit 桥 vs 仅 report 元数据：** 修正为真实选择语义，child headless 才真正选中 provider+model；避免「离线绿灯但真实评测选错模型」。
- **最小 child settings vs 整份父 settings 复制：** 只复制所选 provider 子树，降低敏感信息面与漂移；redacted secret 走 env 不落盘。
- **fail-closed 敏感字段：** 需要但被 redact/未知 raw header 时失败而非物化，保证凭据不泄露，以可读诊断换取安全。
- **保留上游 runner vs 重写：** 保留。
- **窄适配 vs 预先解耦：** 启动器/模型/provider/凭据桥为显式产品工作；`trace`/`metrics`/`judge`/`types`/`invariant`/`command.parseCmdline` 仍失败门控（见下表）。
- **`.tgz`/GitHub release vs npm publish：** MVP 取前者。

### DSH 服务边界与适配策略

稳定边界（直接使用，无需适配）：`dsh.profile.bundles`/`dsh.bundle.patch`、`dsh plugin add` reconcile、一次性 `DSH_HOME`、子进程/落盘契约、`cmdlineArgs`/`appExit`、以及消费的 rc.8 已有公开 service（`loader`/`agentDefaultModel`/`llm`/`settings`/`credentials`）。

失败门控的适配候选（仅在 rc.8 上复现的真实失败触发，记录失败日志/版本/复现步骤；结构守卫仅基于 rc.8 精确 leaf 字段）：

| 候选 | 上游位点 | 触发条件 | 适配形态 |
|------|----------|----------|----------|
| `command.ts` | `parseCmdline` from `@deepseek-ai/dsh-cmdline` | 在 rc.8 `ctx.cmdlineArgs` 上抛或解析漂移 | 薄 shim：优先复用 rc.8 cmdline 契约，失败回退最小 commander 直解，保持 `EvalStartupValues` |
| `trace.ts` | `decodeStorageRecord` / `SessionId` | plain-JSONL 在 rc.8 上 decode 失败 | 本地 JSON-line decoder（逐行 parse + header 校验），与 rc.8 契约对齐时才回退 |
| `metrics.ts` | `isTokenDelta` | token-delta 判别在 rc.8 事件形态失效 | 复现后、基于 rc.8 精确字段引入最小 leaf 守卫，不臆测字段名 |
| `judge.ts` | `BlockAssembler` / `createMessage` / `LlmRuntime` | `llm.stream` 不可用/漂移 | 保留 `JudgeChat` 抽象；无 `llm` 时 degrade（无 judge 不影响非 judge 评测） |
| `types.ts` | `SessionEvent` / `SessionId` type | 仅类型导入 | 必要时本地结构最小形态 |
| `invariant.ts` | `InvariantInstaller` | 空 invariant | 若宿主无 `dsh-invariants`，移除或条件注册 |

launcher/model/config/credential 桥**不属于**上表：它们是本任务必须交付的产品正确性工作，不会被当作「零适配绿灯」推迟。若 rc.8 临时 profile E2E-B 在零适配下绿灯，则上表适配器保持未实现并记录证据。

### 安全

- **凭据最小化：** 经 §4 只把已解析的单个 ref/value 注入 child env；凭据真值绝不进入 `settings.yaml`、overlay、`run.json`、`session.jsonl`、`tempRoot` 或日志。redacted/未知敏感字段 fail-closed（§3）。
- **凭据扫描（带精确 allowlist）：** 父 `<test-root>/parent-home/.credentials.yaml` 是**唯一故意保留的 fixture 来源**（证明 managed-store 桥），断言其**包含**该 fixture 且**任何 child 位置无 `.credentials.yaml` 副本**；断言该 secret 在**所有插件生成/输出位置**（`run.json`、session JSONL、child `settings.yaml`、overlay、child homes/profiles、trial workspaces、stdout/stderr/log captures、release/tgz）**均不出现**——这是**产品/插件「不持久化」证据**。**该扫描只证明「不持久化」，不证明 child 环境中无其他 secret——child 仍继承 parent `process.env`（PATH/HOME/TEMP 及既有 ambient env）**。
- **临时产物：** `runBenchmark` 的 `tempRoot` 为 `mkdtemp(join(tempRoot,'dsh-eval-'))`；验证脚本负责清理与扫描，回滚不残留凭据文件。
- **供应链：** `files` 仅含 `lib/**`/`lib/types/**`/`cordis.patch.yml`/必要 `package.json`/`README`，不打包 DSH checkout 文件/绝对路径/链接。

### 风险与回滚

- **rc.8 宿主 API 演进：** 窄适配隔离 `trace`/`metrics`/`judge` 事件边界，golden trace 锁定回归；launcher/模型/provider/凭据桥对公开 service 的只读消费经 E2E-B 锁定。
- **凭据桥误解析：** E2E-B 用本地 mock-provider 断言 Authorization/model 到达 mock；**fixture secret 的唯一持久位置是父 `<test-root>/parent-home/.credentials.yaml`（allowlisted，证明 managed-store 桥）**——插件生成/输出位置均不出现；该 fixture 同时经 parent `process.env` 继承面存在（ambient env），扫盘只证明插件不持久化。
- **产物闭包回归：** 镜内 package 的 `prepack` + `npm pack --json`（prepack 可重建）为必经门；**不在源码根承诺直接 `npm pack`**（其 `workspace:^` dev deps 未解析）。
- **真实 eval profile 迁移：** 备份 + `remove + add` + 回滚演练，仅临时绿灯后、单独授权。
- **DSH 升级风险：** rc.8 之后小版本经「临时 profile + 一次性 DSH_HOME」的 E2E-A 快速验证。

## 验证计划

1. **Tarball 闭包（权威在镜内）：** 在**镜内 package `.sdk/dsh/packages/eval/dsh-eval`（deps + DSH host libs 就绪）** 内 `pnpm run build` → `npm pack --json` 产实际 tgz（prepack 可重建）→ 复制该 tgz + pack JSON/shasum 到 `packages/dsh-eval/dist/` → 解包后**递归校验 package 内相对 ESM import 可解析**且**每个 `exports`/`main`/`types` target 存在**（含 `./types`→`./lib/types.js`，确认移除 `./src/*`）；无 DSH 文件/绝对路径/链接；release-ready 目录由该已验证 tgz 派生。**运行 import/boot 验证在用「同一个 tgz」安装进临时 DSH profile 后进行**（不要求裸解包目录在无 peers 时完整执行 `lib/index.js`；**不在无维护者 SDK 的源码根直接承诺 `npm pack`**）。
2. **E2E-A（离线确定性，必过）：** disposable test root 下，`dsh plugin --profile eval add <tgz>` → `dsh --profile eval --help` 展示子命令；`dsh --profile eval run <benchmark.yaml> --out <test-root>/run.json` 走 `fake-dsh.mjs` 或 `llm-replay`，产出 `run.json`（`aggregate`/`grading` 非空）且 `report`/`compare`/`import` 可达。**E2E-A 不构成真实评测可用的证据。**
3. **E2E-B（本地 mock-provider，必过）：** 隔离精确化——父 `DSH_HOME`（`<test-root>/parent-home`）与 runner trial tempRoot（`<test-root>/trials`）为**两个不同根**，都在 disposable test root 下；经 runner option 或启动环境 `TEMP`/`TMP`/`TMPDIR` 把 `tmpdir()` 约束到 `<test-root>/trials`。父 home 写 `.credentials.yaml` + settings；由父 `agentDefaultModel`/`llm`/`settings`/`credentials` 桥 → 最小 child `settings.yaml` + child env → **真实 rc.8 headless/provider 栈**，经本地 mock server 断言 `Authorization` 头与所选 model 到达 mock、且**无外部计费**；**覆盖省略 `command`（当前 CLI argv 默认值成功）用例**。**凭据来源隔离（必选）：** 因 credentials-local 优先级 = 继承 env ＞ 父 `.credentials.yaml` ＞ 项目/用户 `.env`，为把 mock 收到的 fixture `Authorization` **唯一归因于父 `.credentials.yaml`**（而非真实环境或项目/用户 `.env`），run 进程须使用 testRoot 下的 **disposable cwd** 与 **disposable OS-home**（`HOME`/`USERPROFILE`，视平台）且**无 `.env`**，并在 spawn 前**按大小写不敏感移除所选 ref**（如 `DEEPSEEK_API_KEY`）；不全局改写或记录真实环境。此隔离仅作用于 E2E-B 的 run 进程；**产品 runner 仍按契约继承 parent `process.env`**（见文档「仅新增所选 managed ref/value」措辞）。断言父 `<parent-home>/profiles/eval` 与每个 trial `<...>/dsh-home/profiles/headless` 均在 test root 内；**整个 test root 扫描仅配精确路径 allowlist（父 `.credentials.yaml` 源），任何第二次出现即失败**（同时断言无 child `.credentials.yaml` 副本）；随后清理并删除整个 test root。
4. **E2E-C（可选，单独授权）：** 付费外部真实模型 smoke，需独立授权/计费，不作为本任务必过项。
5. **真实迁移（仅临时绿灯 + 单独授权后）：** 备份 → `add` → 最小 E2E → 失败回滚。
6. **Quality gate：** 全程不改 `E:\github\dsh`；`trellis-check` 收敛证据（见 `implement.md`）。

## 人审检查点

- [x] 本设计 `status: approved`（用户 2026-08-20 批准），含解析 HIGH-1/HIGH-2 的 launcher/模型/provider/凭据桥设计
- [ ] 用户批准后，由独立 design-review 子代理基于本版产出 `passed` 的 `design-review.md`
- [ ] 两项完成后才可 `task.py start`（`task.json:status` 方能由 `planning` 转 `in_progress`）
- [ ] E2E-B（本地 mock-provider）是「真实 rc.8 headless/provider 栈可用」的必过 gate；E2E-A 不得充当该证据
- [ ] 真实 `eval` profile 迁移需临时绿灯证据出示后用户显式批准
- [ ] 任何窄适配器的引入需用户确认其对应真实 rc.8 失败证据已归档
