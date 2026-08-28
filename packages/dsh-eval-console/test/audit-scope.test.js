/**
 * Unit tests: scopeAuditEntries — evolution-audit ledger scoping to one
 * logical preset, so the board and timeline never leak another preset's
 * candidates.
 * Run via `node test/audit-scope.test.js` (Node 24 type stripping).
 *
 * Fixture: two logical presets (evaluate / system-evolver) woven into one
 * ledger exactly like the real evolution-audit lines — most old records carry
 * no logicalId (created/candidate-created/gate/budget only have runId), the
 * sealed/promoted records bridge runId via their `<logicalId>-` revision
 * prefix, and the modern switch-to-revision record carries an explicit
 * logicalId.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopeAuditEntries } from '../src/audit.ts'
import { EvalConsoleHostService } from '../src/host-service.ts'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const EVAL_RUN = 'evr-aaaaaaaa-1111'
const EVOLVER_RUN = 'evr-bbbbbbbb-2222'

/** One full run for "evaluate": created → candidate-created → sealed → gate → promoted. */
const EVAL_RUN_EVENTS = [
  { op: 'audit', runId: EVAL_RUN, event: 'created', state: 'DRAFT', ts: '2026-08-20T00:00:00Z' },
  { op: 'audit', runId: EVAL_RUN, event: 'candidate-created', candidateId: 'cand-eval-1', hypothesis: 'fix config', ts: '2026-08-20T00:01:00Z' },
  { op: 'audit', runId: EVAL_RUN, event: 'sealed', revisionId: 'evaluate-11111111', digest: '1111', ts: '2026-08-20T00:02:00Z' },
  { op: 'audit', runId: EVAL_RUN, event: 'gate', to: 'ACCEPTED', decision: 'PASS', reason: 'gain ok', ts: '2026-08-20T00:03:00Z' },
  { op: 'audit', runId: EVAL_RUN, event: 'promoted', revisionId: 'evaluate-11111111', approvalId: 'a1', ts: '2026-08-20T00:04:00Z' },
]

/** One full run for "system-evolver" with identical shapes. */
const EVOLVER_RUN_EVENTS = [
  { op: 'audit', runId: EVOLVER_RUN, event: 'created', state: 'DRAFT', ts: '2026-08-21T00:00:00Z' },
  { op: 'audit', runId: EVOLVER_RUN, event: 'sealed', revisionId: 'system-evolver-22222222', digest: '2222', ts: '2026-08-21T00:01:00Z' },
  { op: 'audit', runId: EVOLVER_RUN, event: 'gate', to: 'REJECTED', decision: 'FAIL', reason: 'regression', ts: '2026-08-21T00:02:00Z' },
]

/** An orphan budget record: runId never sealed → cannot be attributed. */
const ORPHAN_BUDGET = { op: 'audit', runId: 'evr-orphan-3333', event: 'budget', bucket: 'attempt', amountUsd: 0.01, ts: '2026-08-22T00:00:00Z' }

/** Modern records: explicit logicalId (switch-to-revision, rollback-applied). */
const EVAL_SWITCH = { op: 'audit', event: 'switch-to-revision', logicalId: 'evaluate', revisionId: 'evaluate-11111111', digest: '1111', targetDir: 'C:\\x', ts: '2026-08-22T01:00:00Z' }
const EVOLVER_ROLLBACK = { op: 'audit', event: 'rollback-applied', logicalId: 'system-evolver', targetRevisionId: 'system-evolver-22222222', ts: '2026-08-22T02:00:00Z' }
/** Explicitly-owned with runId: runId must be remembered and kept. */
const EVAL_BUDGET = { op: 'audit', runId: EVAL_RUN, event: 'budget', bucket: 'proposal', amountUsd: 0.02, ts: '2026-08-22T03:00:00Z' }

const LEDGER = [
  ...EVAL_RUN_EVENTS,
  ...EVOLVER_RUN_EVENTS,
  ORPHAN_BUDGET,
  EVAL_SWITCH,
  EVOLVER_ROLLBACK,
  EVAL_BUDGET,
]

test('keeps only the target logical preset events (order preserved)', () => {
  const scoped = scopeAuditEntries(LEDGER, 'evaluate')
  const events = scoped.map((entry) => entry.event)
  assert.deepEqual(events, ['created', 'candidate-created', 'sealed', 'gate', 'promoted', 'switch-to-revision', 'budget'])
  // The system-evolver run and the orphan budget are excluded.
  assert.ok(!events.includes('created') || scoped.every((e) => e.runId !== EVOLVER_RUN))
})

test('bridges old runId-only records via the sealed/promoted revision prefix', () => {
  const scoped = scopeAuditEntries(LEDGER, 'evaluate')
  // created/candidate-created/gate carry only runId — kept because the run's
  // sealed + promoted records name evaluate-<...> revisions.
  assert.equal(scoped.filter((e) => e.runId === EVAL_RUN).length, 6)
  assert.equal(scoped.filter((e) => e.runId === EVOLVER_RUN).length, 0)
})

