/**
 * Benchmark document loading and validation for dsh-eval. YAML parses with
 * js-yaml's safe loader; zod validates the parsed shape; prompt files and
 * workspaces resolve against the benchmark file's directory. A judge rubric
 * may be plaintext (`judge.rubricText`) or an AES-256-GCM `v1:` envelope
 * (`judge.rubricCipher`, see lib/rubric) — the envelope is decrypted here at
 * load time, so the rest of the pipeline only ever sees plaintext.
 *
 * Each case may declare a `split` target (`dev` or `guard`, default `dev`):
 * guard cases are hidden from candidate-triggered runs and evaluated only on
 * demand (see the split-filter parameter of parseBenchmark/loadBenchmark).
 *
 * @module dsh-eval/benchmark
 */

import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { load } from 'js-yaml'
import { z } from 'zod'
import { decryptRubric, resolveRubricKey, type RubricKeyOptions } from './rubric.ts'
import type { Benchmark, BenchmarkCase, BenchmarkSplit } from './types.ts'

const judgeSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  rubric: z.string().min(1).optional(),
  rubricText: z.string().min(1).optional(),
  rubricCipher: z.string().min(1).optional(),
  maxScore: z.number().int().positive().default(10),
  baseUrl: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
}).strict().refine(
  judge => [judge.rubric, judge.rubricText, judge.rubricCipher].filter(v => v !== undefined).length <= 1,
  { message: 'judge accepts at most one of rubric, rubricText, rubricCipher' },
)

const replaySchema = z.object({
  dir: z.string().min(1),
}).strict()

const pricingSchema = z.object({
  inputUsdPerMTokens: z.number().nonnegative(),
  cacheReadUsdPerMTokens: z.number().nonnegative(),
  cacheWriteUsdPerMTokens: z.number().nonnegative(),
  outputUsdPerMTokens: z.number().nonnegative(),
}).strict()

const benchmarkCaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1).optional(),
  promptFile: z.string().min(1).optional(),
  split: z.enum(['dev', 'guard']).default('dev'),
  workspace: z.string().min(1).optional(),
  expected: z.object({
    tool: z.string().min(1).optional(),
    check: z.string().min(1).optional(),
  }).strict().refine(
    expectation => expectation.tool !== undefined || expectation.check !== undefined,
    { message: 'expected needs at least one of tool or check' },
  ).optional(),
}).strict().refine(
  caseValue => (caseValue.prompt === undefined) !== (caseValue.promptFile === undefined),
  { message: 'each case needs exactly one of prompt or promptFile' },
)

const benchmarkSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  provider: z.string().min(1).optional(),
  reasoningEffort: z.string().min(1).optional(),
  profile: z.string().min(1).default('headless'),
  command: z.array(z.string().min(1)).optional(),
  trials: z.number().int().positive().default(1),
  timeoutMs: z.number().int().positive().default(600_000),
  seed: z.number().int().default(0),
  cases: z.array(benchmarkCaseSchema).min(1),
  pricing: z.record(z.string().min(1), pricingSchema).optional(),
  judge: judgeSchema.optional(),
  replay: replaySchema.optional(),
  frozen: z.boolean().default(false),
  materials: z.array(z.string().min(1)).optional(),
}).strict()

/** Canonical JSON for semantic hashing: stable key order, no whitespace. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
}

/** SHA-256 hex of a string. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Resolve the explicit material manifest: every entry must be a regular file
 * contained by the benchmark directory (no `..`, no symlink escape, no
 * directory expansion). Bytes are hashed at load time.
 * @param entries - the raw `materials` list from the document.
 * @param baseDir - absolute benchmark directory.
 * @returns the normalized manifest.
 */
async function resolveMaterials(
  entries: readonly string[] | undefined,
  baseDir: string,
): Promise<{ path: string; sha256: string }[]> {
  if (entries === undefined || entries.length === 0) return []
  const baseReal = await realpath(baseDir)
  const manifest: { path: string; sha256: string }[] = []
  for (const entry of entries) {
    const absolute = resolve(baseDir, entry)
    const rel = relative(baseReal, absolute)
    if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
      throw new Error(`benchmark material escapes the benchmark directory: ${entry}`)
    }
    const real = await realpath(absolute)
    if (real !== absolute && !real.startsWith(`${baseReal}${sep}`)) {
      throw new Error(`benchmark material escapes via symlink: ${entry}`)
    }
    const bytes = await readFile(absolute)
    manifest.push({ path: entry, sha256: sha256Hex(bytes.toString('utf8')) })
  }
  return manifest
}

/**
 * Resolve one parsed case's prompt and workspace against the benchmark
 * directory. Prompt files are read at load time so a run fails before any
 * trial starts.
 * @param parsed - the zod-validated case document.
 * @param baseDir - absolute directory the benchmark file lives in.
 * @returns the resolved runtime case.
 */
async function resolveCase(
  parsed: z.infer<typeof benchmarkCaseSchema>,
  baseDir: string,
): Promise<BenchmarkCase> {
  const prompt = parsed.prompt
    ?? await readFile(resolve(baseDir, parsed.promptFile as string), 'utf8')
  return {
    id: parsed.id,
    prompt,
    ...(parsed.split !== undefined && parsed.split !== 'dev' ? { split: parsed.split } : {}),
    ...(parsed.workspace !== undefined
      ? { workspace: isAbsolute(parsed.workspace) ? parsed.workspace : resolve(baseDir, parsed.workspace) }
      : {}),
    ...(parsed.expected !== undefined
      ? {
        expected: {
          ...(parsed.expected.tool !== undefined ? { tool: parsed.expected.tool } : {}),
          ...(parsed.expected.check !== undefined ? { check: parsed.expected.check } : {}),
        },
      }
      : {}),
  }
}

