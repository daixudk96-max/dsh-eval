# UPSTREAM — dsh-eval standalone fork provenance

This package is a **standalone fork** of `hccccc01333/dsh-eval` for the
DSH (deepseek-harness) rc.8 host. It keeps the upstream runner and the full
benchmark/report/compare/import semantics, and adds an explicit launcher /
model-provider / settings / credential bridge so the trial child actually
reaches the rc.8 headless+provider stack, plus a closed npm `files`/`exports`
tarball so the installed artifact boots.

## Origin

- Repository: `git+https://github.com/hccccc01333/dsh-eval.git`
- Pinned commit: `47f39d7c1453de16b7ed1a3846980d0765eb1f3a`
  (`47f39d7 docs: npm and license badges for public-facing README`)
- Read-only provenance clone: `research/dsh-eval-src/` (never edited in place).
- License: MIT, Copyright (c) 2026 hccccc01333 (see `LICENSE`).

## Copy mapping

Files copied verbatim from `research/dsh-eval-src/packages/eval/` into this
package (source of truth = upstream at the pinned commit):

| Shipping file | Upstream path |
|---|---|
| `src/benchmark.ts` | `src/benchmark.ts` (edited) |
| `src/command.ts` | `src/command.ts` (edited) |
| `src/compare.ts` | `src/compare.ts` (verbatim) |
| `src/import.ts` | `src/import.ts` (verbatim) |
| `src/index.ts` | `src/index.ts` (edited) |
| `src/invariant.ts` | `src/invariant.ts` (verbatim) |
| `src/judge.ts` | `src/judge.ts` (verbatim) |
| `src/metrics.ts` | `src/metrics.ts` (verbatim) |
| `src/report.ts` | `src/report.ts` (verbatim) |
| `src/runner.ts` | `src/runner.ts` (edited) |
| `src/trace.ts` | `src/trace.ts` (verbatim) |
| `src/types.ts` | `src/types.ts` (edited) |
| `tests/**` | `tests/**` (verbatim; upstream fixtures kept) |
| `tsconfig.json` / `tsconfig.build.json` | same (edited only if needed) |
| `vitest.config.ts` | `vitest.config.ts` (verbatim) |
| `README.md` / `README.zh.md` | same (edited: command syntax + launcher/credentials docs) |
| `cordis.patch.yml` | `cordis.patch.yml` (verbatim) |
| `LICENSE` | repo-root `LICENSE` |

New files added (not upstream):
- `src/launcher.ts` — launcher resolution bridge (CLI > YAML > current CLI argv).
- `src/model.ts` — model/provider selection bridge + judge defaults.
- `src/settings-bridge.ts` — provider/settings subtree extraction + fail-closed rules.
- `src/credential-bridge.ts` — per-trial credential value resolution.
- `scripts/prepare-sdk.mjs` — disposable SDK mirror build (maintainer-only).

## Local delta vs upstream

1. **Packaging closure fix:** `files` now includes the full `lib/**/*.js` +
   `lib/types.js` + `lib/types/**/*.d.ts` + `cordis.patch.yml` + README + LICENSE,
   so the installed tarball contains every runtime module (upstream `0.2.0`/
   `0.3.0` omitted `lib/benchmark.js` etc. and failed `ERR_MODULE_NOT_FOUND`).
   `version` bumped to `0.3.1-standalone.0`.
2. **Exports fix:** `./types` runtime target -> `./lib/types.js` (upstream
   pointed to a non-existent `./lib/types/types.js`); removed the `./src/*`
   public export (internal source entry, not a drop-in contract).
3. **Launcher bridge:** omitted benchmark `command` now resolves to the
   current running DSH CLI argv (`[process.execPath, argv[1]]`, `shell:false`,
   no PATH dependency) instead of upstream's `['dsh']` PATH spawn.
4. **Model semantics:** optional benchmark `provider`; the child's
   `agent-default-model` is set to the effective selection,
   `{provider: benchmark.provider ?? parent currentSelection().provider, model: benchmark.model}`;
   the run persists the actual provider. Judge provider/model default to the
   effective selection (no hardcoded `deepseek`).
5. **Provider/settings bridge:** consumes only public rc.8 services
   (`llm.listProviders`/`listConfigurableProviders`, `settings.describe`),
   copies only the selected provider's subtree into the minimal child
   `settings.yaml`, and fails closed on non-empty raw `headers` or non-bridgeable
   routes. External bundles require an explicit wrapper command.
6. **Credential bridge:** resolves the credential value via parent
   `credentials.resolve(ref)` before every trial spawn (never cached per run)
   and injects only that ref/value into the child env. `runner.ts` still
   inherits parent `process.env` (PATH/HOME/TEMP + ambient env).
7. **Loader settlement:** `runEval` awaits `ctx.get('loader')?.await()` before
   reading services, matching the headless/app-boot pattern.
8. **Variadic `--dsh <argv...>`:** replaced upstream whitespace-split `--dsh`.

## Build

Maintainer-only. See `docs/` / `scripts/prepare-sdk.mjs`. The real
`E:\github\dsh` checkout is never modified; a disposable
`packages/dsh-eval/.sdk/dsh` mirror holds the pinned rc.8 workspace, DSH host
libs are built there first, the eval member is inserted second, and the
authoritative `npm pack --json` runs inside the mirror package. Consumers only
install the resulting `.tgz`/release dir — no SDK needed.
