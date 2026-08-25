/**
 * Pure types of the dsh-eval domain: benchmark configuration, harvested
 * traces, per-trial metrics, and the persisted run record. This file contains
 * no runtime code.
 *
 * @module dsh-eval/types
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

/** One model arm's per-million-token pricing, in USD. */
export interface BenchmarkPricing {
  /** Billed uncached input tokens. */
  inputUsdPerMTokens: number
  /** Billed cache-read input tokens. */
  cacheReadUsdPerMTokens: number
  /** Billed cache-write input tokens. */
  cacheWriteUsdPerMTokens: number
  /** Billed output tokens. */
  outputUsdPerMTokens: number
}

/** Split membership of a benchmark case: `dev` or `guard`. */
export type BenchmarkSplit = 'dev' | 'guard'

/** Lifecycle stage of a benchmark case; only `frozen` cases participate in gate stats. */
export type BenchmarkCaseLifecycle = 'draft' | 'calibrating' | 'frozen'

/** Optional case metadata for calibration and evolution bookkeeping. */
export interface BenchmarkCaseMeta {
  /** Capability the case targets (string or list). */
  capability?: string | readonly string[]
  /** What distinguishes this case from near-duplicates (string or list). */
  distinguisher?: string | readonly string[]
  /** Known shortcuts / degenerate solutions to guard against (string or list). */
  shortcuts?: string | readonly string[]
  /** Prior calibration outcomes (string or list). */
  calibrationHistory?: string | readonly string[]
}

/** One benchmark case: a case and an optional workspace copied per trial. */
export interface BenchmarkCase {
  /** Stable case id, used in run output and trial directory names. */
  id: string
  /** The task text handed to the headless agent. */
  prompt: string
  /** Split target this case belongs to; defaults to `dev` (see BenchmarkSplit). */
  split?: BenchmarkSplit
  /** Absolute path to a workspace tree copied into each trial, when provided. */
  workspace?: string
  /** Scripted grading annotations, when the case is graded. */
  expected?: BenchmarkExpectation
  /** Relative weight in aggregate metrics; defaults to 1. */
  weight?: number
  /** Lifecycle stage; defaults to `draft`. Only `frozen` cases enter gate stats. */
  lifecycle?: BenchmarkCaseLifecycle
  /** Optional case metadata for calibration and evolution bookkeeping. */
  meta?: BenchmarkCaseMeta
}

/** Expected-tool and check-command annotations for scripted grading. */
export interface BenchmarkExpectation {
  /** Substring matched against every recorded tool call name. */
  tool?: string
  /** Command run in the trial workspace after the agent exits; exit 0 means task success. */
  check?: string
}

/** One structured judging criterion: the LLM only answers pass/fail; the score
 * weight lives in code (never in the prompt) so numeric bias cannot enter. */
export interface JudgeCriterion {
  /** Criterion text, echoed verbatim into the prompt and the verdict. */
  label: string
  /** Score weight; defaults to 1. Never sent to the model. */
  weight?: number
}

/** LLM-judge configuration: scores final answers and flags hallucinations. */
export interface BenchmarkJudge {
  /** Provider route; '' means "fall back to the effective benchmark provider". */
  provider: string
  /** Judge model id; defaults to the benchmark model when unset. */
  model: string
  /** Optional task rubric appended to the default judging instructions. */
  rubric?: string
  /** Rubric input in benchmark YAML: plaintext (kept on the document). */
  rubricText?: string
  /** Rubric input in benchmark YAML: AES-256-GCM `v1:` envelope; decrypted at load time into `rubric`. */
  rubricCipher?: string
  /** Structured pass/fail criteria (bit-vector scoring). When set, the judge
   * model answers each criterion true/false and the final score is computed in
   * code from the weights — the model never emits a number. */
  criteria?: JudgeCriterion[]
  /** Maximum final-answer score; defaults to 10. */
  maxScore: number
  /**
   * Optional OpenAI-compatible base URL for the judge HTTP fallback, used when
   * the mounted composition carries no `llm` service (e.g. the eval profile
   * bundle). When set, the judge runs over a direct chat-completions call
   * instead of failing with "no LLM chat seam is available".
   */
  baseUrl?: string
  /** Credential env name for the judge HTTP fallback; defaults to `CLIPA_API_KEY`. */
  apiKeyEnv?: string
}

