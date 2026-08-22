/**
 * Benchmark runner for dsh-eval: one fresh subprocess per case x trial.
 *
 * Each trial owns a private temp directory with a copied workspace, an
 * isolated DSH_HOME, and a patch overlay that forces plain-JSONL persistence
 * and non-interactive workspace-scoped permissions. The spawned command is
 * the same trusted dsh harness (credentials flow through deliberately: the
 * child must reach the real model API, and the session log never stores
 * them), so the defensive scrubbed-env rule's leak concern does not apply to
 * this child. Timeout kills the direct child and reports timed-out orthogonally
 * from its exit code; Windows descendants of a killed process may survive.
 *
 * Fail-closed contract (absorbed from timwhitez/dsh-self-evolving's
 * FAIL-CLOSED + infra-allowlist retry rules): a trial that produced no usable
 * outcome is never counted as success. Missing session logs are `error`
 * trials; a timed-out child or an unreadable/corrupt trace is `failed`; only
 * infrastructure-class failures on the allowlist (rate limits, overload,
 * connection resets) are retried, at most INFRA_MAX_ATTEMPTS spawns.
 *
 * @module dsh-eval/runner
 */

import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dump as serializeYaml } from 'js-yaml'
import type { Benchmark, BenchmarkSplit, EvalRun, EvalTrialResult } from './types.ts'
import type { EvalGrade, EvalRunGrading } from './types.ts'
import { tryJudgeTrial, type JudgeChat } from './judge.ts'
import { aggregateMetrics, computeMetrics } from './metrics.ts'
import { findSessionLogs, loadTrace, mergeTraces } from './trace.ts'

/** Cap per-stream child output so a runaway trial cannot exhaust memory. */
const MAX_OUTPUT_BYTES = 512 * 1024

/**
 * Infrastructure failures worth retrying once the harness reports them in the
 * child's stderr tail: transient model-provider conditions, never task
 * outcomes. Anything else fails closed on the first attempt.
 */
const INFRA_RETRYABLE = ['RATE_LIMITED', 'OVERLOADED', 'CONNECTION_RESET'] as const

/** Maximum spawn attempts per trial: the initial run plus two retries. */
const INFRA_MAX_ATTEMPTS = 3

/** Whether a child diagnostic text matches an allowlisted infra failure. */
function isInfraRetryable(diagnosticText: string): boolean {
  return INFRA_RETRYABLE.some(token => diagnosticText.includes(token))
}

/** Runtime overrides applied to a loaded benchmark. */
export interface RunOptions {
  /** Override the benchmark's dsh command argv. */
  command?: readonly string[]
  /** Override the benchmark's spawned profile. */
  profile?: string
  /** Override the benchmark's trials per case. */
  trials?: number
  /** Run only this case subset; omitted keeps every loaded case. */
  split?: BenchmarkSplit
  /** Root for trial directories; defaults to the platform temp dir. */
  tempRoot?: string
  /** LLM-judge chat seam; required when the benchmark configures a judge. */
  judgeChat?: JudgeChat
  /** Effective provider/model/reasoning written into each child's minimal settings.yaml. */
  selection?: { provider: string; model: string; reasoningEffort?: string }
  /** Extra child settings subtrees (e.g. the selected provider's config). */
  childSettings?: Record<string, unknown>
  /** Resolve the credential value afresh before each trial spawn. */
  resolveCredential?: (() => Promise<string | undefined>) | undefined
  /** The credential ref to add to the child env, if named. */
  credentialRef?: string | undefined
}

/** One child process's orthogonal outcome facts. */
interface SpawnOutcome {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
}

/** The child's trailing diagnostic for failed harvests. */
function diagnostic(outcome: SpawnOutcome): string {
  const tail = outcome.stderr.slice(-2000)
  const status = outcome.timedOut ? 'timed out' : `exited with code ${String(outcome.exitCode)}`
  return tail === '' ? `no session log found; dsh ${status}` : `no session log found; dsh ${status}: ${tail}`
}

/** Human-readable error text. */
function message(error: unknown): string {
  /* v8 ignore next 3 -- every call site passes a node:fs or spawn Error; a non-Error rejection is impossible through the public API. */
  return error instanceof Error ? error.message : String(error)
}

/** Reduce a case id to one safe temp-directory segment. */
function sanitizeSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/gu, '-').replace(/^-+|-+$/gu, '')
  return safe === '' ? 'case' : safe
}

/**
 * Build the per-trial overlay: plain-JSONL persistence, non-interactive
 * permissions, and the keyless replay plugin when recorded logs exist.
 * @param replay - the replay primary log and child logs, or undefined.
 * @returns the overlay YAML text.
 */
