/**
 * The eval app's commander program: `run <benchmark.yaml>` executes a
 * benchmark and writes its JSON report; `report <run.json>` renders one as
 * markdown. Parsing follows the cmdline contract: the action publishes an
 * ordinary service, and help or a rejection publishes nothing.
 *
 * @module dsh-eval/command
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { BenchmarkSplit } from './types.ts'
import type { ImportFormat } from './import.ts'

/** What the eval app resolved from its command line. */
export type EvalStartupValues =
  | {
    kind: 'run'
    benchmarkPath: string
    outPath: string
    trials?: number
    split?: BenchmarkSplit
    dshCommand?: readonly string[]
    profile?: string
  }
  | {
    kind: 'report'
    runPath: string
  }
  | {
    kind: 'compare'
    runPathA: string
    runPathB: string
    delta?: boolean
  }
  | {
    kind: 'import'
    format: ImportFormat
    path: string
    outPath: string
    caseId: string
  }

/** Options accepted by `eval run`. */
interface RunCommandOptions {
  out: string
  trials?: number
  split?: BenchmarkSplit
  dsh?: string[]
  profile?: string
}

/** Options accepted by `eval import`. */
interface ImportCommandOptions {
  out: string
  caseId: string
}

/**
 * Build a fresh eval commander program. The root action rejects a bare
 * invocation; the `run` and `report` actions hand the resolved values to the
 * publish callback. The callback, not a Cordis service, carries the values
 * because the plugin's own fiber is not yet active when the parse action runs
 * and a strict `ctx.get` would miss a just-provided service.
 * @param publish - receives the resolved invocation once a subcommand runs.
 * @returns the configured program.
 */
export function evalCommand(publish: (values: EvalStartupValues) => void): Command {
  const program = new Command()
    .name('dsh --profile eval')
    .description('Run agent evaluations over headless dsh profiles and report trace-based metrics.')
    .helpOption('-h, --help', 'show this help')
    .action(() => {
      program.error('error: eval needs a subcommand: run <benchmark.yaml> or report <run.json>')
    })
  const run = program.command('run').description('run a benchmark and write its JSON report')
  run
    .argument('<benchmark.yaml>', 'path to the benchmark document')
    .option('--out <path>', 'output run JSON path', 'eval-run.json')
    .option('--trials <n>', 'override the benchmark trials count', (value) => {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0) program.error('error: --trials must be a positive integer')
      return parsed
    })
    .option('--split <dev|guard>', 'run only the dev or guard case subset (default dev)', (value) => {
      if (value !== 'dev' && value !== 'guard') {
        program.error('error: --split must be dev or guard')
        return undefined
      }
      return value
    })
    .option('--dsh <argv...>', 'override the dsh launcher argv (argv-safe, preserves quoting)')
    .option('--profile <name>', 'override the spawned dsh profile')
    .action((benchmarkPath: string, options: RunCommandOptions) => {
      const dshCommand = options.dsh
      publish({
        kind: 'run',
        benchmarkPath,
        outPath: options.out,
        ...(options.trials !== undefined ? { trials: options.trials } : {}),
        ...(options.split !== undefined ? { split: options.split } : {}),
        ...(dshCommand !== undefined && dshCommand.length > 0 ? { dshCommand } : {}),
        ...(options.profile !== undefined ? { profile: options.profile } : {}),
      })
    })
  const report = program.command('report').description('render a persisted run JSON as markdown')
  report
    .argument('<run.json>', 'path to a run report')
    .action((runPath: string) => {
      publish({ kind: 'report', runPath })
    })
  const compare = program.command('compare').description('compare two persisted run reports as a markdown table')
  compare
    .argument('<run-a.json>', 'baseline run report')
    .argument('<run-b.json>', 'candidate run report')
    .option('--delta', 'emit a per-case before→after decision delta table')
    .action((runPathA: string, runPathB: string, options: { delta?: boolean }) => {
      publish({ kind: 'compare', runPathA, runPathB, ...(options.delta ? { delta: true } : {}) })
    })
  const importer = program.command('import').description('import an external harness session log as a run report')
  importer
    .argument('<format>', 'session format: codex, claude-code, or dsh (native session.jsonl or .zstd)')
    .argument('<session.jsonl>', 'path to the session log (plain JSONL or .zstd for dsh)')
    .option('--out <path>', 'output run JSON path', 'imported-run.json')
    .option('--case-id <id>', 'case id for the imported trial', 'imported')
    .action((format: string, path: string, options: ImportCommandOptions) => {
      if (format !== 'codex' && format !== 'claude-code' && format !== 'dsh') {
        program.error('error: import format must be codex, claude-code, or dsh')
        return
      }
      publish({ kind: 'import', format, path, outPath: options.out, caseId: options.caseId })
    })
  return program
}

/**
 * Parse the launcher's inner arguments with the eval program and return what
 * the invoked command published.
 * @param ctx - plugin context carrying `cmdlineArgs` and `appExit`.
 * @returns the resolved invocation, or undefined when help or an error exited.
 */
export function applyEval(ctx: Context): EvalStartupValues | undefined {
  let resolved: EvalStartupValues | undefined
  const program = evalCommand((values) => { resolved = values })
  parseCmdline(ctx, program)
  return resolved
}
