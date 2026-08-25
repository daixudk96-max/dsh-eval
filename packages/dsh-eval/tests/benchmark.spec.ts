import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { caseCheckProblems, loadBenchmark, parseBenchmark } from '../src/benchmark.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-benchmark-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('dsh-eval benchmark loading', () => {
  it('loads a document with defaults and resolves relative paths', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'prompt.md'), 'Fix all the failing tests in this repository.')
    writeFileSync(join(dir, 'seed.txt'), 'seed')
    writeFileSync(join(dir, 'benchmark.yml'), [
      'name: skill-regression',
      'model: deepseek-v4',
      'cases:',
      '  - id: fix-tests-001',
      '    promptFile: prompt.md',
      '    workspace: seed.txt',
      '    expected:',
      '      tool: bash',
      '      check: ./check.sh',
      'pricing:',
      '  deepseek-v4:',
      '    inputUsdPerMTokens: 0.27',
      '    cacheReadUsdPerMTokens: 0.07',
      '    cacheWriteUsdPerMTokens: 0.27',
      '    outputUsdPerMTokens: 1.10',
      '',
    ].join('\n'))
    const benchmark = await loadBenchmark(join(dir, 'benchmark.yml'))
    expect(benchmark.name).toBe('skill-regression')
    expect(benchmark.model).toBe('deepseek-v4')
    expect(benchmark.profile).toBe('headless')
    // The fork treats an omitted `command` as `[]` (launcher fallback), not the
    // upstream `['dsh']` default, because the machine may not have `dsh` on PATH.
    expect(benchmark.command).toEqual([])
    expect(benchmark.trials).toBe(1)
    expect(benchmark.timeoutMs).toBe(600_000)
    expect(benchmark.seed).toBe(0)
    expect(benchmark.baseDir).toBe(dir)
    expect(benchmark.cases).toEqual([
      {
        id: 'fix-tests-001',
        prompt: 'Fix all the failing tests in this repository.',
        workspace: join(dir, 'seed.txt'),
        weight: 1,
        expected: { tool: 'bash', check: './check.sh' },
      },
    ])
    expect(benchmark.pricing?.['deepseek-v4']).toEqual({
      inputUsdPerMTokens: 0.27,
      cacheReadUsdPerMTokens: 0.07,
      cacheWriteUsdPerMTokens: 0.27,
      outputUsdPerMTokens: 1.10,
    })
  })

  it('keeps absolute workspace paths and inline prompts as-is', async () => {
    const dir = tempDir()
    const absolute = join(dir, 'abs')
    const benchmark = await parseBenchmark([
      'name: abs',
      'model: m',
      'trials: 3',
      'timeoutMs: 500',
      'seed: 7',
      'profile: custom',
      'command: [pnpm, dsh]',
      `cases:\n  - id: a\n    prompt: an inline prompt long enough for validation\n    workspace: ${absolute}`,
      '',
    ].join('\n'), dir)
    expect(benchmark.profile).toBe('custom')
    expect(benchmark.command).toEqual(['pnpm', 'dsh'])
    expect(benchmark.trials).toBe(3)
    expect(benchmark.timeoutMs).toBe(500)
    expect(benchmark.seed).toBe(7)
    expect(benchmark.cases[0]).toEqual({ id: 'a', prompt: 'an inline prompt long enough for validation', workspace: absolute, weight: 1 })
  })

  it('keeps tool-only and check-only expectations', async () => {
    const dir = tempDir()
    const toolOnly = await parseBenchmark([
      'name: tool-only',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '    expected:',
      '      tool: bash',
      '',
    ].join('\n'), dir)
    expect(toolOnly.cases[0]?.expected).toEqual({ tool: 'bash' })
    const checkOnly = await parseBenchmark([
      'name: check-only',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '    expected:',
      '      check: ./check.sh',
      '',
    ].join('\n'), dir)
    expect(checkOnly.cases[0]?.expected).toEqual({ check: './check.sh' })
  })

  it('parses judge configuration with defaults', async () => {
    const benchmark = await parseBenchmark([
      'name: judged',
      'model: deepseek-v4',
      'judge:',
      '  rubric: Be strict.',
      '  maxScore: 5',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.judge).toEqual({
      // Provider defaults to `''` (resolved to the effective provider at run
      // time), not the upstream hardcoded `'deepseek'`.
      provider: '',
      model: 'deepseek-v4',
      rubric: 'Be strict.',
      maxScore: 5,
    })
  })

  it('keeps explicit judge provider and model', async () => {
    const benchmark = await parseBenchmark([
      'name: judged',
      'model: deepseek-v4',
      'judge:',
      '  provider: other',
      '  model: judge-x',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.judge).toEqual({ provider: 'other', model: 'judge-x', maxScore: 10 })
  })

  it('keeps the judge http fallback fields', async () => {
    const benchmark = await parseBenchmark([
      'name: judged',
      'model: deepseek-v4',
      'judge:',
      '  provider: clipa',
      '  model: judge-x',
      '  baseUrl: http://127.0.0.1:8317/v1',
      '  apiKeyEnv: CLIPA_API_KEY',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.judge).toEqual({
      provider: 'clipa',
      model: 'judge-x',
      maxScore: 10,
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKeyEnv: 'CLIPA_API_KEY',
    })
  })

  it('keeps judge criteria with weights', async () => {
    const benchmark = await parseBenchmark([
      'name: judged',
      'model: deepseek-v4',
      'judge:',
      '  provider: clipa',
      '  criteria:',
      '    - label: Names concrete failures',
      '      weight: 3',
      '    - label: No hallucinated claims',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.judge).toEqual({
      provider: 'clipa',
      model: 'deepseek-v4',
      maxScore: 10,
      criteria: [
        { label: 'Names concrete failures', weight: 3 },
        { label: 'No hallucinated claims' },
      ],
    })
  })

  it('rejects an invalid judge criteria weight', async () => {
    await expect(parseBenchmark([
      'name: judged',
      'model: m',
      'judge:',
      '  criteria:',
      '    - label: A criterion',
      '      weight: 0',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())).rejects.toThrow()
  })

  it('rejects an unknown judge field', async () => {
    await expect(parseBenchmark([
      'name: judged',
      'model: m',
      'judge:',
      '  maxScore: 10',
      '  unknownField: x',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())).rejects.toThrow()
  })

  it('rejects an invalid judge maxScore', async () => {
    await expect(parseBenchmark([
      'name: judged',
      'model: m',
      'judge:',
      '  maxScore: 0',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())).rejects.toThrow()
  })

  it('parses replay configuration and resolves its directory', async () => {
    const dir = tempDir()
    const benchmark = await parseBenchmark([
      'name: replayed',
      'model: m',
      'replay:',
      '  dir: ./replays',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), dir)
    expect(benchmark.replay).toEqual({ dir: join(dir, 'replays') })
  })

  it('keeps an absolute replay directory as-is', async () => {
    const dir = tempDir()
    const absolute = join(dir, 'replays')
    const benchmark = await parseBenchmark([
      'name: replayed',
      'model: m',
      'replay:',
      `  dir: ${absolute}`,
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), dir)
    expect(benchmark.replay).toEqual({ dir: absolute })
  })

  it.each([
    { name: 'empty', text: '', message: 'must be a YAML mapping' },
    { name: 'missing name', text: 'model: m\ncases:\n  - id: a\n    prompt: p\n', message: '' },
    { name: 'both prompt sources', text: 'name: n\nmodel: m\ncases:\n  - id: a\n    prompt: p\n    promptFile: x.md\n', message: 'exactly one of prompt or promptFile' },
    { name: 'unknown key', text: 'name: n\nmodel: m\nbogus: 1\ncases:\n  - id: a\n    prompt: p\n', message: '' },
    { name: 'no cases', text: 'name: n\nmodel: m\ncases: []\n', message: '' },
    { name: 'empty expected', text: 'name: n\nmodel: m\ncases:\n  - id: a\n    prompt: p\n    expected: {}\n', message: 'expected needs at least one of tool or check' },
  ])('rejects an invalid document ($name)', async ({ text, message }) => {
    if (message === '') {
      await expect(parseBenchmark(text, tempDir())).rejects.toThrow()
    } else {
      await expect(parseBenchmark(text, tempDir())).rejects.toThrow(message)
    }
  })

  it('rejects missing prompt files and invalid YAML', async () => {
    const dir = tempDir()
    await expect(parseBenchmark('name: n\nmodel: m\ncases:\n  - id: a\n    promptFile: nope.md\n', dir))
      .rejects.toThrow()
    await expect(parseBenchmark('name: n\nmodel: m\ncases:\n  - id: a\n    prompt: [unclosed\n', dir))
      .rejects.toThrow()
  })

  it('rejects a missing benchmark file', async () => {
    await expect(loadBenchmark(join(tempDir(), 'missing.yml'))).rejects.toThrow()
  })

  it('defaults every case to the dev split', async () => {
    const benchmark = await parseBenchmark([
      'name: split-default',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.cases[0]?.split).toBeUndefined() // dev is the omitted default
  })

  it('keeps explicit guard cases and filters by split', async () => {
    const dir = tempDir()
    const document = [
      'name: split-doc',
      'model: m',
      'cases:',
      '  - id: dev-case',
      '    prompt: First long prompt for the split test case.',
      '  - id: guard-case',
      '    prompt: Second long prompt for the split test case.',
      '    split: guard',
      '',
    ].join('\n')
    const all = await parseBenchmark(document, dir)
    expect(all.cases).toHaveLength(2)
    expect(all.cases[0]).toMatchObject({ id: 'dev-case' })
    expect(all.cases[1]).toMatchObject({ id: 'guard-case', split: 'guard' })
    const dev = await parseBenchmark(document, dir, {}, 'dev')
    expect(dev.cases.map(caseValue => caseValue.id)).toEqual(['dev-case'])
    const guard = await parseBenchmark(document, dir, {}, 'guard')
    expect(guard.cases.map(caseValue => caseValue.id)).toEqual(['guard-case'])
  })

  it('rejects a split filter that matches no case', async () => {
    await expect(parseBenchmark([
      'name: split-empty',
      'model: m',
      'cases:',
      '  - id: dev-only',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir(), {}, 'guard')).rejects.toThrow('no cases in split "guard"')
  })

  it('rejects an invalid split value', async () => {
    await expect(parseBenchmark([
      'name: split-bad',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '    split: staging',
      '',
    ].join('\n'), tempDir())).rejects.toThrow()
  })

  it('filters via loadBenchmark with the same semantics', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'split.yml'), [
      'name: split-file',
      'model: m',
      'cases:',
      '  - id: dev-case',
      '    prompt: First long prompt for the split test case.',
      '  - id: guard-case',
      '    prompt: Second long prompt for the split test case.',
      '    split: guard',
      '',
    ].join('\n'))
    const guard = await loadBenchmark(join(dir, 'split.yml'), {}, 'guard')
    expect(guard.cases.map(caseValue => caseValue.id)).toEqual(['guard-case'])
  })

  it('parses frozen and materials with a stable semantic digest', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'm.txt'), 'material bytes')
    const document = [
      'name: frozen-doc',
      'model: m',
      'frozen: true',
      'materials:',
      '  - m.txt',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n')
    const first = await parseBenchmark(document, dir)
    const second = await parseBenchmark(document, dir)
    expect(first.frozen).toBe(true)
    expect(first.materials).toEqual([{ path: 'm.txt', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }])
    expect(first.benchmarkDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(first.caseHashes.a).toMatch(/^[0-9a-f]{64}$/)
    // Deterministic: same document + same material bytes → same digest.
    expect(second.benchmarkDigest).toBe(first.benchmarkDigest)
    // The digest covers the full case set, not the split-filtered subset.
    const dev = await parseBenchmark(document, dir, {}, 'dev')
    expect(dev.benchmarkDigest).toBe(first.benchmarkDigest)
  })

  it('changes the digest when a material changes', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'm.txt'), 'version A')
    const document = [
      'name: frozen-doc',
      'model: m',
      'frozen: true',
      'materials:',
      '  - m.txt',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n')
    const before = await parseBenchmark(document, dir)
    writeFileSync(join(dir, 'm.txt'), 'version B')
    const after = await parseBenchmark(document, dir)
    expect(after.benchmarkDigest).not.toBe(before.benchmarkDigest)
  })

  it('rejects a material that escapes the benchmark directory', async () => {
    const dir = tempDir()
    await expect(parseBenchmark([
      'name: escape',
      'model: m',
      'materials:',
      '  - ../outside.txt',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), dir)).rejects.toThrow('escapes the benchmark directory')
  })

  it('defaults frozen to false with an empty material manifest', async () => {
    const benchmark = await parseBenchmark([
      'name: plain',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.frozen).toBe(false)
    expect(benchmark.materials).toEqual([])
    expect(benchmark.benchmarkDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('loadBenchmark records the source path for frozen re-verification', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'frozen.yml'), [
      'name: frozen-file',
      'model: m',
      'frozen: true',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '',
    ].join('\n'))
    const benchmark = await loadBenchmark(join(dir, 'frozen.yml'))
    expect(benchmark.sourcePath).toBe(join(dir, 'frozen.yml'))
  })

  it('defaults case weight to 1 and preserves an explicit weight (P1-1)', async () => {
    const benchmark = await parseBenchmark([
      'name: weights',
      'model: m',
      'cases:',
      '  - id: plain',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '  - id: heavy',
      '    prompt: Another sufficiently long prompt for the case.',
      '    weight: 2',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.cases[0]).toMatchObject({ id: 'plain', weight: 1 })
    expect(benchmark.cases[1]).toMatchObject({ id: 'heavy', weight: 2 })
  })

  it('rejects a non-positive case weight', async () => {
    await expect(parseBenchmark([
      'name: weights',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '    weight: 0',
      '',
    ].join('\n'), tempDir())).rejects.toThrow()
  })

  it('parses and preserves case lifecycle and meta (P1-5)', async () => {
    const benchmark = await parseBenchmark([
      'name: lifecycle',
      'model: m',
      'cases:',
      '  - id: draft-case',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '  - id: calibrating-case',
      '    prompt: Another sufficiently long prompt for the case.',
      '    lifecycle: calibrating',
      '    meta:',
      '      capability: [codegen, debugging]',
      '      distinguisher: recursion',
      '  - id: frozen-case',
      '    prompt: Yet another sufficiently long prompt for the case.',
      '    lifecycle: frozen',
      '    meta:',
      '      capability: refactoring',
      '      calibrationHistory:',
      '        - v1',
      '        - v2',
      '',
    ].join('\n'), tempDir())
    // Draft lifecycle is the omitted default: neither field surfaces.
    expect(benchmark.cases[0]).toMatchObject({ id: 'draft-case' })
    expect(benchmark.cases[0]?.lifecycle).toBeUndefined()
    expect(benchmark.cases[0]?.meta).toBeUndefined()
    expect(benchmark.cases[1]).toMatchObject({
      id: 'calibrating-case',
      lifecycle: 'calibrating',
      meta: { capability: ['codegen', 'debugging'], distinguisher: 'recursion' },
    })
    expect(benchmark.cases[2]).toMatchObject({
      id: 'frozen-case',
      lifecycle: 'frozen',
      meta: { capability: 'refactoring', calibrationHistory: ['v1', 'v2'] },
    })
  })

  it('rejects an unknown meta field', async () => {
    await expect(parseBenchmark([
      'name: lifecycle',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '    lifecycle: frozen',
      '    meta:',
      '      bogus: x',
      '',
    ].join('\n'), tempDir())).rejects.toThrow()
  })

  it('rejects a short prompt (P1-6)', async () => {
    await expect(parseBenchmark([
      'name: check',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: too short',
      '',
    ].join('\n'), tempDir())).rejects.toThrow('at least 20 characters')
  })

  it('rejects a non-draft lifecycle without meta (P1-6)', async () => {
    await expect(parseBenchmark([
      'name: check',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '    lifecycle: frozen',
      '',
    ].join('\n'), tempDir())).rejects.toThrow('has no meta')
  })

  it('rejects an empty configured judge rubric (P1-6)', async () => {
    // An empty string is already rejected by the schema; caseCheckProblems
    // additionally flags a whitespace-only rubric that passes min(1).
    const caseValue = await (async () => {
      const benchmark = await parseBenchmark([
        'name: check',
        'model: m',
        'cases:',
        '  - id: a',
        '    prompt: A sufficiently long prompt for the benchmark case.',
        '',
      ].join('\n'), tempDir())
      return benchmark.cases[0]
    })()
    expect(caseCheckProblems(caseValue!, { provider: '', model: 'm', maxScore: 10, rubric: '   ' }).join(' '))
      .toContain('judge rubric is empty')
  })

  it('accepts a frozen case with meta (P1-6 positive)', async () => {
    const benchmark = await parseBenchmark([
      'name: check',
      'model: m',
      'cases:',
      '  - id: a',
      '    prompt: A sufficiently long prompt for the benchmark case.',
      '    lifecycle: frozen',
      '    meta:',
      '      capability: refactoring',
      '',
    ].join('\n'), tempDir())
    expect(benchmark.cases[0]).toMatchObject({ id: 'a', lifecycle: 'frozen' })
  })
})
