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

/** The selected provider + model (+ optional reasoning effort) for one run. */
export interface ModelSelection {
  provider: string
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** Narrow contract of rc.8 `agentDefaultModel` (public service, read-only). */
interface AgentDefaultModel {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

/** The persistent eval-defaults settings namespace (written by the dsh-eval-defaults bundle settings page). */
export const EVAL_DEFAULTS_NS = 'eval-defaults'

/** Narrow shape of the saved eval defaults. */
export interface EvalDefaultsSettings {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** Narrow contract of rc.8 `settings` (read-only slice). */
interface SettingsService {
  get(ns: string): unknown
}

/**
 * Read the dsh-eval settings defaults (the `eval-defaults` namespace persisted
 * by the dsh-eval-defaults settings page), normalizing to strings. Absent or
 * empty fields mean "inherit".
 */
export function readEvalDefaults(settings: SettingsService | undefined): EvalDefaultsSettings {
  if (settings === undefined) return {}
  let raw: unknown
  try {
    raw = settings.get(EVAL_DEFAULTS_NS)
  } catch {
    return {}
  }
  if (raw === null || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    ...(norm(r.provider) ? { provider: norm(r.provider) } : {}),
    ...(norm(r.model) ? { model: norm(r.model) } : {}),
    ...(norm(r.reasoningEffort) ? { reasoningEffort: norm(r.reasoningEffort) } : {}),
  }
}

/** Resolve the effective provider/model/reasoning for a run. */
export function resolveModelSelection(
  benchmark: Pick<Benchmark, 'model' | 'provider' | 'reasoningEffort'>,
  agentDefaultModel: AgentDefaultModel,
  settings?: SettingsService,
): ModelSelection {
  const parent = agentDefaultModel.currentSelection()
  const evalDefaults = readEvalDefaults(settings)
  const selection: ModelSelection = {
    provider: benchmark.provider ?? evalDefaults.provider ?? parent.provider,
    model: benchmark.model ?? evalDefaults.model ?? parent.model,
  }
  const reasoningEffort = benchmark.reasoningEffort ?? evalDefaults.reasoningEffort ?? parent.reasoningEffort
  if (reasoningEffort !== undefined) selection.reasoningEffort = reasoningEffort
  return selection
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
    ...(judge.baseUrl !== undefined ? { baseUrl: judge.baseUrl } : {}),
    ...(judge.apiKeyEnv !== undefined ? { apiKeyEnv: judge.apiKeyEnv } : {}),
  }
}

/** Guard: read the optional agentDefaultModel service, or fail readably. */
export function getAgentDefaultModel(ctx: Context): AgentDefaultModel | undefined {
  return ctx.get('agentDefaultModel') as AgentDefaultModel | undefined
}