function evalOverlay(replay: { file: string; childFiles: readonly string[] } | undefined): string {
  const lines = [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    packChunks: false',
    '    compression: none',
    '- id: sandbox-policy',
    '  config:',
    '    mode: workspace-write',
    '    workspaceRoot: !!js process.cwd()',
    '- id: approval',
    '  config:',
    '    policy: never',
    // rc.8 dsh-permission-presets requires an explicit defaultPreset when the
    // composed sandbox+approval match no shipped preset. Eval runs headless
    // with workspace-write + never-approval, so declare that preset explicitly.
    '- id: permission',
    '  config:',
    '    defaultPreset: eval',
    '    presets:',
    '      eval:',
    '        sandbox: workspace-write',
    '        approval: never',
  ]
  if (replay !== undefined) {
    lines.push(
      '- id: llm-replay',
      "  name: '@deepseek-ai/dsh-llm-replay'",
      '  config:',
      `    file: ${JSON.stringify(replay.file)}`,
      ...(replay.childFiles.length === 0 ? [] : [`    childFiles: ${JSON.stringify(replay.childFiles)}`]),
    )
  }
  return `${lines.join('\n')}\n`
}

/**
 * Split a single command string into argv on whitespace while preserving
 * double- and single-quoted groups (so executable paths with spaces, e.g.
 * `C:\Program Files\nodejs\node.exe`, survive unbroken on Windows).
 */
function splitWords(value: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const ch of value.trim()) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/u.test(ch)) {
      if (current !== '') { words.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current !== '') words.push(current)
  return words
}

/**
 * Grade one trial against its expectations: the expected tool is matched
 * against recorded tool-call names, and the check command runs in the trial
 * workspace with the same timeout as the agent. A spawn failure or timeout
 * reads as task failure, never as an aborted run.
 * @param caseValue - the case being graded.
 * @param trace - the harvested trace.
 * @param workspace - the trial's workspace, where the check runs.
 * @param timeoutMs - check timeout, matching the trial timeout.
 * @returns the grading outcome; unconfigured fields stay null.
 */
async function gradeTrial(
  caseValue: Benchmark['cases'][number],
  trace: Awaited<ReturnType<typeof loadTrace>>,
  workspace: string,
  timeoutMs: number,
): Promise<EvalGrade> {
  const expected = caseValue.expected
  if (expected === undefined) return { taskSuccess: null, toolSelectionAccuracy: null }
  const expectedTool = expected.tool
  const toolSelectionAccuracy = expectedTool === undefined
    ? null
    : trace.events.some(event => event.type === 'tool/call' && event.data.name.includes(expectedTool))
  let taskSuccess: boolean | null = null
  if (expected.check !== undefined) {
    try {
      const outcome = await runCommand(splitWords(expected.check), [], workspace, { ...process.env }, timeoutMs)
      taskSuccess = !outcome.timedOut && outcome.exitCode === 0
    } catch {
      taskSuccess = false
    }
  }
  return { taskSuccess, toolSelectionAccuracy }
}

/** Pool one nullable boolean across graded trials into a rate, or null. */
function pooledRate(items: readonly EvalTrialResult[], select: (grade: EvalGrade | undefined) => boolean | null): number | null {
  const values = items
    .map(result => select(result.grade))
    .filter((value): value is boolean => value !== null)
  return values.length === 0 ? null : values.filter(value => value).length / values.length
}

/** Reduce completed trials' grades into pooled run-level rates. */
function gradingOf(results: readonly EvalTrialResult[]): EvalRunGrading | null {
  const taskSuccessRate = pooledRate(results, grade => grade?.taskSuccess ?? null)
  const toolSelectionAccuracyRate = pooledRate(results, grade => grade?.toolSelectionAccuracy ?? null)
  const finalScores = results
    .map(result => result.judge?.finalAnswerScore ?? null)
    .filter((value): value is number => value !== null)
  const finalAnswerScore = finalScores.length === 0
    ? null
    : finalScores.reduce((total, value) => total + value, 0) / finalScores.length
  const hallucinated = results
    .map(result => result.judge?.hallucination ?? null)
    .filter((value): value is boolean => value !== null)
  const hallucinationRate = hallucinated.length === 0
    ? null
    : hallucinated.filter(value => value).length / hallucinated.length
  return taskSuccessRate === null && toolSelectionAccuracyRate === null
      && finalAnswerScore === null && hallucinationRate === null
    ? null
    : { taskSuccessRate, toolSelectionAccuracyRate, finalAnswerScore, hallucinationRate }
}

/**
 * Spawn one command and collect its output, enforcing the timeout with a
 * direct kill. The four outcome facts (exit code, timeout, stdout, stderr)
 * are reported independently so a trapped or killed child cannot read as a
 * clean success.
 * @param command - the executable and its fixed argv.
 * @param args - invocation args appended after `command`.
 * @param cwd - the child's working directory.
 * @param env - the child's environment.
 * @param timeoutMs - kill the child after this many milliseconds.
 * @returns the orthogonal outcome facts.
 */
