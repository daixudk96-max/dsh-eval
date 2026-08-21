import { describe, expect, it } from 'vitest'
import { readEvalDefaults, resolveModelSelection, EVAL_DEFAULTS_NS } from '../src/model.ts'
import type { Benchmark } from '../src/types.ts'

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
