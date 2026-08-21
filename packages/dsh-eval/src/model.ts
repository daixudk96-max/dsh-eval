/**
 * Actual model-selection semantics for dsh-eval. Upstream uses `benchmark.model`
 * only for pricing/report; the spawned headless child instead reads the parent's
 * `agentDefaultModel.currentSelection()`. This bridge makes `benchmark.model`
 * actually configure the child and fixes the reporter-vs-actual discrepancy:
 *
 *   effective = { provider: benchmark.provider ?? parent currentSelection().provider,
 *                 model: benchmark.model }
 *
 * The model + provider settings snapshot is fixed once per run for
 * reproducibility. Judge defaults derive from the effective selection.
 *
 * @module dsh-eval/model
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Benchmark, BenchmarkJudge } from './types.ts'

/** The selected provider + model for one run. */
export interface ModelSelection {
  provider: string
  model: string
}

/** Narrow contract of rc.8 `agentDefaultModel` (public service, read-only). */
interface AgentDefaultModel {
  currentSelection(): { provider: string; model: string }
}

/** Resolve the effective provider/model for a run. */
export function resolveModelSelection(
  benchmark: Pick<Benchmark, 'model' | 'provider'>,
  agentDefaultModel: AgentDefaultModel,
): ModelSelection {
  const parent = agentDefaultModel.currentSelection()
  return {
    provider: benchmark.provider ?? parent.provider,
    model: benchmark.model,
  }
}

/**
 * Resolve the judge config from the benchmark, defaulting provider/model to the
 * effective selection (not a hardcoded `deepseek`).
 * @param benchmark - the loaded benchmark.
 * @param selection - the effective run selection.
 * @returns the effective judge config, or undefined when none configured.
 */
export function resolveJudge(
  benchmark: Pick<Benchmark, 'judge'>,
  selection: ModelSelection,
): BenchmarkJudge | undefined {
  const judge = benchmark.judge
  if (judge === undefined) return undefined
  return {
    provider: judge.provider === '' || judge.provider === 'deepseek' ? selection.provider : judge.provider,
    model: judge.model === undefined ? selection.model : judge.model,
    maxScore: judge.maxScore,
    ...(judge.rubric !== undefined ? { rubric: judge.rubric } : {}),
  }
}

/** Guard: read the optional agentDefaultModel service, or fail readably. */
export function getAgentDefaultModel(ctx: Context): AgentDefaultModel | undefined {
  return ctx.get('agentDefaultModel') as AgentDefaultModel | undefined
}