/** Keyless replay configuration: recorded session logs replayed instead of live model calls. */
export interface BenchmarkReplay {
  /**
   * Directory holding one recorded-log tree per trial, named
   * `<caseId>-<trial>/session.jsonl` (child logs ride alongside). A run with
   * a key records these under its `tempRoot`.
   */
  dir: string
}

/** A validated benchmark document. */
export interface Benchmark {
  /** Benchmark name; also the run record's `benchmark` field. */
  name: string
  /** Model id used for pricing lookup and reported per run. */
  model: string
  /** Optional provider route; defaults to the parent's default-model provider. */
  provider?: string
  /** Optional adapter-owned reasoning effort; defaults to the parent's selection. */
  reasoningEffort?: string
  /** dsh profile spawned per trial; defaults to `headless`. */
  profile: string
  /** Command that launches dsh, as argv. */
  command: readonly string[]
  /** Trials per case. */
  trials: number
  /** Per-trial timeout in milliseconds. */
  timeoutMs: number
  /** Reserved deterministic seed for future paired comparisons. */
  seed: number
  /** The benchmark's cases, in order. */
  cases: readonly BenchmarkCase[]
  /** Pricing keyed by model id; an absent model reports `costUsd: null`. */
  pricing?: Readonly<Record<string, BenchmarkPricing>>
  /** LLM-judge configuration, when final-answer scoring is enabled. */
  judge?: BenchmarkJudge
  /** Keyless replay configuration, when model calls replay from recorded logs. */
  replay?: BenchmarkReplay
  /** Directory the benchmark document was loaded from; relative paths resolve against it. */
  baseDir: string
  /** Absolute path of the benchmark document (frozen re-verification reloads it). */
  sourcePath: string
  /** Frozen epoch: materials/config drift invalidates the run. Default false. */
  frozen: boolean
  /** Semantic digest of the benchmark (name, case order, case hashes, judge, materials). */
  benchmarkDigest: string
  /** Per-case semantic hashes (case fields + benchmark judge rubric hash). */
  caseHashes: Readonly<Record<string, string>>
  /** Explicit material manifest: relative path + sha256, resolved against baseDir. */
  materials: readonly { path: string; sha256: string }[]
}

/**
 * One harvested session log. v0.1 carries the durable dsh session event
 * vocabulary directly; neutral importers for other harness formats are
 * deferred to the comparison milestone.
 */
export interface EvalTrace {
  /** Session id from the persisted log header. */
  sessionId: SessionId
  /** Session creation time from the persisted log header, epoch milliseconds. */
  createdAt: number
  /** Durable events in log order. */
  events: readonly SessionEvent[]
}

/** Disjoint provider-reported token buckets over one run. */
export interface EvalTokenUsage {
  /** Uncached input tokens. */
  inputTokens: number
  /** Cache-read input tokens. */
  cacheReadTokens: number
  /** Cache-write input tokens. */
  cacheWriteTokens: number
  /** Output tokens. */
  outputTokens: number
}

/** Automatic metrics folded from one session trace. */
export interface EvalCaseMetrics {
  /** Distinct turns carrying at least one closed step. */
  turns: number
  /** Closed `step/end` events, completed and failed alike. */
  steps: number
  /** Recorded `tool/call` events. */
  toolCalls: number
  /** Recorded `tool/result` events. */
  toolResults: number
  /** Results whose model-facing `isError` flag is false. */
  toolSuccess: number
  /** `toolSuccess / toolResults`, or null when no result landed. */
  toolSuccessRate: number | null
  /** Results carrying an internal failure identity (`tool/result.error`). */
  invalidToolCalls: number
  /** Durable `llm/retry` decisions. */
  retries: number
  /** Summed provider usage buckets. */
  tokens: EvalTokenUsage
  /** Sum of all four token buckets. */
  totalTokens: number
  /** Billed input (`input + cacheRead + cacheWrite`). */
  contextTokens: number
  /** Summed model wall time, `step/start` to `assistant/message`, milliseconds. */
  llmMs: number
  /** Summed tool wall time over matched `tool/call` to `tool/result`, milliseconds. */
  toolMs: number
  /** Summed first-token latency, `step/start` to the first token delta, milliseconds. */
  ttftMs: number
  /** Wall time from the first to the last recorded event, milliseconds. */
  latencyMs: number
  /** Estimated USD cost from the benchmark pricing table, or null without one. */
  costUsd: number | null
}

