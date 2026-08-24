# P0 技术设计：可观察 Judge、Frozen Epoch 与 Registry Archive

- status: approved
- execution lane: standard
- 2026-08-23 用户已批准推荐契约与四阶段计划（judge fail-closed / hallucination regression / frozen invalid run / import 空 root）。

## 1. Architecture Boundaries

```text
benchmark YAML
  └─ dsh-eval loader
      ├─ semantic snapshot: benchmarkDigest + caseHashes + material manifest
      ├─ executor child: headless dsh, trace/metrics/scripted check
      └─ injected JudgeChat: LLM rubric score + diagnostic
             ↓ run.json (never fabricate null as 0)
 dsh-evolve (read run evidence)
      ├─ benchmark metadata → overfit early check
      ├─ baseline/candidate epoch comparison
      └─ controller.evaluate({baseline,candidate,rubric,gateOverrides})
             ↓ deterministic gate
 preset-registry: seal → CAS promote → pointer/WAL/audit

 registry exportSnapshot → file-hashed JSON package → importSnapshot(new empty root)
```

`packages/dsh-eval` remains the evaluation/read plane. `packages/evolution-controller` remains proposal/gate/write orchestration. `packages/preset-registry` remains immutable storage and pointer/WAL recovery. No package receives live Cordis objects across the boundary.

## 2. P0-1 Judge Contract

### 2.1 Preserve existing execution path

Do not add a second HTTP client or duplicate `llmJudgeChat(...)`. The implementation first runs a diagnostic against the existing path:

- `packages/dsh-eval/src/index.ts:51-54` — `ctx.get('llm')` seam availability;
- `packages/dsh-eval/src/index.ts:232-245` — loader/service injection;
- `packages/dsh-eval/src/runner.ts:471-477` — configured judge/no seam behavior;
- `packages/dsh-eval/src/judge.ts:178-197` — stream route and strict JSON parse.

Diagnostic categories are stable and non-secret: `NO_LLM_SEAM`, `PROVIDER_CONFIG`, `CREDENTIAL_UNAVAILABLE`, `JUDGE_CALL_FAILED`, `JUDGE_OUTPUT_INVALID`, `JUDGE_SCORED`. The diagnostic must never persist credential values, raw provider errors containing secrets, or private rubric text.

A configured judge with no llm seam remains a configuration-level fail-loud error, matching `packages/dsh-eval/src/runner.ts:471-477`. A per-trial provider failure or malformed response remains a completed trace with null judge fields plus an observable diagnostic; it is not converted into task success or score zero.

### 2.2 Persisted evidence

Extend the optional judge verdict/run diagnostic shape without breaking old JSON:

```text
EvalJudgeVerdict {
  finalAnswerScore: number | null
  hallucination: boolean | null
  rationale?: string
  status?: 'scored' | 'call-failed' | 'output-invalid'
  errorCode?: 'JUDGE_CALL_FAILED' | 'JUDGE_OUTPUT_INVALID'
}

EvalRun.judgeDiagnostics?: {
  configured: boolean
  attempted: number
  scored: number
  callFailed: number
  outputInvalid: number
  codes: string[]
}
```

Only sanitized error codes are persisted. Existing tests that assert the old null verdict remain valid by making new fields optional; new tests assert status/diagnostic when the seam fails.

### 2.3 Evolution mapping

`packages/evolution-controller/bin/dsh-evolve.js` gains a pure `rubricEvidence(run, options)` helper beside `evalEvidence(run)`:

```text
EvolutionRubricEvidence {
  score: number | null          // normalized 0..100
  maxScore: number
  minScore: number              // default 60, CLI/config override
  hallucinationRate: number | null
  regressions: string[]
  valid: boolean
  sourceRun: string
}
```

`score = run.grading.finalAnswerScore / run.judge.maxScore * 100`. The helper rejects missing/invalid score, missing judge configuration, and invalid run rather than substituting zero. `hallucinationRate` is compared baseline→candidate; a candidate increase produces `hallucination` in `regressions`. The command passes:

