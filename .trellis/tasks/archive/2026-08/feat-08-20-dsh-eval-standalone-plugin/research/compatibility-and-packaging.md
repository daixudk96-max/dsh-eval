# Compatibility & Packaging Research — dsh-eval standalone plugin

Date: 2026-08-20
DSH baseline: `0.1.0-rc.8` (`E:\github\dsh` HEAD `141eb6fef83422698aef7a981029e843e8161534` — Merge PR #2783)
Upstream source pinned: `hccccc01333/dsh-eval` cloned to `E:\github\dsh-eval\research\dsh-eval-src` @ `47f39d7c1453de16b7ed1a3846980d0765eb1f3a` (`47f39d7 docs: npm and license badges for public-facing README`)
Current eval profile: `C:\Users\daixu\.dsh\profiles\eval` (reference baseline; temporary verification uses disposable test root, never this path)
Fork identity: `dsh-eval` @ `0.3.1-standalone.0` (non-colliding with upstream `0.3.0`, drop-in via `dsh.profile.bundles`)

## 0. rc.8 invocation contract (verified)

`E:\github\dsh\apps\cli\src\args.ts:13-14` — "web is a hardcoded alias for --profile web; plugin manages a profile's plugin dependencies by forwarding to pnpm." Generic app invocation is `dsh --profile <name> <inner-args...>`.

Therefore dsh-eval commands are exactly:

- `dsh --profile eval --help` — shows the eval program/subcommands
- `dsh --profile eval run <benchmark.yaml> --out <path>`
- `dsh --profile eval report <run.json>`
- `dsh --profile eval compare <a.json> <b.json>`
- `dsh --profile eval import <format> <session.jsonl>`

There is no extra `eval` token and no `dsh eval` alias in rc.8. Upstream README's `dsh eval run` is stale docs to fix in the fork.

## 1. Verified npm packaging defect (0.2.0 / 0.3.0)

**Evidence — `files` whitelist incomplete:**

`research/dsh-eval-src/packages/eval/package.json` (the published manifest, same in `0.2.0` and `0.3.0`):

```json
"files": [
  "lib/index.js",
  "lib/invariant.js",
  "cordis.patch.yml",
  "lib/types/**/*.js",
  "lib/types/**/*.d.ts",
  "src/**/*.ts"
]
```

`src/` contains the real modules that must appear in `lib/` after build: `benchmark.ts`, `command.ts`, `runner.ts`, `trace.ts`, `judge.ts`, `metrics.ts`, `report.ts`, `compare.ts`, `import.ts`, `invariant.ts`, `types.ts`, `index.ts` (12 entries).

`tsconfig.build.json` (`extends ./tsconfig.json`, `outDir: lib`, `rootDir: src`, `declarationDir: lib/types`) emits one `.js` per `src/*.ts` plus `lib/types/*.d.ts`. `prepack` is `pnpm run build`, so a correct publish must contain `lib/benchmark.js`, `lib/command.js`, `lib/runner.js`, `lib/trace.js`, `lib/judge.js`, `lib/metrics.js`, `lib/report.js`, `lib/compare.js`, `lib/import.js`, etc.

**Installed artifact observed:** `C:\Users\daixu\.dsh\profiles\eval\node_modules\dsh-eval\lib\` contains only `index.js`, `invariant.js`, `types/`; the expected sibling `.js` are absent in both `0.3.0` and `0.2.0`. Import in `lib/index.js` (`import { loadBenchmark } from "./benchmark.js"`) fails at profile boot with `ERR_MODULE_NOT_FOUND: Cannot find module '...dsh-eval/lib/benchmark.js'`. Deterministic packaging closure failure, not environmental.

**Required fix (minimal, upstream-preserving):** keep `name: dsh-eval`, `version: 0.3.1-standalone.0`; change `files` to a closed set that always includes the full build output, e.g. `lib/**/*.js`, `lib/types.js`, `lib/types/**/*.d.ts`, `cordis.patch.yml` (optionally `src/**/*.ts` for audit); tarball contains no DSH checkout files/absolute paths/symlinks. Add `files` verification to CI (`npm pack --dry-run`).

**Second packaging defect — `exports` closure (verified):** upstream `exports` (`research/dsh-eval-src/packages/eval/package.json:15-31`) has:
- `"./types"` → `types: ./lib/types/types.d.ts`, `default: ./lib/types/types.js` — but `src/types.ts` emits **`lib/types.js`** (single file), so the `./types` runtime target is **missing** (`lib/types/types.js` does not exist) and there is **no `lib/types.js` export** for the actual output.
- `"./src/*"` → `./src/*` — a public export pointing at TS source (not a drop-in runtime contract).

**Fix:** `files` must include `lib/types.js`; set `"./types"` runtime target to **`./lib/types.js`** (types-only-valid target, recommended); **remove `"./src/*"`** public export and document that the internal `./src/*` source entry is out of the drop-in compatibility promise (only `./package.json` etc. remain). After unpacking the actual tgz, **assert every `exports`/`main`/`types` target exists**. Run import/boot validation after installing the same tgz into a temp DSH profile (do not require a bare unpack dir to fully execute `lib/index.js` without peers).

## 2. Upstream runner is reusable (retain, do not rewrite)

`research/dsh-eval-src/packages/eval/src/runner.ts` (388 lines) read in full:

- Spawns one headless `dsh` per `case × trial` via `node:child_process:spawn` (`command` from benchmark, plus `--profile`, `--patch`, plus `case.prompt`).
- Per-trial isolation: `mkdtemp(join(tempRoot, 'dsh-eval-'))`, `workspace/` + `dsh-home/` private dirs, `cp(workspace)`, `evalOverlay()` writing `eval.cordis.yml` that forces `session-persistence-jsonl: { packChunks: false, compression: none }`, `sandbox-policy: workspace-write`, `approval: never`, optional `llm-replay`.
- Env: `{ ...process.env, DSH_HOME: dshHome }`. **Correction:** `{...process.env}` alone does NOT suffice — the trial temp `DSH_HOME` is empty, so `.credentials.yaml`/settings do not propagate; the product credential/config bridge (sections 7.4/7.3) injects the resolved ref/value into the child env and writes the minimal child settings. Session log handling is the plugin's responsibility not to intentionally emit credentials.
- Harvest: `findSessionLogs(dshHome)` → `loadTrace` → `mergeTraces` → `computeMetrics(trace, pricing)` → `gradeTrial` → `tryJudgeTrial`.
- `runner.ts` itself does not import `@deepseek-ai/dsh-session`/`dsh-llm` at the spawn boundary; its DSH-touching imports are indirect via `trace.ts`/`judge.ts`/`metrics.ts`/`command.ts`. The spawn/record/harvest/grading/report loop is host-process agnostic and preserved as-is.

`expected.check` does NOT bypass the model call — post-hoc grading after the agent exits. Offline smoke must use `research/dsh-eval-src/packages/eval/tests/fixtures/fake-dsh.mjs` or an `llm-replay` fixture; real model smoke optional and separately authorized/costed.

## 3. rc.8 profile & installation contracts (read-only, verified)

All references point to `E:\github\dsh` sources, not modified by this task.

**Consumer-facing host contracts (plugin may rely on):** profile manifest and bundle patch (`dsh.profile.bundles`/`dsh.bundle.patch`); host-injected CLI seams (`cmdlineArgs`, `appExit`); one-command profile install + reconcile (`dsh plugin --profile <name> add <artifact>`); subprocess args and persisted JSONL shape (`--profile`, `--patch`, `DSH_HOME`, `session.jsonl` plain JSONL with `{type:'session',id,createdAt}` header).

**Internal implementation evidence (research-only, plugin must not import private source paths):** `composeEntries`, `applyEntryPatches`, and specific function names observed in `profile.ts`/`plugin.ts`/`profile-boot.ts` are rc.8 internal details for verification, not runtime imports.

**Verified evidence:**

- `packages/boot/app-boot/src/profile.ts:125` — `DEFAULT_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base']`.
- `packages/boot/app-boot/src/profile.ts:114-117` — `PROFILE_TEMPLATES = { web: [...,'@deepseek-ai/dsh-web-app'], headless: [...,'@deepseek-ai/dsh-headless'] }`.
- `packages/boot/app-boot/src/profile.ts:223-255` — `healProfilesModuleFallback(installAnchor, home)` builds `$DSH_HOME/profiles/node_modules` as a flat symlink farm over the BFS dependency+peer closure.
- `apps/cli/src/profile-boot.ts:99` (`healProfilesModuleFallback(INSTALL_ANCHOR)` before `loadProfile`), `apps/cli/tests/web-agent-presets.e2e.ts:117`, `packages/boot/app-boot/tests/profile.spec.ts:214`.
- `apps/cli/src/plugin.ts` — `runPlugin(profile, args)`: if `profile/package.json` missing, `initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)`; then `spawnSync('pnpm', ...)`; on success `reconcilePlugins(before, dir)` reconciles bundles to installed bundle-declaring deps.
- `apps/cli/src/args.ts:13-14` — only `web` is a hardcoded alias.

**Result:** a correct standalone `dsh-eval` bundle must declare `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` and list `lib/index.js` as runtime entry; `dsh plugin --profile eval add <tgz|git-spec>` joins `dsh.profile.bundles`. No manual edit / `harness/` junction needed.

## 4. Current eval profile — structurally correct, only artifact is broken

Observed `C:\Users\daixu\.dsh\profiles\eval\package.json`: `dependencies: { "dsh-eval": "^0.2.0" }`, `dsh.profile.bundles: ["@deepseek-ai/dsh-base","dsh-eval"]` — already the intended rc.8 shape; `pnpm-workspace.yaml` + `cordis.patch.yml` present. Failure is isolated to the installed package's missing `lib/*.js`. Temporary verification uses a disposable test root, never this real path.

## 5. Adapter policy — narrow, failure-gated

**Verified coupling surface in the upstream source (by reading every `src/*.ts`):**

| File | Current DSH import | Nature |
|------|--------------------|--------|
| `command.ts:12` | `parseCmdline` from `@deepseek-ai/dsh-cmdline` | CLI arg dispatch over `ctx.cmdlineArgs` |
| `trace.ts:12` | `decodeStorageRecord`, `SessionId` from `@deepseek-ai/dsh-session` | Storage-record decode + brand |
| `metrics.ts:10-13` | `isTokenDelta` from `@deepseek-ai/dsh-llm/message`; `import type {} from '@deepseek-ai/dsh-llm-retry/types'` | Token-delta guard + retry event type augmentation |
| `judge.ts:11-12` | `BlockAssembler`, `createMessage`, `LlmRuntime`, `ContentBlock` from `@deepseek-ai/dsh-llm` | Judge chat over `llm.stream` |
| `types.ts:9` | `SessionEvent`, `SessionId` from `@deepseek-ai/dsh-session` | Pure type import |
| `invariant.ts:8` | `InvariantInstaller` from `@deepseek-ai/dsh-invariants` | Empty invariant (`install: () => {}`) |

**Policy:**

- The public host ABI is stable and does not need adapters: `dsh.profile.bundles`/`dsh.bundle.patch`, `dsh plugin --profile ... add` + reconcile, subprocess contract, `cmdlineArgs`/`appExit`, and the consumed public services (`loader`/`agentDefaultModel`/`llm`/`settings`/`credentials`).
- A **narrow adapter only when a concrete compatibility failure is reproduced** against rc.8; never guess field names; structural guards only on exact rc.8 source/contract leaf fields.
- Preferred adapter surface (if needed): `command.ts` → thin shim; `trace.ts` → fallback JSON-line decoder; `metrics.ts` → minimal leaf guard only after failure; `judge.ts` → keep `JudgeChat`, optional `llm.stream` (unjudged degrade); `types.ts` → local structural types; `invariant.ts` → conditional registration.
- **launcher/model/config/credential bridges are explicit product-correctness work (sections 7.1-7.4), NOT part of this failure-gated adapter table.** They are delivered in the product package, not deferred.

## 6. What the MVP must prove (and what it must not do)

- Must prove: a single `.tgz` (or GitHub-release-ready directory) built from the pinned upstream source (`dsh-eval` @ `0.3.1-standalone.0`) with a closed `files`/`exports`/`prepack` — including the `./types`→`./lib/types.js` fix and removal of `./src/*` — and a tarball-closure test asserting every `exports`/`main`/`types` target exists, installs with one `dsh plugin --profile eval add <artifact>` against a disposable test root, and `dsh --profile eval --help` shows eval subcommands and `dsh --profile eval run` completes against `fake-dsh.mjs`/`llm-replay` with grading/metrics/report and no bundle-declaration warning. Runtime import/boot is validated after installing that same tgz into a temp DSH profile.
- Must prove: tarball contains no DSH checkout files/absolute paths/symlinks; E2E-B keeps the fixture secret in exactly one allowlisted parent location `<parent-home>/.credentials.yaml` (assert it CONTAINS the fixture) and asserts it is absent from every plugin-generated/output location (run.json, session JSONL, child settings, overlays, child homes/profiles, trial workspaces, stdout/stderr/log captures, release/tgz) and that NO child `.credentials.yaml` copy exists (product/plugin non-persistence).
- Must not: rewrite `runner.ts`, change `E:\github\dsh`, publish to npm, assume `expected.check` bypasses the model, guess token-delta field names, or treat `{...process.env}` alone as sufficient credential/config propagation.

## 7. rc.8 launcher / model / settings / credential contracts (verified for product bridges)

These are **explicit product-correctness work** (not failure-gated adapters). All verified read-only against `E:\github\dsh` @ `141eb6fef8`; none of these files are modified by this task.

### 7.0 Loader settlement

- eval's async execution must `await ctx.get('loader')?.await()` **before** reading `agentDefaultModel` / `llm` / `settings` / `credentials` / `judgeChat`, so the plugin tree is fully mounted (tools/adapters not half-composed). After settlement, a missing service (`ctx.get(...) === undefined`) is a readable fail-fast.
- Evidence: `E:\github\dsh\packages\bundle\headless\src\index.ts:96-106` — `await ctx.get('loader')?.await()` then checks agents/agentDefaultModel/sessions undefined → return; `E:\github\dsh\packages\boot\app-boot\src\index.ts:782` — boot awaits `ctx.get('loader')?.await()` before `assertEntriesActivated`.

### 7.1 Launcher resolution

- `research/dsh-eval-src/packages/eval/src/benchmark.ts:54` — `command: z.array(...).default(['dsh'])`; `runner.ts:197` spawns `command[0]` via Node `spawn` (PATH resolution). On this machine `dsh` is **not** on PATH; the only launcher is `node E:\github\dsh\apps\cli\lib\bin.js`.
- **Fix:** benchmark-default `command` must not be `['dsh']` and must not be PATH-dependent. **Omitted `command` resolves to the current running DSH CLI** = argv `[process.execPath, resolved process.argv[1]]`, `shell:false` (preserves spaces) — this **succeeds** with no PATH dependency.
- **Precedence:** ① CLI explicit argv override ＞ ② benchmark YAML `command` array ＞ ③ current launcher. **Fail early only when** the current launcher cannot resolve (e.g. `process.argv[1]` missing/unreadable) or the explicit argv is invalid — readable diagnostic + exit 1, never silently degrading to all-error `run.json`. A dedicated negative test pins this as a distinct negative case, not the standard omitted-command result.
- **`--dsh`:** replace upstream `command.ts:57-61` whitespace `splitCommand`. **Chosen design: `--dsh <argv...>` Commander variadic** — token-by-token, preserving shell quoting; never whitespace-split. benchmark YAML `command` array stays the preferred explicit override; docs note complex/leading-`--` launcher args should go through YAML `command`. Tests cover Windows paths with spaces and the negative case (current `process.argv[1]` unresolvable / explicit launcher invalid); ordinary omitted-`command` must resolve to the current CLI and succeed.

### 7.2 Actual model semantics (per-run-fixed snapshot)

- `benchmark.model` upstream is only used for pricing/report (runner.ts:315/377/381), NOT to configure the spawned child; the child headless reads `agentDefaultModel.currentSelection()`.
- **Fix:** add optional `benchmark.provider`. Actual selection = `{ provider: benchmark.provider ?? parent agentDefaultModel.currentSelection().provider, model: benchmark.model }`. **The model + provider settings snapshot is fixed per run** for reproducibility. Each run writes the selection into the child's minimal `settings.yaml` under `agent-default-model`.
  - `packages/core/agent-default-model/src/index.ts:21` — `AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-default-model')`; `:88 currentSelection(): ModelSelection {provider, model}`.
  - `packages/bundle/headless/src/index.ts:101-106` — headless injects `['agentDefaultModel','agents','sessions']` and reads `currentSelection()`.
- Persist/report actual provider+model in `run.json`/report. **New runs MUST write `provider`**; for compatibility with old `run.json` and `import`, types/rendering allow `provider` absent and show legacy/imported unknown — report/compare must not break on old files. E2E-B asserts `run.json` provider+model match the mock request.
- **Judge:** `judge.provider` omitted → effective benchmark provider (not hardcoded `deepseek`); `judge.model` omitted → benchmark model.

### 7.3 Provider/settings bridge (public services only; exact MVP scope)

- Consume only public rc.8 services: `agentDefaultModel.currentSelection()`, `llm.listProviders()`, `llm.listConfigurableProviders()`, `settings.describe({redactSecrets:true})`, `credentials.resolve(ref)`.
- Locate the selected provider's `settingsNs`/`settingsPath` via `llm.listConfigurableProviders()` (`packages/llm/llm/src/index.ts:490`; `types.ts:163-177`):
  - deepseek (`llm-deepseek/src/index.ts:283`): `settingsNs='llm-deepseek'`, `settingsPath=[]`.
  - pi-ai route (`llm-pi-ai/src/index.ts:129-130`): `settingsNs='llm-pi-ai'`, `settingsPath=['providers',<route>]`.
- **Exact MVP scope:** auto-bridge requires the route to appear in **both** `llm.listProviders()` (currently live) **and** `llm.listConfigurableProviders()` (has settingsNs/settingsPath) — i.e. **DeepSeek + configured pi-ai routes**. A route present only in the configurable directory but not live must give a readable pre-start/selection error. External provider bundles or non-directory routes (no settingsNs/settingsPath) are **not auto-copied**; the escape hatch is an **explicit wrapper command** that itself manages/overrides the child profile, DSH_HOME, and credential policy (not merely writing `benchmark.profile` to auto-install an external bundle in an empty child home).
- Extract only the selected provider's resolved settings subtree; write a minimal child `settings.yaml` (`agent-default-model` + that one provider `settingsNs`/`settingsPath` subtree). **Do not copy the parent settings document wholesale.**
- Redacted key fields (`settings.describe({redactSecrets:true})`; `packages/settings/settings/src/index.ts:479-508` + `redact.ts:105` returns `{value, secrets}`) that are required → **fail** rather than materialize the secret.
- **Raw headers exact rule:** if the selected provider subtree contains non-empty `headers`, the auto-bridge **fails closed** with a readable hint to use an explicit wrapper command. No unresolved "allowlist or fail-closed" wording.

### 7.4 Credential bridge (per-trial value)

- Discover `apiKeyEnv` from the selected provider's resolved config:
  - deepseek official: default `DEEPSEEK_API_KEY` (`llm-deepseek/src/index.ts:47,99,209`).
  - pi-ai route: its configured `apiKeyEnv` (`llm-pi-ai/src/config.ts:86,296,436`); a route naming no credential defers to pi-ai's own environment discovery (`llm-pi-ai/src/index.ts:179-195`).
- **The per-run-fixed model/provider settings snapshot determines the credential `ref`** (reproducible), but the credential **`value` must be resolved via parent `ctx.credentials.resolve(ref)` before every `case × trial` spawn** — **not cached per run**.
- **Each trial only ADDS that one ref/value to the child env from the managed credentials store**; however the runner still **inherits parent `process.env`** (PATH/HOME/TEMP + pre-existing ambient env) to keep the subprocess runnable — do **not** claim the child only sees this single credential; provider-native ambient discovery works precisely because of this inherited env.
- **Never** write credential values to `settings.yaml`, overlay, `run.json`, `session.jsonl`, or temp files; never log values.
- Route with no named ref → rely on inherited environment/provider-native discovery (no injection).
- Readable diagnostics for unresolved named refs (ref name, never the value).

## 8. Verification gates (E2E-A / E2E-B / E2E-C)

- **E2E-A (offline deterministic, required):** tar/bundle/profile/CLI/metrics/report via `fake-dsh.mjs` or `llm-replay`. **E2E-A green is NOT evidence of real-model usability.**
- **E2E-B (local mock-provider, required):** parent home + trials under one disposable test root; parent `.credentials.yaml` + settings → credential/config bridge → minimal child `settings.yaml` + child env → **real rc.8 headless/provider stack** via a local mock server; assert `Authorization` and the selected model reach the mock, **no external billing**. **E2E-B also covers an omitted-`command` case (current CLI argv default succeeds).** **Credential-source isolation (required):** because credentials-local precedence is inherited env > parent `.credentials.yaml` > project/user `.env`, the run process must use a disposable cwd and a disposable OS-home (`HOME`/`USERPROFILE` as applicable) under testRoot with **no `.env`**, and remove the selected ref (e.g. `DEEPSEEK_API_KEY`) **case-insensitively from the launch env before spawn**, so the fixture `Authorization` the mock receives is attributable **uniquely** to `<parent-home>/.credentials.yaml` (not a real env or project/user `.env`). Do not mutate or log the real environment globally. This isolation applies only to the E2E-B run process; **the product runner still inherits parent `process.env`** per the documented "only the selected managed ref/value is newly added" wording. E2E-B is the mandatory gate proving the real headless/provider stack works.
- **E2E-C (optional paid external real-model smoke):** separate approval; not a required gate.
- **Isolation:** parent `DSH_HOME` (`<test-root>/parent-home`) and runner trial tempRoot (`<test-root>/trials`) are two distinct roots under the disposable test root; constrain `tmpdir()` to `<test-root>/trials` via a runner option or `TEMP`/`TMP`/`TMPDIR`. Assert parent `<parent-home>/profiles/eval` and each trial `<...>/dsh-home/profiles/headless` live in the test root; **the fixture secret lives in exactly one allowlisted parent location `<parent-home>/.credentials.yaml` (assert it CONTAINS the fixture); the whole-test-root scan is run only with an exact-path allowlist for that parent source and FAILS on any second occurrence** — it also asserts NO child `.credentials.yaml` copy exists and the secret is absent from all plugin-generated/output locations (run.json, session JSONL, child settings, overlays, trial workspaces, log captures, release/tgz); then clean up the whole test root. **This proves product/plugin non-persistence only — it does NOT prove the child env is free of other secrets (the child still inherits parent `process.env`).**
- Remove stale claims that `{...process.env}` alone suffices or that `model` is merely report metadata.

## 9. Shipping implementation layout (real tracked `packages/dsh-eval`)

- Shipping implementation MUST live in the real tracked directory `packages/dsh-eval/` (repo root: `E:\github\dsh-eval\packages\dsh-eval`).
- **Import** (copy) from the read-only nested provenance clone `research/dsh-eval-src/packages/eval`: `src/`, `tests/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `README.md`, `README.zh.md`, `LICENSE`, `cordis.patch.yml`. **Never make product modifications inside the nested research clone.**
- `packages/dsh-eval/UPSTREAM.md` records origin (`git+https://github.com/hccccc01333/dsh-eval.git`), pinned commit (`47f39d7c…`), copy mapping, and local delta (packaging closure fix + launcher/`model`/`settings-bridge`/`credential-bridge` bridges + loader settlement).
- `packages/dsh-eval/` has its own `package.json` (it does **not** need a pnpm-workspace.yaml carrying external junction patterns for SDK purposes; the maintainer script drives a mirror build).
- **Build boundary — disposable SDK mirror (replaces sdk-junction):** `packages/dsh-eval/scripts/prepare-sdk.mjs --dsh <checkout>` first verifies the checkout HEAD is `141eb6fef8`, then expands the full tracked DSH workspace into the ignored `packages/dsh-eval/.sdk/dsh/` via `git -C <checkout> archive <sha>` (or an equivalent read-only copy). Refined in-mirror sequence (host-build first so `tsconfig.host.json` glob/tsdown never see the temp package; all changes stay in `.sdk/`): (a) expand pinned DSH into `.sdk/dsh`; (b) in the **pristine mirror without the member** run `pnpm install --frozen-lockfile` then `pnpm run build:lib:host` (= `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`, confirmed against DSH root scripts); (c) only then copy shipping `packages/dsh-eval` into the mirror member `packages/eval/dsh-eval`; (d) a second isolated `pnpm install --no-frozen-lockfile` (or `--filter` equivalent) — **because the pinned lock has no importer for the newly inserted package; lock mutation is allowed only in `.sdk/`**; (e) `pnpm --filter dsh-eval run typecheck` → `build` → `test`; (f) copy shipping `lib/**` and test evidence back to the shipping package (evidence only). (g) **authoritative pack happens INSIDE the mirror package** — run `npm pack --json` in `.sdk/dsh/packages/eval/dsh-eval` (prepack may rebuild there; its deps and the DSH host libs are ready, unlike the shipping source root whose `workspace:^` dev deps are intentionally unresolved), copy that exact `.tgz` + pack JSON/shasum out to `packages/dsh-eval/dist/`, unpack/closure-check THAT same tgz, and install THAT same tgz into E2E profiles. `prepare-sdk.mjs`/a release script owns this flow. The release-ready directory derives from the validated tgz to prevent divergence. **Never promise a direct source-root `npm pack` works without the maintainer SDK mirror** — the consumer guarantee is tgz install/run only. **Never a vague root `pnpm run build` that implies building the whole product.** (DSH is an npm workspace; use the corresponding `npm install`/`npm run build:lib:host`/`npm --workspace dsh-eval` variants if the mirror is not re-established as a pnpm workspace.) The real `E:\github\dsh` is touched only by git/read; any node_modules/lib/lock changes happen only in the ignored `.sdk/` mirror. The mirror is repeatable to clean/rebuild. **Tarball closure EXCLUDES the entire `.sdk/**` (incl. its generated node_modules/lib/lock), shipping `node_modules/**`, `dist/**` self-artifacts/links, and absolute paths/symlinks; it INCLUDES `packages/dsh-eval/lib/**` generated output (the shipping lib copied back from the mirror expressly for packing).** Consumers install only the tgz and need no SDK. Acceptance includes `git status --porcelain` in the real DSH checkout being byte-identical/empty before and after the build.
