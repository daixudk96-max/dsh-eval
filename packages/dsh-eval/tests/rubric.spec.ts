import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptRubric,
  deriveKey,
  encryptRubric,
  isEncryptedRubric,
  resolveRubricKey,
  rubricKeyFilePath,
} from '../src/rubric.ts'
import { loadBenchmark } from '../src/benchmark.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-rubric-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('dsh-eval rubric encryption', () => {
  it('encrypts to a v1 envelope and decrypts back to the plaintext', () => {
    const key = deriveKey('passphrase')
    const envelope = encryptRubric('score clarity, correctness, safety', key)
    expect(isEncryptedRubric(envelope)).toBe(true)
    expect(envelope.startsWith('v1:')).toBe(true)
    expect(envelope).not.toContain('score clarity')
    expect(decryptRubric(envelope, key)).toBe('score clarity, correctness, safety')
  })

  it('produces a different envelope for the same plaintext (random IV)', () => {
    const key = deriveKey('pass')
    const a = encryptRubric('same rubric', key)
    const b = encryptRubric('same rubric', key)
    expect(a).not.toBe(b)
    expect(decryptRubric(a, key)).toBe('same rubric')
    expect(decryptRubric(b, key)).toBe('same rubric')
  })

  it('throws on a malformed envelope and on tampered ciphertext', () => {
    const key = deriveKey('pass')
    expect(() => decryptRubric('v1:only-two-parts', key)).toThrow(/malformed encrypted envelope/)
    const envelope = encryptRubric('secret rubric', key)
    const tampered = envelope.slice(0, -2) + (envelope.endsWith('AA') ? 'BB' : 'AA')
    expect(() => decryptRubric(tampered, key)).toThrow()
  })

  it('passes legacy plaintext through unchanged (no v1: prefix)', () => {
    const key = deriveKey('pass')
    expect(decryptRubric('legacy rubric text', key)).toBe('legacy rubric text')
    expect(isEncryptedRubric('legacy rubric text')).toBe(false)
  })

  it('derives a deterministic 32-byte key', () => {
    const key = deriveKey('same passphrase')
    expect(key.length).toBe(32)
    expect(key.equals(deriveKey('same passphrase'))).toBe(true)
    expect(key.equals(deriveKey('other passphrase'))).toBe(false)
  })

  it('resolves the key: explicit config key wins over env', () => {
    const key = resolveRubricKey(tempDir(), { configKey: 'config-key', env: { DSH_EVOLVE_RUBRIC_KEY: 'env-key' } })
    expect(key.equals(deriveKey('config-key'))).toBe(true)
  })

  it('resolves the key: env wins when no config key is given', () => {
    const key = resolveRubricKey(tempDir(), { env: { DSH_EVOLVE_RUBRIC_KEY: 'env-key' } })
    expect(key.equals(deriveKey('env-key'))).toBe(true)
  })

  it('creates and reuses the local key file when no config/env key is given', () => {
    const dir = tempDir()
    const first = resolveRubricKey(dir)
    expect(first.equals(deriveKey(process.env.DSH_EVOLVE_RUBRIC_KEY ?? 'dsh-eval-dev-key'))).toBe(false)
    expect(first.equals(deriveKey('dsh-eval-dev-key'))).toBe(false)
    const keyPath = rubricKeyFilePath(dir)
    expect(existsSync(keyPath)).toBe(true)
    // reuse: same file content → same key
    expect(resolveRubricKey(dir).equals(first)).toBe(true)
  })
})

describe('dsh-eval benchmark rubric integration', () => {
  it('loads a benchmark with a plaintext rubricText judge', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'benchmark.yml'), [
      'name: rubric-text',
      'model: deepseek-v4',
      'judge:',
      '  rubricText: "score clarity, correctness"',
      '  maxScore: 10',
      'cases:',
      '  - id: c1',
      '    prompt: "say OK and report the result"',
      '    expected:',
      '      tool: bash',
      '      check: ./check.sh',
      '',
    ].join('\n'))
    const benchmark = await loadBenchmark(join(dir, 'benchmark.yml'))
    expect(benchmark.judge?.rubric).toBe('score clarity, correctness')
    expect(benchmark.judge?.maxScore).toBe(10)
  })

  it('decrypts a rubricCipher envelope at load time', async () => {
    const dir = tempDir()
    const key = deriveKey('benchmark-test-key')
    const envelope = encryptRubric('encrypted rubric body', key)
    writeFileSync(join(dir, 'benchmark.yml'), [
      'name: rubric-cipher',
      'model: deepseek-v4',
      'judge:',
      `  rubricCipher: "${envelope}"`,
      'cases:',
      '  - id: c1',
      '    prompt: "say OK and report the result"',
      '    expected:',
      '      tool: bash',
      '      check: ./check.sh',
      '',
    ].join('\n'))
    const benchmark = await loadBenchmark(join(dir, 'benchmark.yml'), {
      configKey: 'benchmark-test-key',
    })
    expect(benchmark.judge?.rubric).toBe('encrypted rubric body')
    expect(benchmark.judge?.rubricCipher).toBeUndefined()
  })

  it('rejects a judge declaring more than one rubric source', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'benchmark.yml'), [
      'name: rubric-conflict',
      'model: deepseek-v4',
      'judge:',
      '  rubricText: "one"',
      '  rubricCipher: "v1:two"',
      'cases:',
      '  - id: c1',
      '    prompt: "say OK and report the result"',
      '    expected:',
      '      tool: bash',
      '      check: ./check.sh',
      '',
    ].join('\n'))
    await expect(loadBenchmark(join(dir, 'benchmark.yml'))).rejects.toThrow(/at most one of rubric/)
  })

  it('fails loud when the rubricCipher cannot be decrypted (wrong key)', async () => {
    const dir = tempDir()
    const envelope = encryptRubric('secret', deriveKey('right-key'))
    writeFileSync(join(dir, 'benchmark.yml'), [
      'name: rubric-wrong-key',
      'model: deepseek-v4',
      'judge:',
      `  rubricCipher: "${envelope}"`,
      'cases:',
      '  - id: c1',
      '    prompt: "say OK and report the result"',
      '    expected:',
      '      tool: bash',
      '      check: ./check.sh',
      '',
    ].join('\n'))
    await expect(loadBenchmark(join(dir, 'benchmark.yml'), { configKey: 'wrong-key' })).rejects.toThrow()
  })
})