```js
controller.evaluate(run.id, {
  baseline: { ...numericEvidence, steps },
  candidate: { ...numericEvidence, steps },
  gateOverrides: { minEffect, epochSame, rubricValid },
  rubric: { score, minScore, regressions },
})
```

`gate.js` keeps existing `rubricScore/rubricMinScore/rubricRegressions`, adds an optional `rubricValid` early invalid rule, and checks `epochSame`/rubric validity before gain-based `INCONCLUSIVE`. A missing judge is never equivalent to an absent rubric in an evolution run that requested judge scoring.

## 3. P0-2 Overfit Contract

### 3.1 Module and input

New `packages/evolution-controller/lib/overfit.js` (CJS, zero dependency, `# absorbed-from: timwhitez/dsh-self-evolving specs/03 §9` and mechanism reference `research/dsh-self-evolution/src/candidate.ts:201-239`) exports a pure inspection function:

```text
inspectOverfit({ sourceFiles, candidateFiles, benchmarkMeta })
  → { ok: boolean, findings: [{ code, kind, caseId?, path? }] }
```

`benchmarkMeta` is an in-memory corpus:

```text
{
  benchmarkDigest: string,
  cases: [{ id: string, statement: string, privateRubric?: string }]
}
```

No finding carries matched text. `privateRubric` is only held in memory for the comparison and is never placed in run/audit/error output.

### 3.2 Delta scan

The detector derives candidate-added/modified text from `sourceFiles` and `candidateFiles` using deterministic normalized line comparison. Unchanged source content is not scanned. The exact P0 rules are:

- digest exact match → `BENCHMARK_OVERFIT` / `digest`;
- trimmed statement length ≥40 contained in added text → `BENCHMARK_OVERFIT` / `statement`;
- `case_id: <id>` with id length ≥8 → `BENCHMARK_OVERFIT` / `case-id`;
- trimmed private rubric length ≥20 contained in added text → `BENCHMARK_CONTAMINATION` / `private-rubric`.

This is intentionally exact-text protection, not semantic generalization detection. It is conservative about privacy and deterministic about output.

### 3.3 Controller integration

`EvolutionController.createCandidate(...)` obtains source/candidate files, runs proposal quality check and overfit check before `registry.createCandidate(...)`. On failure it appends only structured `proposal-rejected` evidence (`code`, `kind`, `caseId`, `path`) and throws a stable error. The staging directory must remain absent for this rejection. `gate.js` receives only optional structured contamination status if a future caller needs a sealed-revision defense; it never reads benchmark prose or private rubric.

The CLI metadata adapter must provide `benchmarkMeta` for frozen optimization. If a frozen run has no metadata provider, the command fails closed before candidate creation. Non-frozen legacy callers may omit metadata and retain backward compatibility.

## 4. P0-3 Frozen Epoch Contract

### 4.1 Benchmark schema

Add to the existing schema in `packages/dsh-eval/src/benchmark.ts`:

```yaml
frozen: false                 # default, backward compatible
materials:                    # optional explicit files, relative to benchmark baseDir
  - fixtures/input.json
```

`materials` accepts only regular files contained by the benchmark directory; no `..`, symlink escape, directory expansion, or implicit workspace-wide scan. `workspace` remains agent output and is not a benchmark material unless explicitly listed outside it.

The loaded `Benchmark` carries `sourcePath`, `frozen`, `benchmarkDigest`, `caseHashes`, and a normalized material manifest. The semantic digest covers:

- benchmark name and case order;
- case id, split, resolved prompt, expected tool/check;
- judge provider/model/maxScore and the resolved plaintext rubric hash;
- explicit material relative paths and bytes.

Provider credential routing and temporary paths are provenance only. Case hash covers the case-level fields plus the relevant benchmark-level judge rubric hash. Hashing uses canonical JSON + SHA-256; plaintext rubric is hashed in memory and never written to run JSON.

### 4.2 Run lifecycle

At `runBenchmark(...)` start, frozen benchmarks capture a snapshot. At the end of the full case×trial loop, the loader reloads `sourcePath` and recomputes the snapshot, matching the reference pattern in `research/dsh-self-evolution/src/engine.ts:158-169,305-320`.

Extend `EvalRun` with optional:

```text
status?: 'completed' | 'invalid'
benchmarkDigest?: string
caseHashes?: Record<string, string>
benchmarkSnapshot?: {
  frozen: boolean
  observedDigest: string
  verified: boolean
  mismatches: Array<{ path: string; expected?: string; observed?: string }>
}
epochChanged?: boolean
notes?: string[]
```

If frozen materials/config change, missing material or path verification fails, return an invalid run that preserves trial evidence but sets `aggregate:null`, `grading:null`, `status:'invalid'`, `epochChanged:true`, sanitized notes/mismatches, and a nonzero CLI result. No candidate gate may consume its partial score. Non-frozen runs record the snapshot but do not invalidate on drift.

### 4.3 Evolution comparison

`dsh-evolve` reads `benchmarkDigest`, `status`, `epochChanged` from both run records. `epochSame` is true only when both runs are valid/completed, frozen snapshot verification succeeded, and benchmark digests match. A mismatch is passed to gate as `epochSame:false`; gate returns `INVALID` before effect/efficiency `INCONCLUSIVE`.

## 5. P0-4 Export/Import Contract

### 5.1 Package schema

New registry methods use the existing instance root:

```text
registry.exportSnapshot(outPath) → { schemaVersion: 1, packageDigest, fileCount }
Registry.importSnapshot({ root, inPath, verify: true }) → { imported, packageDigest, revisions }
```

The JSON package contains:

```text
{
  schemaVersion: 1,
  exportedAt: ISO string,
  files: [{ path, encoding: 'base64', content, sha256 }],
  packageDigest: sha256(canonical(files without packageDigest))
}
```

Files include all `logical/**`, `pointers/**`, `revisions/**`, and the byte-preserved `ledger/ledger.jsonl`; exclude `staging/**`, `.tmp`, and live adapter state. All revisions are exported, not only `history()`'s rollback window.

### 5.2 Validation and transaction

Import validates schema/version, path normalization, no traversal/absolute path/duplicate path, each file hash, package digest, revision manifest digest, and pointer/logical references before writing. The target must be absent or empty; non-empty targets are rejected. Validation writes nothing. A temporary sibling root is populated and recovered, then renamed when the target is absent; an existing empty target is filled only after all validation. Any failure leaves an existing target untouched.

`verifyRevisionDigest(...)` remains a legacy manifest check. Export file hashes are the authoritative revision-file integrity check; both results are reported separately in tests/audit. No legacy digest algorithm or revision ID is migrated.

### 5.3 CLI mode

`packages/evolution-controller/bin/dsh-evolve.js` parses `--export <path>` and `--import <path>` before requiring benchmark/logical. These modes require only `--registry`, reject incompatible evolution flags, return nonzero on validation failure, and do not start a model evaluation.

## 6. Compatibility and Rollback

- `frozen` defaults false; old benchmark YAML and old run JSON remain loadable.
- New judge diagnostic fields are optional; old null-verdict assertions remain valid.
- Existing gate calls without steps/rubric/epoch inputs preserve old behavior, except an evolution command that explicitly requested judge/frozen evidence fails closed on missing evidence.
- Existing registry revisions retain their IDs and manifest digest algorithm.
- Overfit rejection leaves an uncreated/GC-able proposal only when a caller has already created a draft; the recommended path checks before registry staging.
- Export/import is additive; import only targets a new/empty root in P0.

## 7. Design Risks / Deferred Decisions

- The real `eval` profile must be smoke-tested before implementation claims AC1; a missing service and a provider response failure must not be conflated.
- The CLI needs a safe benchmark metadata adapter for private rubric matching. It may use an in-memory loader seam; it must not emit plaintext rubric in run/audit.
- Windows directory replacement and atomic import need a dedicated test rather than assuming POSIX rename semantics.
- Exact semantic diff extraction for overfit is intentionally line-based in P0; semantic paraphrase detection remains out of scope.

## 8. Human Review Gate

- [ ] Strict fail-closed policy confirmed by user.
- [ ] This design changed to `status: approved` after the user approves the complete planning summary.
- [ ] Only then may `task.py start` be run and product code be edited.
