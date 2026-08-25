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
import type { Benchmark, BenchmarkCase, BenchmarkCaseMeta, BenchmarkJudge, BenchmarkSplit } from './types.ts'

const judgeSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  rubric: z.string().min(1).optional(),
  rubricText: z.string().min(1).optional(),
  rubricCipher: z.string().min(1).optional(),
  criteria: z.array(z.object({
    label: z.string().min(1),
    weight: z.number().positive().optional(),
  })).min(1).optional(),
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

/** A case metadata value: a single string or a list of strings. */
const stringOrList = z.union([z.string().min(1), z.array(z.string().min(1))])

const caseMetaSchema = z.object({
  capability: stringOrList.optional(),
  distinguisher: stringOrList.optional(),
  shortcuts: stringOrList.optional(),
  calibrationHistory: stringOrList.optional(),
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
  weight: z.number().positive().default(1),
  lifecycle: z.enum(['draft', 'calibrating', 'frozen']).default('draft'),
  meta: caseMetaSchema.optional(),
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
/**
 * Strip undefined-valued meta keys from a parsed case's meta block so the
 * result satisfies the exact-optional `BenchmarkCaseMeta` type (zod's
 * `.optional()` widens each field to include `| undefined`).
 * @param meta - the zod-parsed meta block, or undefined when absent.
 * @returns a clean meta object, or undefined when the block is absent.
 */
function resolveCaseMeta(meta: z.infer<typeof caseMetaSchema> | undefined): BenchmarkCaseMeta | undefined {
  if (meta === undefined) return undefined
  const out: BenchmarkCaseMeta = {}
  if (meta.capability !== undefined) out.capability = meta.capability
  if (meta.distinguisher !== undefined) out.distinguisher = meta.distinguisher
  if (meta.shortcuts !== undefined) out.shortcuts = meta.shortcuts
  if (meta.calibrationHistory !== undefined) out.calibrationHistory = meta.calibrationHistory
  return out
}

async function resolveCase(
  parsed: z.infer<typeof benchmarkCaseSchema>,
  baseDir: string,
): Promise<BenchmarkCase> {
  const prompt = parsed.prompt
    ?? await readFile(resolve(baseDir, parsed.promptFile as string), 'utf8')
  const meta = resolveCaseMeta(parsed.meta)
  return {
    id: parsed.id,
    prompt,
    weight: parsed.weight,
    ...(parsed.lifecycle !== undefined && parsed.lifecycle !== 'draft' ? { lifecycle: parsed.lifecycle } : {}),
    ...(meta !== undefined ? { meta } : {}),
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
 * Mechanical validation of one resolved case (P1-6). Returns a list of
 * human-readable problems; an empty list means the case is well-formed.
 * Checks: the prompt is at least 20 characters, a configured (non-draft)
 * lifecycle requires a non-empty `meta`, and a configured judge rubric is
 * non-empty. The rubric is benchmark-level, so the same problem may surface
 * once per case; callers dedupe before reporting.
 * @param caseValue - the resolved case.
 * @param judge - the resolved judge (rubric decrypted), when configured.
 * @returns the list of problems, empty when the case is valid.
 */
export function caseCheckProblems(
  caseValue: BenchmarkCase,
  judge?: BenchmarkJudge,
): string[] {
  const problems: string[] = []
  const promptLength = caseValue.prompt.trim().length
  if (promptLength < 20) {
    problems.push(`case "${caseValue.id}" prompt must be at least 20 characters (got ${promptLength})`)
  }
  if (caseValue.lifecycle !== undefined && caseValue.lifecycle !== 'draft' && caseValue.meta === undefined) {
    problems.push(`case "${caseValue.id}" configures lifecycle "${caseValue.lifecycle}" but has no meta`)
  }
  if (judge?.rubric !== undefined && judge.rubric.trim() === '') {
    problems.push(`case "${caseValue.id}" judge rubric is empty`)
  }
  return problems
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
  // Narrow the parsed judge to the exact-optional `BenchmarkJudge` type once
  // (provider/model fall back to '' and the benchmark model), so both the
  // mechanical validation and the returned document share one shape.
  const resolvedJudge: BenchmarkJudge | undefined = judge === undefined
    ? undefined
    : {
      provider: judge.provider ?? '',
      model: judge.model ?? parsed.model,
      ...(judge.rubric !== undefined ? { rubric: judge.rubric } : {}),
      ...(judge.rubricText !== undefined ? { rubricText: judge.rubricText } : {}),
      ...(judge.criteria !== undefined
        ? { criteria: judge.criteria.map((c) => (c.weight === undefined ? { label: c.label } : { label: c.label, weight: c.weight })) }
        : {}),
      maxScore: judge.maxScore,
      ...(judge.baseUrl !== undefined ? { baseUrl: judge.baseUrl } : {}),
      ...(judge.apiKeyEnv !== undefined ? { apiKeyEnv: judge.apiKeyEnv } : {}),
    }
  // Mechanical validation (P1-6): early-fail on malformed cases rather than
  // silently running a benchmark that cannot be graded or evolved. Problems
  // are deduped because the benchmark-level rubric check surfaces per case.
  const problems = new Set<string>()
  for (const c of allCases) {
    for (const problem of caseCheckProblems(c, resolvedJudge)) problems.add(problem)
  }
  if (problems.size > 0) {
    throw new Error(`benchmark case validation failed:\n${[...problems].map(p => `- ${p}`).join('\n')}`)
  }
  // Per-case semantic hashes: case fields + the benchmark-level rubric hash.
  const caseHashes: Record<string, string> = {}
  for (const c of allCases) {
    caseHashes[c.id] = sha256Hex(canonicalJson({
      id: c.id,
      split: c.split ?? 'dev',
      prompt: c.prompt,
      expected: c.expected ?? null,
      weight: c.weight ?? 1,
      lifecycle: c.lifecycle ?? 'draft',
      ...(c.meta !== undefined ? { meta: c.meta } : {}),
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
    ...(resolvedJudge !== undefined ? { judge: resolvedJudge } : {}),
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
