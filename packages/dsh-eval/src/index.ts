/**
 * dsh-eval 鈥?agent evaluation over headless dsh profiles.
 *
 * The eval bundle mounts this command-line plugin over dsh-base. It parses
 * `dsh --profile eval run <benchmark.yaml>` / `report <run.json>`, spawns one
 * headless dsh subprocess per case x trial, harvests each persisted session
 * log as a trace, folds automatic metrics, scripted grading (task success,
 * tool-selection accuracy), and cross-run comparison, and writes a JSON run
 * report. LLM-judge metrics (final-answer score, hallucination) and paired
 * same-seed trials are deferred to later milestones.
 *
 * @module dsh-eval
 */

import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { loadBenchmark } from './benchmark.ts'
import { applyEval, type EvalStartupValues } from './command.ts'
import { compareRuns, renderCompareMarkdown, renderDecisionDelta } from './compare.ts'
import { importTraceFile } from './import.ts'
import { llmJudgeChat, createHttpJudgeChat, resolveJudgeApiKey, type JudgeChat } from './judge.ts'
import { renderMarkdownReport, writeRunReport, loadRunReport } from './report.ts'
import { runBenchmark } from './runner.ts'
import { resolveLauncher } from './launcher.ts'
import { resolveModelSelection, resolveJudge } from './model.ts'
import { findConfigurable, extractProviderSubtree, buildChildSettings } from './settings-bridge.ts'
import { discoverCredentialRef, resolveCredentialValue } from './credential-bridge.ts'

/** Stable Cordis plugin name. */
export const name = 'eval'
/** The launcher-provided command line is the only required service. */
export const inject = ['cmdlineArgs']

/** Process-facing output streams; tests substitute captures. */
export interface EvalIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
}

/** The process streams the eval app writes to; tests substitute captures. */
export const internals: EvalIo = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/**
 * Resolve the production judge chat seam from the mounted llm service, or
 * undefined when the composition carries no llm service.
 * @param ctx - the plugin context.
 * @returns a chat seam over the llm stream, or undefined without llm.
 */
export function resolveJudgeChat(ctx: Context): JudgeChat | undefined {
  const llm = ctx.get('llm')
  // bind: dsh-llm's stream() is a method that reads `this` (ctx/waterfall);
  // passing the bare reference loses the receiver.
  return llm === undefined ? undefined : llmJudgeChat(llm.stream.bind(llm))
}

/** Aggregate-success sentence for the run summary line. */
function summary(run: Awaited<ReturnType<typeof runBenchmark>>): string {
  const aggregate = run.aggregate
  if (aggregate === null) return 'no completed trials'
  const rate = aggregate.toolSuccessRate === null ? 'n/a' : `${(aggregate.toolSuccessRate * 100).toFixed(1)}%`
  const taskRate = run.grading?.taskSuccessRate
  const task = taskRate === null || taskRate === undefined
    ? ''
    : `, task success ${(taskRate * 100).toFixed(1)}%`
  const judgeScore = run.grading?.finalAnswerScore
  const score = judgeScore === null || judgeScore === undefined
    ? ''
    : `, judge score ${judgeScore.toFixed(1)}`
  return `tool success ${rate}${task}${score}, ${aggregate.steps.toFixed(1)} steps/trial`
}

/**
 * Runtime seams the eval app consumes from the mounted plugin tree (read-only).
 * These are narrow structural views over rc.8 public services; worker code reads
 * only leaf fields it needs and never dumps whole live objects.
 */
export interface EvalServices {
  judgeChat?: JudgeChat | undefined
  /** rc.8 `agentDefaultModel` service for default provider selection. */
  agentDefaultModel?: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } } | undefined
  /** rc.8 `llm` service for provider live/configurable checks. */
  llm?: {
    listProviders(): readonly (string | { id: string })[]
    listConfigurableProviders(): readonly { provider: string; settingsNs: string; settingsPath: readonly string[] }[]
  } | undefined
  /** rc.8 `settings` service for provider subtree extraction + eval-defaults. */
  settings?: {
    describe(options: { redactSecrets: boolean }): readonly { ns: string; value: unknown; user?: unknown }[]
    get(ns: string): unknown
  } | undefined
  /** rc.8 `credentials` service for per-trial credential resolution. */
  credentials?: {
    resolve(ref: string): Promise<string | { value?: string; source?: string } | undefined>
  } | undefined
  /** The current process (for launcher resolution); tests substitute a fixture. */
  processRef?: { execPath: string; argv: readonly string[] }
}

