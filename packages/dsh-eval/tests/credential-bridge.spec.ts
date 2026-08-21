import { describe, expect, it } from 'vitest'
import { buildChildEnv, discoverCredentialRef, resolveCredentialValue } from '../src/credential-bridge.ts'

describe('discoverCredentialRef', () => {
  it('maps deepseek providers to DEEPSEEK_API_KEY', () => {
    expect(discoverCredentialRef('deepseek', undefined)).toBe('DEEPSEEK_API_KEY')
    expect(discoverCredentialRef('deepseek-official', {})).toBe('DEEPSEEK_API_KEY')
  })

  it('reads apiKeyEnv from a pi-ai provider subtree', () => {
    expect(discoverCredentialRef('clipa', { apiKeyEnv: 'CLIPA_API_KEY', baseURL: 'http://x' })).toBe('CLIPA_API_KEY')
  })

  it('returns undefined without a named ref', () => {
    expect(discoverCredentialRef('clipa', { baseURL: 'http://x' })).toBeUndefined()
    expect(discoverCredentialRef('clipa', undefined)).toBeUndefined()
    expect(discoverCredentialRef('clipa', null)).toBeUndefined()
  })
})

describe('resolveCredentialValue', () => {
  it('normalizes the rc.8 { value, source } result object to its value', async () => {
    const credentials = {
      resolve: async () => ({ value: 'dai123456', source: 'file' }),
    }
    await expect(resolveCredentialValue('CLIPA_API_KEY', credentials)).resolves.toBe('dai123456')
  })

  it('passes a bare string through untouched', async () => {
    const credentials = {
      resolve: async () => 'sk-raw',
    }
    await expect(resolveCredentialValue('DEEPSEEK_API_KEY', credentials)).resolves.toBe('sk-raw')
  })

  it('maps an unresolved ref to undefined', async () => {
    const credentials = {
      resolve: async () => undefined,
    }
    await expect(resolveCredentialValue('OLLAMA_API_KEY', credentials)).resolves.toBeUndefined()
  })

  it('maps a result object without a string value to undefined', async () => {
    const credentials = {
      resolve: async () => ({ source: 'none' }),
    }
    await expect(resolveCredentialValue('X_API_KEY', credentials)).resolves.toBeUndefined()
  })
})

describe('buildChildEnv', () => {
  it('adds only the selected ref/value to a copy of the base env', () => {
    const env = buildChildEnv({ HOME: '/tmp' }, 'CLIPA_API_KEY', 'dai123456', { provider: 'clipa' })
    expect(env).toEqual({ HOME: '/tmp', CLIPA_API_KEY: 'dai123456' })
    expect(env).not.toBe({ HOME: '/tmp' })
  })

  it('leaves the env untouched without a ref', () => {
    const env = buildChildEnv({ HOME: '/tmp' }, undefined, undefined, { provider: 'clipa' })
    expect(env).toEqual({ HOME: '/tmp' })
  })

  it('throws a readable diagnostic when a named ref resolves to no value', () => {
    expect(() => buildChildEnv({}, 'CLIPA_API_KEY', undefined, { provider: 'clipa' }))
      .toThrow('credential ref "CLIPA_API_KEY" for provider "clipa" could not be resolved (no value)')
  })
})