/**
 * Parse benchmark YAML text into a validated runtime document.
 * @param text - the benchmark document's YAML source.
 * @param baseDir - absolute directory used to resolve prompt and workspace paths.
 * @param opts - optional rubric key resolution overrides (see RubricKeyOptions).
 * @param splitFilter - when given, keep only cases whose `split` equals this
 *   value; omitted keeps every case. Guard cases are hidden unless explicitly
 *   requested, so candidate runs never see them by accident.
 * @returns the validated benchmark; an encrypted judge rubric is decrypted to plaintext.
 */
export async function parseBenchmark(
  text: string,
  baseDir: string,
  opts: RubricKeyOptions = {},
  splitFilter?: BenchmarkSplit,
): Promise<Benchmark> {
  const value = load(text)
  if (typeof value !== 'object' || value === null) {
    throw new Error('benchmark document must be a YAML mapping')
  }
  const parsed = benchmarkSchema.parse(value)
  // Resolve EVERY case first (unfiltered): the semantic digest must cover the
  // full benchmark so dev and guard runs share one epoch identity.
  const allCases: BenchmarkCase[] = []
  for (const caseValue of parsed.cases) {
    allCases.push(await resolveCase(caseValue, baseDir))
  }
  const pricing = parsed.pricing
  let judge = parsed.judge
  if (judge !== undefined && judge.rubricCipher !== undefined) {
    const key = resolveRubricKey(baseDir, opts)
    const rubric = decryptRubric(judge.rubricCipher, key)
    const { rubricCipher: _cipher, ...rest } = judge
    judge = { ...rest, rubric }
  }
  else if (judge !== undefined && judge.rubricText !== undefined && judge.rubric === undefined) {
    const { rubricText: _text, ...rest } = judge
    judge = { ...rest, rubric: judge.rubricText }
  }
  const rubricHash = judge?.rubric !== undefined ? sha256Hex(judge.rubric) : null
  // Per-case semantic hashes: case fields + the benchmark-level rubric hash.
  const caseHashes: Record<string, string> = {}
  for (const c of allCases) {
    caseHashes[c.id] = sha256Hex(canonicalJson({
      id: c.id,
      split: c.split ?? 'dev',
      prompt: c.prompt,
      expected: c.expected ?? null,
      rubricHash,
    }))
  }
  const materials = await resolveMaterials(parsed.materials, baseDir)
  const benchmarkDigest = sha256Hex(canonicalJson({
    name: parsed.name,
    caseOrder: allCases.map(c => c.id),
    caseHashes,
    judge: judge === undefined
      ? null
      : { provider: judge.provider ?? '', model: judge.model ?? parsed.model, maxScore: judge.maxScore, rubricHash },
    materials,
  }))
  const cases = splitFilter === undefined
    ? allCases
    : allCases.filter(c => (c.split ?? 'dev') === splitFilter)
  if (splitFilter !== undefined && cases.length === 0) {
    throw new Error(`benchmark has no cases in split "${splitFilter}"`)
  }
  const replay = parsed.replay
  return {
    name: parsed.name,
    model: parsed.model,
    ...(parsed.provider !== undefined ? { provider: parsed.provider } : {}),
    ...(parsed.reasoningEffort !== undefined ? { reasoningEffort: parsed.reasoningEffort } : {}),
    profile: parsed.profile,
    command: parsed.command ?? [],
    trials: parsed.trials,
    timeoutMs: parsed.timeoutMs,
    seed: parsed.seed,
    cases,
    ...(pricing !== undefined ? { pricing } : {}),
    ...(judge !== undefined
      ? { judge: { provider: judge.provider ?? '', model: judge.model ?? parsed.model, ...(judge.rubric !== undefined ? { rubric: judge.rubric } : {}), ...(judge.rubricText !== undefined ? { rubricText: judge.rubricText } : {}), maxScore: judge.maxScore, ...(judge.baseUrl !== undefined ? { baseUrl: judge.baseUrl } : {}), ...(judge.apiKeyEnv !== undefined ? { apiKeyEnv: judge.apiKeyEnv } : {}) } }
      : {}),
    ...(replay !== undefined
      ? { replay: { dir: isAbsolute(replay.dir) ? replay.dir : resolve(baseDir, replay.dir) } }
      : {}),
    baseDir,
    sourcePath: '',
    frozen: parsed.frozen,
    benchmarkDigest,
    caseHashes,
    materials,
  }
}

/**
 * Load and validate a benchmark document from disk.
 * @param path - path to the benchmark YAML file.
 * @param opts - optional rubric key resolution overrides (see RubricKeyOptions).
 * @param splitFilter - when given, keep only cases whose `split` equals this value.
 * @returns the validated benchmark.
 */
export async function loadBenchmark(
  path: string,
  opts: RubricKeyOptions = {},
  splitFilter?: BenchmarkSplit,
): Promise<Benchmark> {
  const absolute = resolve(path)
  const benchmark = await parseBenchmark(await readFile(absolute, 'utf8'), dirname(absolute), opts, splitFilter)
  return { ...benchmark, sourcePath: absolute }
}