/**
 * Execute one eval invocation to completion.
 * @param values - the resolved command-line invocation.
 * @param io - output streams for the report and diagnostics.
 * @param services - injected runtime seams.
 * @returns the process exit code; nonzero for any failure or a run with no
 *   completed trials.
 */
export async function executeEval(
  values: EvalStartupValues,
  io: EvalIo,
  services: EvalServices = {},
): Promise<number> {
  try {
    if (values.kind === 'import') {
      const run = await importTraceFile(values.format, values.path, values.caseId)
      await writeRunReport(run, values.outPath)
      io.stdout.write(`Wrote ${values.outPath} (1 imported trial, ${summary(run)})\n`)
      return 0
    }
    if (values.kind === 'report') {
      const run = await loadRunReport(values.runPath)
      io.stdout.write(renderMarkdownReport(run))
      return 0
    }
    if (values.kind === 'compare') {
      const a = await loadRunReport(values.runPathA)
      const b = await loadRunReport(values.runPathB)
      if (values.delta) {
        io.stdout.write(renderDecisionDelta(a, b))
      } else {
        io.stdout.write(renderCompareMarkdown(compareRuns(a, b)))
      }
      return 0
    }
    const benchmark = await loadBenchmark(values.benchmarkPath, {}, values.split)
    // Resolve the effective launcher: CLI override > benchmark command >
    // current running DSH CLI (argv default, no PATH dependency).
    const launcher = resolveLauncher(values.dshCommand, benchmark.command, services.processRef ?? process)
    if (!launcher.validated) {
      io.stderr.write(`${launcher.reason ?? 'eval: no launcher resolved'}\n`)
      return 1
    }
    const runOptions: {
      trials?: number
      split?: 'dev' | 'guard'
      profile?: string
      judgeChat?: JudgeChat
      selection?: { provider: string; model: string; reasoningEffort?: string }
      childSettings?: Record<string, unknown>
      credentialRef?: string
      resolveCredential?: () => Promise<string | undefined>
    } = {
      ...(values.trials !== undefined ? { trials: values.trials } : {}),
      ...(values.split !== undefined ? { split: values.split } : {}),
      ...(values.profile !== undefined ? { profile: values.profile } : {}),
      ...(services.judgeChat !== undefined ? { judgeChat: services.judgeChat } : {}),
    }
    // Wire the model/settings/credential bridges when the services are present
    // (report/compare/import must not require them). The bridge only applies to
    // the DEFAULT real-headless child (launcher fell back to the current DSH
    // CLI): when the user supplies an explicit `command` (CLI --dsh override or
    // benchmark YAML `command`), they own the child launch and the provider is
    // the user's own (e.g. a fake/spawned executable in an offline run), so the
    // child settings/credential bridge must not run or fail.
    const hasExplicitCommand = (values.dshCommand?.length ?? 0) > 0 || (benchmark.command?.length ?? 0) > 0
    let effectiveBenchmark = benchmark
    if (services.agentDefaultModel !== undefined && !hasExplicitCommand) {
      const selection = resolveModelSelection(benchmark, services.agentDefaultModel, services.settings)
      runOptions.selection = selection
      // Normalise the judge against the effective selection (M-3).
      if (benchmark.judge !== undefined) {
        effectiveBenchmark = { ...benchmark, judge: resolveJudge(benchmark, selection)! }
      }
      if (services.llm !== undefined && services.settings !== undefined) {
        const configurable = findConfigurable(selection, services.llm)
        const subtree = extractProviderSubtree(configurable, selection, services.settings)
        if (!subtree.bridgeable) {
          io.stderr.write(`${subtree.reason ?? 'eval: provider settings not bridgeable'}\n`)
          return 1
        }
        runOptions.childSettings = buildChildSettings(selection, subtree) as Record<string, unknown>
        if (services.credentials !== undefined) {
          const ref = discoverCredentialRef(selection.provider, subtree.value)
          if (ref !== undefined) {
            runOptions.credentialRef = ref
            const credentials = services.credentials
            runOptions.resolveCredential = () => resolveCredentialValue(ref, credentials)
          }
        }
      }
    }
    // Judge HTTP fallback: when the composition carries no `llm` service but
    // the benchmark names a judge baseUrl, run the judge over a direct
    // OpenAI-compatible call instead of failing with "no chat seam".
    const configuredJudge = effectiveBenchmark.judge
    if (runOptions.judgeChat === undefined && configuredJudge !== undefined && configuredJudge.baseUrl !== undefined) {
      const apiKeyEnv = configuredJudge.apiKeyEnv ?? 'CLIPA_API_KEY'
      const apiKey = resolveJudgeApiKey(apiKeyEnv, homedir())
      if (apiKey === undefined) {
        io.stderr.write(`eval: judge baseUrl configured but no api key for "${apiKeyEnv}" (env or ~/.dsh/.credentials.yaml)\n`)
        return 1
      }
      runOptions.judgeChat = createHttpJudgeChat({ baseUrl: configuredJudge.baseUrl, apiKey, model: configuredJudge.model })
    }
    const run = await runBenchmark(effectiveBenchmark, { ...runOptions, command: launcher.argv })
    await writeRunReport(run, values.outPath)
    io.stdout.write(`Wrote ${values.outPath} (${run.cases.length} trials, ${summary(run)})\n`)
    return run.aggregate === null ? 1 : 0
  } catch (error) {
    io.stderr.write(`dsh eval: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

/**
 * Mount the eval command-line app: parse the invocation, run it asynchronously,
 * and request launcher exit with the result code. `runEval` returns undefined
 * when the command line already handled termination internally (help/parse
 * error), in which case the launcher exit callback must NOT be fired again.
 * @param ctx - plugin context carrying the command line and launcher exit.
 */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('eval: the launcher must provide ctx.appExit before the tree mounts')
  void runEval(ctx).then(code => {
    if (code !== undefined) {
      exit(code)
      // The launcher's bounded shutdown disposes the tree and then lets the
      // event loop drain naturally. The launcher's post-boot HMR/config file
      // watchers are not owned by the tree, so a finished one-shot eval can be
      // left with the loop alive and no pending exit. Once disposal has
      // completed (process.exitCode set), force the process exit ourselves;
      // if disposal is still in flight, the launcher's own force-exit timeout
      // still terminates the process.
      setTimeout(() => {
        if (process.exitCode !== undefined) process.exit(process.exitCode)
      }, 1500)
    }
  })
}

/**
 * Run the eval invocation: settle the loader first so the DSH plugin tree is
 * fully mounted, then dispatch report/compare/import/run. Returns undefined
 * when `applyEval` found no executable invocation (help/parse error already
 * terminated via the command line).
 * @param ctx - plugin context.
 * @returns the process exit code, or undefined when the CLI already exited.
 */
export async function runEval(ctx: Context): Promise<number | undefined> {
  try {
    // Loader settlement before reading services (aligns with headless/app-boot).
    await ctx.get('loader')?.await()
    const values = applyEval(ctx)
    if (values === undefined) return undefined
    const judgeChat = resolveJudgeChat(ctx)
    return executeEval(values, internals, {
      judgeChat,
      agentDefaultModel: ctx.get('agentDefaultModel') as EvalServices['agentDefaultModel'],
      llm: ctx.get('llm') as EvalServices['llm'],
      settings: ctx.get('settings') as EvalServices['settings'],
      credentials: ctx.get('credentials') as EvalServices['credentials'],
    })
  } catch (error) {
    internals.stderr.write(`dsh eval: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