test('rule 2: the owned-runs set keeps every event of an attributed run', () => {
  const scoped = scopeAuditEntries(LEDGER, 'evaluate')
  // EVAL_BUDGET has explicit logicalId + runId; its run is already owned.
  assert.equal(scoped.filter((e) => e.event === 'budget').length, 1)
  assert.equal(scoped[scoped.length - 1].runId, EVAL_RUN)
})

test('rule 5: un-attributable records are excluded', () => {
  const scoped = scopeAuditEntries(LEDGER, 'evaluate')
  assert.ok(!scoped.some((e) => e.runId === 'evr-orphan-3333'))
})

test('targetRevisionId prefix matches rollback-applied records', () => {
  const scoped = scopeAuditEntries(LEDGER, 'system-evolver')
  assert.ok(scoped.some((e) => e.event === 'rollback-applied' && e.runId === undefined))
  // The system-evolver rollback-applied is explicit-logicalId kept; the
  // evaluate records are excluded.
  assert.ok(!scoped.some((e) => e.event === 'switch-to-revision'))
})

test('scope audit for system-evolver excludes evaluate events', () => {
  const scoped = scopeAuditEntries(LEDGER, 'system-evolver')
  const events = scoped.map((entry) => entry.event)
  assert.deepEqual(events, ['created', 'sealed', 'gate', 'rollback-applied'])
  assert.ok(!scoped.some((e) => e.revisionId?.startsWith('evaluate-') ?? false))
})

test('logical id with dashes: prefix matching still works', () => {
  const ledger = [
    { op: 'audit', runId: 'r1', event: 'sealed', revisionId: 'a-b-c-11111111', digest: 'd1' },
    { op: 'audit', runId: 'r1', event: 'created', state: 'DRAFT' },
    { op: 'audit', runId: 'r2', event: 'sealed', revisionId: 'a-b-11112222', digest: 'd2' },
  ]
  const scoped = scopeAuditEntries(ledger, 'a-b-c')
  assert.deepEqual(scoped.map((e) => e.event), ['sealed', 'created'])
})

test('empty audit and unknown logical produce empty scopes', () => {
  assert.deepEqual(scopeAuditEntries([], 'evaluate'), [])
  assert.deepEqual(scopeAuditEntries(LEDGER, 'does-not-exist'), [])
})

// ---- Host snapshot scoping: the service folds the scoped audit into the
// board columns + timeline, while the revision counter stays global. ----

async function writeLedger(file) {
  const lines = LEDGER.map((entry) => JSON.stringify(entry))
  await writeFile(file, lines.join('\n') + '\n', 'utf8')
}

function mockRegistryFor(logical) {
  return {
    async resolveCurrent(id) {
      return id === logical
        ? { logicalId: id, revisionId: 'evaluate-11111111', digest: '11111111', gateRunId: 'evr-1', approvalId: 'a1', resolved: true }
        : null
    },
    async history() {
      return [{ revisionId: 'evaluate-11111111', digest: '11111111', digestShort: '11111111', status: 'active' }]
    },
    async revisionContent() {
      return { files: {}, text: '' }
    },
    async revisionManifest() {
      return null
    },
  }
}

test('service.snapshot scopes columns/timeline to the requested logical while revision stays global', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-eval-console-scope-'))
  try {
    const auditFile = path.join(root, 'ledger.jsonl')
    await writeLedger(auditFile)
    const service = new EvalConsoleHostService({
      registry: mockRegistryFor('evaluate'),
      registryRoot: path.join(root, 'registry'),
      logicalId: 'evaluate',
      auditFile,
      agentPresetsRoot: path.join(root, '.agent-presets'),
    })
    const snap = await service.snapshot('evaluate')
    // The revision counter is the GLOBAL ledger length (SSE semantics).
    assert.equal(snap.revision, LEDGER.length)
    // The board derives from the scoped audit: only the evaluate run/rows.
    const timelineEvents = snap.timeline.map((e) => e.event)
    assert.ok(timelineEvents.includes('created'))
    assert.ok(timelineEvents.includes('sealed'))
    assert.ok(!timelineEvents.includes('rollback-applied'), 'system-evolver rollback must not leak')
    assert.ok(!snap.columns.some((c) => c.rows.some((r) => r.revisionId.startsWith('system-evolver-'))))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('service.snapshot for system-evolver excludes evaluate events (monotonic revision across logicals)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-eval-console-scope-'))
  try {
    const auditFile = path.join(root, 'ledger.jsonl')
    await writeLedger(auditFile)
    const service = new EvalConsoleHostService({
      registry: mockRegistryFor('system-evolver'),
      registryRoot: path.join(root, 'registry'),
      logicalId: 'system-evolver',
      auditFile,
      agentPresetsRoot: path.join(root, '.agent-presets'),
    })
    const evaluateSnap = await service.snapshot('evaluate')
    const evolverSnap = await service.snapshot('system-evolver')
    // Global counter: same ledger length for both scopes, monotonic.
    assert.equal(evaluateSnap.revision, LEDGER.length)
    assert.equal(evolverSnap.revision, LEDGER.length)
    const evolverEvents = evolverSnap.timeline.map((e) => e.event)
    assert.ok(evolverEvents.includes('rollback-applied'))
    assert.ok(!evolverEvents.includes('switch-to-revision'), 'evaluate switch record must not leak')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