function runCommand(
  command: readonly string[],
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<SpawnOutcome> {
  const executable = command[0]
  if (executable === undefined) {
    return Promise.reject(new Error('eval: dsh command must not be empty'))
  }
  return new Promise((resolveOutcome, reject) => {
    const child = spawn(executable, [...command.slice(1), ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const cap = (current: string, chunk: Buffer): string => (
      current.length >= MAX_OUTPUT_BYTES
        ? current
        : current + chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - current.length)
    )
    child.stdout.on('data', (chunk: Buffer) => { stdout = cap(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = cap(stderr, chunk) })
    const timer = setTimeout(() => {
      /* v8 ignore next 3 -- close clears the timer; only a same-tick close/kill race reaches here. */
      if (settled) return
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      /* v8 ignore next 3 -- spawn emits one error before close; the guard covers only an impossible duplicate error event. */
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      resolveOutcome({ exitCode: code, timedOut, stdout, stderr })
    })
  })
}

/**
 * Run one case x trial in its private temp directory and harvest its trace.
 * Retries infra-class failures (see isInfraRetryable) up to INFRA_MAX_ATTEMPTS
 * spawns; each retry gets a fresh trial directory so partial state never
 * contaminates the next attempt.
 * @param benchmark - the loaded benchmark.
 * @param caseValue - the case to run.
 * @param trial - 1-based trial index.
 * @param root - this run's temp root.
 * @param options - runtime overrides (launcher, settings, credential bridge).
 * @returns the trial result; a failed subprocess with no log is an `error`
 *   trial, a timeout or unreadable trace is `failed`.
 */
async function runCaseTrial(
  benchmark: Benchmark,
  caseValue: Benchmark['cases'][number],
  trial: number,
  root: string,
  options: RunOptions,
): Promise<EvalTrialResult> {
  for (let attempt = 1; attempt <= INFRA_MAX_ATTEMPTS; attempt++) {
    const result = await runCaseTrialOnce(benchmark, caseValue, trial, root, options, attempt)
    const infraRetryable = result.status === 'error' && isInfraRetryable(result.error ?? '')
    if (!infraRetryable || attempt >= INFRA_MAX_ATTEMPTS) return result
  }
  /* v8 ignore next 2 -- the loop always returns on its last attempt. */
  throw new Error('unreachable')
}

/**
 * One spawn attempt of a case x trial.
 * @param attempt - 1-based attempt index; retries get a `-r<n>` directory suffix.
 */
async function runCaseTrialOnce(
  benchmark: Benchmark,
  caseValue: Benchmark['cases'][number],
  trial: number,
  root: string,
  options: RunOptions,
  attempt: number,
): Promise<EvalTrialResult> {
  const judgeChat = options.judgeChat
  const retrySuffix = attempt > 1 ? `-r${attempt - 1}` : ''
  const trialDir = join(root, `${sanitizeSegment(caseValue.id)}-${trial}${retrySuffix}`)
  const workspace = join(trialDir, 'workspace')
  const dshHome = join(trialDir, 'dsh-home')
  await mkdir(workspace, { recursive: true })
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  if (caseValue.workspace !== undefined) await cp(caseValue.workspace, workspace, { recursive: true })
  // Write the minimal child settings (agent-default-model + provider subtree).
  if (options.selection !== undefined) {
    const child = {
      'agent-default-model': {
        provider: options.selection.provider,
        model: options.selection.model,
        ...(options.selection.reasoningEffort !== undefined
          ? { reasoningEffort: options.selection.reasoningEffort }
          : {}),
      },
      ...(options.childSettings ?? {}),
    }
    await writeFile(join(dshHome, 'settings.yaml'), `${serializeYaml(child)}\n`, 'utf8')
  }
  const replayFixture = benchmark.replay === undefined
    ? undefined
    : join(benchmark.replay.dir, `${sanitizeSegment(caseValue.id)}-${trial}`)
  let replay: { file: string; childFiles: string[] } | undefined
  if (replayFixture !== undefined) {
    const logs = await findSessionLogs(replayFixture)
    if (logs.length === 0) {
      return {
        caseId: caseValue.id,
        trial,
        status: 'error',
        error: `no replay fixture found at ${replayFixture}`,
        exitCode: null,
        timedOut: false,
      }
    }
    const primary = logs[0]!
    replay = { file: primary, childFiles: logs.slice(1) }
  }
  const overlayPath = join(trialDir, 'eval.cordis.yml')
  await writeFile(overlayPath, evalOverlay(replay), 'utf8')
  // Resolve the credential value afresh before this spawn (never cached per run).
  const credentialValue = options.resolveCredential === undefined
    ? undefined
    : await options.resolveCredential()
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: dshHome }
  if (options.credentialRef !== undefined && credentialValue !== undefined) {
    env[options.credentialRef] = credentialValue
  } else if (options.credentialRef !== undefined && options.resolveCredential !== undefined) {
    throw new Error(
      `eval: credential ref "${options.credentialRef}" could not be resolved for provider "${options.selection?.provider ?? 'unknown'}"`,
    )
  }
  let outcome: SpawnOutcome
  try {
    outcome = await runCommand(
      benchmark.command,
      ['--profile', benchmark.profile, '--patch', overlayPath, caseValue.prompt],
      workspace,
      env,
      benchmark.timeoutMs,
    )
  } catch (error) {
    return {
      caseId: caseValue.id,
      trial,
      status: 'error',
      error: `failed to spawn dsh: ${message(error)}`,
      exitCode: null,
      timedOut: false,
    }
  }
  const tracePaths = await findSessionLogs(dshHome)
  if (tracePaths.length === 0) {
    return {
      caseId: caseValue.id,
      trial,
      status: 'error',
      error: diagnostic(outcome),
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
    }
  }
  try {
    const loaded: { path: string; trace: Awaited<ReturnType<typeof loadTrace>> }[] = []
    for (const path of tracePaths) loaded.push({ path, trace: await loadTrace(path) })
    loaded.sort((a, b) => a.trace.createdAt - b.trace.createdAt)
    // tracePaths.length > 0 above guarantees a non-empty loaded list.
    const primaryPath = loaded[0]!.path
    const trace = mergeTraces(loaded.map(entry => entry.trace))
    const pricing = benchmark.pricing?.[benchmark.model]
    const metrics = computeMetrics(trace.events, pricing)
    const grade = await gradeTrial(caseValue, trace, workspace, benchmark.timeoutMs)
    const judge = benchmark.judge === undefined || judgeChat === undefined
      ? undefined
      : await tryJudgeTrial(caseValue, trace, benchmark.judge, judgeChat)
    // Fail-closed: a trace that exists but was cut short by the timeout is a
    // failed trial, never a completed one — the task did not finish.
    const status = outcome.timedOut ? 'failed' : 'completed'
    return {
      caseId: caseValue.id,
      trial,
      status,
      tracePath: primaryPath,
      tracePaths: loaded.map(entry => entry.path),
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      metrics,
      ...(grade.taskSuccess !== null || grade.toolSelectionAccuracy !== null ? { grade } : {}),
      ...(judge !== undefined ? { judge } : {}),
    }
  } catch (error) {
    return {
      caseId: caseValue.id,
      trial,
      status: 'failed',
      error: `failed to read trace: ${message(error)}`,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
    }
  }
}

/**
 * Run every case x trial sequentially and aggregate the completed trials.
 * @param benchmark - the loaded benchmark.
 * @param options - runtime overrides and test seams.
 * @returns the completed run record, written by the caller.
 */
export async function runBenchmark(benchmark: Benchmark, options: RunOptions = {}): Promise<EvalRun> {
  if (benchmark.judge !== undefined && options.judgeChat === undefined) {
    throw new Error('eval: benchmark configures a judge but no LLM chat seam is available')
  }
  if (benchmark.judge !== undefined && benchmark.replay !== undefined) {
    throw new Error('eval: judge and replay cannot be combined in one run')
  }
  const root = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'dsh-eval-'))
  const trials = options.trials ?? benchmark.trials
  const effective: Benchmark = {
    ...benchmark,
    ...(options.profile !== undefined ? { profile: options.profile } : {}),
    ...(options.command !== undefined ? { command: options.command } : {}),
  }
  const results: EvalTrialResult[] = []
  for (const caseValue of effective.cases) {
    for (let trial = 1; trial <= trials; trial++) {
      results.push(await runCaseTrial(effective, caseValue, trial, root, options))
    }
  }
  const completed = results.filter(
    (result): result is EvalTrialResult & { metrics: NonNullable<EvalTrialResult['metrics']> } =>
      result.status === 'completed' && result.metrics !== undefined,
  )
  return {
    benchmark: benchmark.name,
    model: benchmark.model,
    ...(options.selection !== undefined ? { provider: options.selection.provider } : {}),
    ...(options.selection?.reasoningEffort !== undefined
      ? { reasoningEffort: options.selection.reasoningEffort }
      : {}),
    createdAt: Date.now(),
    trials,
    seed: benchmark.seed,
    pricing: benchmark.pricing?.[benchmark.model] ?? null,
    ...(benchmark.judge !== undefined ? { judge: benchmark.judge } : {}),
    tempRoot: root,
    split: options.split ?? 'dev',
    cases: results,
    aggregate: aggregateMetrics(completed.map(result => result.metrics)),
    grading: gradingOf(completed),
  }
}