/** Outcome of one case x trial. */
export interface EvalTrialResult {
  /** Benchmark case id. */
  caseId: string
  /** 1-based trial index. */
  trial: number
  /** `completed` when a persisted trace was harvested and graded; `failed` when the trial ran but produced no usable outcome (timeout with a trace, corrupt trace); `error` when the child never produced a session log or the launch failed. */
  status: 'completed' | 'error' | 'failed'
  /** Human-readable failure detail for `error` trials. */
  error?: string
  /** Absolute path of the harvested primary session log. */
  tracePath?: string
  /** Absolute paths of every harvested session log, primary first. */
  tracePaths?: readonly string[]
  /** The child process's exit code, or null when it was killed. */
  exitCode: number | null
  /** Whether the trial hit its timeout and killed the child. */
  timedOut: boolean
  /** Folded metrics for `completed` trials. */
  metrics?: EvalCaseMetrics
  /** Scripted grading outcome for `completed` trials with expectations. */
  grade?: EvalGrade
  /** LLM-judge verdict for `completed` trials with a configured judge. */
  judge?: EvalJudgeVerdict
}

/** Scripted grading outcome for one trial. */
export interface EvalGrade {
  /** Whether the check command exited 0, or null when no check is configured. */
  taskSuccess: boolean | null
  /** Whether an expected tool was called, or null when no tool is configured. */
  toolSelectionAccuracy: boolean | null
}

/** LLM-judge verdict for one trial. */
export interface EvalJudgeVerdict {
  /** Final-answer score within the benchmark's `maxScore`, or null when the judge output was unusable. */
  finalAnswerScore: number | null
  /** Whether the judge flagged hallucinated content, or null when the judge output was unusable. */
  hallucination: boolean | null
  /** Judge rationale, when the model returned one. */
  rationale?: string
  /** Per-criterion pass/fail judgements, when the judge config has criteria. */
  criteria?: Array<{ label: string; pass: boolean; why?: string }>
}

/** Pooled grading rates over completed trials. */
export interface EvalRunGrading {
  /** Pooled task-success rate, or null when no trial carried a check. */
  taskSuccessRate: number | null
  /** Pooled tool-selection-accuracy rate, or null when no trial carried an expected tool. */
  toolSelectionAccuracyRate: number | null
  /** Mean final-answer score over judged trials, or null when nothing was judged. */
  finalAnswerScore: number | null
  /** Pooled hallucination rate over judged trials, or null when nothing was judged. */
  hallucinationRate: number | null
}

/** A persisted eval run. */
export interface EvalRun {
  /** Benchmark name. */
  benchmark: string
  /** Model id the benchmark targeted. */
  model: string
  /** Actual provider route used, persisted per run. */
  provider?: string
  /** Adapter-owned reasoning effort used, persisted per run when set. */
  reasoningEffort?: string
  /** Run creation time, epoch milliseconds. */
  createdAt: number
  /** Trials per case actually executed. */
  trials: number
  /** Benchmark seed. */
  seed: number
  /** Resolved pricing for the benchmark model, or null without one. */
  pricing: BenchmarkPricing | null
  /** The judge configuration the run used, when one was configured. */
  judge?: BenchmarkJudge
  /** Root holding every trial's workspace, overlay, and harvested trace. */
  tempRoot: string
  /** The split subset this run executed (`dev` or `guard`); present on benchmark runs, absent on imports. */
  split?: BenchmarkSplit
  /** Per-trial outcomes in execution order. */
  cases: readonly EvalTrialResult[]
  /** Mean/pooled metrics over completed trials, or null when none completed. */
  aggregate: EvalCaseMetrics | null
  /** Pooled scripted-grading rates over completed trials, or null when ungraded. */
  grading: EvalRunGrading | null
  /** `invalid` when a frozen benchmark drifted mid-run; `completed` otherwise. */
  status?: 'completed' | 'invalid'
  /** Semantic benchmark digest observed for this run. */
  benchmarkDigest?: string
  /** Per-case semantic hashes observed for this run. */
  caseHashes?: Readonly<Record<string, string>>
  /** Frozen snapshot verification evidence. */
  benchmarkSnapshot?: {
    frozen: boolean
    observedDigest: string
    verified: boolean
    mismatches: Array<{ path: string; expected?: string; observed?: string }>
  }
  /** True when the frozen benchmark drifted between snapshot and verification. */
  epochChanged?: boolean
  /** Sanitized run notes (e.g. frozen drift details). */
  notes?: string[]
}
