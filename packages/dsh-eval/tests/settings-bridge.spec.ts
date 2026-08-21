import { describe, expect, it } from 'vitest'
import { buildChildSettings, extractProviderSubtree, findConfigurable, providerIdOf } from '../src/settings-bridge.ts'
import type { ConfigurableProvider } from '../src/settings-bridge.ts'

describe('dsh-eval settings-bridge provider discovery', () => {
  it('normalizes provider ids from {id} objects and plain strings', () => {
    expect(providerIdOf({ id: 'deepseek-official' })).toBe('deepseek-official')
    expect(providerIdOf('deepseek-official')).toBe('deepseek-official')
  })

  it('finds a live+configurable provider returned as {id} objects (rc.8 listProviders shape)', () => {
    const llm = {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listConfigurableProviders: () => [
        { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] } as ConfigurableProvider,
      ],
    }
    expect(findConfigurable({ provider: 'deepseek-official' }, llm)).toMatchObject({ settingsNs: 'llm-deepseek' })
  })

  it('finds a live+configurable provider returned as plain id strings', () => {
    const llm = {
      listProviders: () => ['deepseek-official'],
      listConfigurableProviders: () => [
        { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] } as ConfigurableProvider,
      ],
    }
    expect(findConfigurable({ provider: 'deepseek-official' }, llm)).toMatchObject({ settingsNs: 'llm-deepseek' })
  })

  it('fails readable when the provider is not live', () => {
    const llm = {
      listProviders: () => [{ id: 'other', name: 'X' }],
      listConfigurableProviders: () => [
        { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] } as ConfigurableProvider,
      ],
    }
    expect(() => findConfigurable({ provider: 'deepseek-official' }, llm)).toThrow(/not a live route/)
  })

  it('fails readable when the provider is live but not configurable', () => {
    const llm = {
      listProviders: () => ['deepseek-official'],
      listConfigurableProviders: () => [],
    }
    expect(() => findConfigurable({ provider: 'deepseek-official' }, llm)).toThrow(/not configurable/)
  })

  it('extracts the llm-deepseek subtree from the rc.8 descriptor-array describe() shape', () => {
    const settings = {
      describe: () => [
        { ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' }, user: { baseURL: 'http://127.0.0.1:1' }, applies: 'delayed' },
      ],
    }
    const subtree = extractProviderSubtree(
      { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] } as ConfigurableProvider,
      { provider: 'deepseek-official' },
      settings,
    )
    expect(subtree.bridgeable).toBe(true)
    expect(subtree.value).toEqual({ baseURL: 'http://127.0.0.1:1' })
  })

  it('falls back to the resolved value when the descriptor has no user override', () => {
    const settings = {
      describe: () => [
        { ns: 'llm-deepseek', value: { baseURL: 'https://default' }, applies: 'startup' },
      ],
    }
    const subtree = extractProviderSubtree(
      { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] } as ConfigurableProvider,
      { provider: 'deepseek-official' },
      settings,
    )
    expect(subtree.bridgeable).toBe(true)
    expect(subtree.value).toEqual({ baseURL: 'https://default' })
  })

  it('fails closed when the provider namespace is not registered', () => {
    const settings = {
      describe: () => [{ ns: 'other-ns', value: {}, applies: 'startup' }],
    }
    const subtree = extractProviderSubtree(
      { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] } as ConfigurableProvider,
      { provider: 'deepseek-official' },
      settings,
    )
    expect(subtree.bridgeable).toBe(false)
    expect(subtree.reason).toContain('no settings namespace "llm-deepseek"')
  })

  it('fails closed on a non-empty raw headers subtree', () => {
    const settings = {
      describe: () => [
        { ns: 'llm-deepseek', value: { headers: { Authorization: 'Bearer secret' } }, applies: 'delayed' },
      ],
    }
    const subtree = extractProviderSubtree(
      { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] } as ConfigurableProvider,
      { provider: 'deepseek-official' },
      settings,
    )
    expect(subtree.bridgeable).toBe(false)
    expect(subtree.reason).toContain('raw headers')
  })

  it('buildChildSettings writes reasoningEffort into agent-default-model when selected', () => {
    const child = buildChildSettings(
      { provider: 'clipa', model: 'gpt-5.6-sol', reasoningEffort: 'max' },
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'clipa'], value: {}, bridgeable: true },
    )
    expect(child['agent-default-model']).toEqual({ provider: 'clipa', model: 'gpt-5.6-sol', reasoningEffort: 'max' })
  })

  it('buildChildSettings omits reasoningEffort when the selection has none', () => {
    const child = buildChildSettings(
      { provider: 'deepseek-official', model: 'deepseek-v4' },
      { settingsNs: 'llm-deepseek', settingsPath: [], value: {}, bridgeable: true },
    )
    expect(child['agent-default-model']).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4' })
  })
})
