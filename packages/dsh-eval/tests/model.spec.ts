import { describe, expect, it } from 'vitest'
import { readEvalDefaults, resolveModelSelection, resolveJudge, EVAL_DEFAULTS_NS } from '../src/model.ts'
import type { Benchmark, BenchmarkJudge } from '../src/types.ts'

const agentDefaultModel = {
  currentSelection: () => ({ provider: 'main-provider', model: 'main-model', reasoningEffort: 'medium' }),
}

function settingsWith(evalDefaults: unknown) {
  return {
    get: (ns: string) => (ns === EVAL_DEFAULTS_NS ? evalDefaults : undefined),
  }
}

describe('dsh-eval model selection inheritance', () => {
  it('prefers benchmark fields over eval-defaults and the main default', () => {
    const benchmark = {
      model: 'bench-model',
      provider: 'bench-provider',
      reasoningEffort: 'high',
    } as unknown as Pick<Benchmark, 'model' | 'provider' | 'reasoningEffort'>
    const selection = resolveModelSelection(benchmark, agentDefaultModel, settingsWith({ provider: 'eval-provider', model: 'eval-model', reasoningEffort: 'low' }))
    expect(selection).toEqual({ provider: 'bench-provider', model: 'bench-model', reasoningEffort: 'high' })
  })

  it('falls back to the eval-defaults settings namespace (frontend saved defaults)', () => {
    const b = { model: 'bench-model' } as unknown as Pick<Benchmark, 'model' | 'provider' | 'reasoningEffort'>
    const selection = resolveModelSelection(b, agentDefaultModel, settingsWith({ provider: 'eval-provider', model: 'eval-model', reasoningEffort: 'low' }))
    expect(selection).toEqual({ provider: 'eval-provider', model: 'bench-model', reasoningEffort: 'low' })
  })

  it('falls back to the main agentDefaultModel selection when eval-defaults are empty', () => {
    const b = { model: 'bench-model' } as unknown as Pick<Benchmark, 'model' | 'provider' | 'reasoningEffort'>
    const selection = resolveModelSelection(b, agentDefaultModel, settingsWith({ provider: '', model: '', reasoningEffort: '' }))
    expect(selection).toEqual({ provider: 'main-provider', model: 'bench-model', reasoningEffort: 'medium' })
  })

  it('inherits the eval-defaults model when benchmark.model is omitted', () => {
    const b = {} as unknown as Pick<Benchmark, 'model' | 'provider' | 'reasoningEffort'>
    const selection = resolveModelSelection(b, agentDefaultModel, settingsWith({ provider: 'eval-provider', model: 'eval-model' }))
    expect(selection).toEqual({ provider: 'eval-provider', model: 'eval-model', reasoningEffort: 'medium' })
  })

  it('drops reasoningEffort when no source defines it', () => {
    const b = {} as unknown as Pick<Benchmark, 'model' | 'provider' | 'reasoningEffort'>
    const noEffortMain = {
      currentSelection: () => ({ provider: 'main-provider', model: 'main-model' }),
    }
    const selection = resolveModelSelection(b, noEffortMain, settingsWith({ provider: 'eval-provider', model: 'eval-model' }))
    expect(selection).toEqual({ provider: 'eval-provider', model: 'eval-model' })
    expect(selection.reasoningEffort).toBeUndefined()
  })
})

describe('dsh-eval readEvalDefaults', () => {
  it('normalizes to trimmed strings and drops empty fields', () => {
    expect(readEvalDefaults(settingsWith({ provider: '  eval-provider  ', model: '  ', reasoningEffort: '  max  ' })))
      .toEqual({ provider: 'eval-provider', reasoningEffort: 'max' })
  })

  it('returns {} for missing settings or junk values', () => {
    expect(readEvalDefaults(undefined)).toEqual({})
    expect(readEvalDefaults(settingsWith(null))).toEqual({})
    expect(readEvalDefaults(settingsWith('junk'))).toEqual({})
  })
})

describe('dsh-eval resolveJudge', () => {
  const selection = { provider: 'main-provider', model: 'main-model' }

  it('defaults provider/model to the effective selection', () => {
    const judge = { provider: '', model: undefined, maxScore: 10 } as unknown as BenchmarkJudge
    expect(resolveJudge({ judge } as unknown as Pick<Benchmark, 'judge'>, selection))
      .toEqual({ provider: 'main-provider', model: 'main-model', maxScore: 10 })
  })

  it('keeps explicit provider, model, rubric, criteria, and the http fallback fields', () => {
    const judge = {
      provider: 'clipa',
      model: 'judge-x',
      maxScore: 10,
      rubric: 'Be strict.',
      criteria: [{ label: 'Names concrete failures', weight: 3 }],
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKeyEnv: 'CLIPA_API_KEY',
    } as unknown as BenchmarkJudge
    expect(resolveJudge({ judge } as unknown as Pick<Benchmark, 'judge'>, selection)).toEqual(judge)
  })

  it('returns undefined when no judge is configured', () => {
    expect(resolveJudge({} as unknown as Pick<Benchmark, 'judge'>, selection)).toBeUndefined()
  })
})
