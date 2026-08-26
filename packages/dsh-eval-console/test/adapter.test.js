/**
 * Unit tests: registry + audit -> snapshot adapter.
 * Run via `node --test test/` (Node 24 type stripping, single process).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildColumns,
  buildCurrentBar,
  buildRevisionFacts,
  buildRows,
  buildSnapshot,
  shortDigest,
} from '../src/domain/adapter.ts'

const CURRENT = {
  logicalId: 'evaluate',
  revisionId: 'evaluate-c4d8aec0',
  digest: 'c4d8aec074118ff00fdb19d605f914bfc31aa07116f1733aa0ab8842ef01e6ae',
  gateRunId: 'evr-mt55ya37-ta3ww5',
  approvalId: 'user-approved-p3-governance-2026-08-23',
  resolved: true,
  updatedAt: '2026-08-23T02:04:42.130Z',
}

const HISTORY = [
  { revisionId: 'evaluate-c4d8aec0', digest: CURRENT.digest, status: 'active' },
  { revisionId: 'evaluate-ab63a9b7', digest: 'ab63a9b700000000000000000000000000000000000000000000000000000000', status: 'previous' },
  { revisionId: 'evaluate-8b9b3f03', digest: '8b9b3f0300000000000000000000000000000000000000000000000000000000', status: 'previous' },
  { revisionId: 'evaluate-ab811c74', digest: 'ab811c7400000000000000000000000000000000000000000000000000000000', status: 'previous' },
]

const AUDIT = [
  { op: 'audit', ts: '2026-08-23T01:50:00.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'created' },
  { op: 'audit', ts: '2026-08-23T01:59:50.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'candidate-created', candidateId: 'cand-x1', hypothesis: 'Add an unattended-mode instruction: use the provided session path directly and skip listing/asking.' },
  { op: 'audit', ts: '2026-08-23T02:00:00.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'sealed', revisionId: 'evaluate-c4d8aec0', digest: CURRENT.digest },
  { op: 'audit', ts: '2026-08-23T02:04:00.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'gate', from: 'EVALUATING', to: 'ACCEPTED', decision: 'PASS', reason: 'all code gates passed' },
  { op: 'audit', ts: '2026-08-23T02:04:42.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'promoted', revisionId: 'evaluate-c4d8aec0', digest: CURRENT.digest, approvalId: 'user-approved-p3-governance-2026-08-23' },
  // Audit-only revision: ACCEPTED but never promoted (superseded / near-dup).
  { op: 'audit', ts: '2026-08-22T10:00:00.000Z', runId: 'evr-mt4m0dfc-oqiwc0', event: 'sealed', revisionId: 'evaluate-ceb134ca', digest: 'ceb134ca00000000000000000000000000000000000000000000000000000000' },
  { op: 'audit', ts: '2026-08-22T10:05:00.000Z', runId: 'evr-mt4m0dfc-oqiwc0', event: 'gate', from: 'EVALUATING', to: 'ACCEPTED', decision: 'PASS', reason: 'all code gates passed (overall gain 0.000, efficiency gain 0.286 >= minEffect 0.05)' },
  { op: 'audit', ts: '2026-08-22T10:06:00.000Z', runId: 'evr-mt4m0dfc-oqiwc0', event: 'promote-near-duplicate' },
  // Audit-only revision: INCONCLUSIVE.
  { op: 'audit', ts: '2026-08-23T03:10:00.000Z', runId: 'evr-mt57y2h8-0m3tsl', event: 'sealed', revisionId: 'evaluate-9682331a', digest: '9682331a00000000000000000000000000000000000000000000000000000000' },
  { op: 'audit', ts: '2026-08-23T03:15:00.000Z', runId: 'evr-mt57y2h8-0m3tsl', event: 'gate', from: 'EVALUATING', to: 'INCONCLUSIVE', decision: 'INCONCLUSIVE', reason: 'overall gain 0.000 <= minEffect 0.05 and efficiencyGain 0.000 < minEffect 0.05 (no significant improvement)' },
  // Audit-only revision: REJECTED.
  { op: 'audit', ts: '2026-08-22T08:00:00.000Z', runId: 'evr-reject-001', event: 'sealed', revisionId: 'evaluate-rej001', digest: 'rej0010000000000000000000000000000000000000000000000000000000000' },
  { op: 'audit', ts: '2026-08-22T08:05:00.000Z', runId: 'evr-reject-001', event: 'gate', from: 'EVALUATING', to: 'REJECTED', decision: 'FAIL', reason: 'code gate failed' },
  // Audit-only revision: sealed, no gate -> SEALED.
  { op: 'audit', ts: '2026-08-22T06:00:00.000Z', runId: 'evr-sealonly-001', event: 'sealed', revisionId: 'evaluate-seal001', digest: 'seal001000000000000000000000000000000000000000000000000000000000' },
]

test('shortDigest takes the first 8 hex chars', () => {
  assert.equal(shortDigest('c4d8aec074118ff00fdb19d605f914bfc31aa07116f1733aa0ab8842ef01e6ae'), 'c4d8aec0')
  assert.equal(shortDigest('abc'), 'abc')
})

test('buildRevisionFacts folds sealed/gate/promoted into per-revision facts', () => {
  const facts = buildRevisionFacts(AUDIT)
  const current = facts.get('evaluate-c4d8aec0')
  assert.ok(current !== undefined)
  assert.equal(current.digest, CURRENT.digest)
  assert.equal(current.runId, 'evr-mt55ya37-ta3ww5')
  assert.equal(current.sealedAt, '2026-08-23T02:00:00.000Z')
  assert.equal(current.gate?.to, 'ACCEPTED')
  assert.equal(current.gate?.reason, 'all code gates passed')
  assert.equal(current.promotedAt, '2026-08-23T02:04:42.000Z')
  assert.equal(
    current.hypothesis,
    'Add an unattended-mode instruction: use the provided session path directly and skip listing/asking.',
  )
  // Sealed-only revision: no gate, no promotion.
  const sealOnly = facts.get('evaluate-seal001')
  assert.ok(sealOnly !== undefined)
  assert.equal(sealOnly.gate, undefined)
  assert.equal(sealOnly.promotedAt, undefined)
})

test('buildRows places history in PROMOTED and audit-only revisions by gate', () => {
  const rows = buildRows(HISTORY, AUDIT, CURRENT.revisionId)
  const byId = new Map(rows.map((row) => [row.revisionId, row]))

  const current = byId.get('evaluate-c4d8aec0')
  assert.equal(current?.status, 'PROMOTED')
  assert.equal(current?.isCurrent, true)
  assert.equal(current?.order, 0)

  const previous = byId.get('evaluate-ab63a9b7')
  assert.equal(previous?.status, 'PROMOTED')
  assert.equal(previous?.isCurrent, false)
  assert.equal(previous?.order, 1)

  // Audit-only (not in history) derive their status from the gate outcome.
  assert.equal(byId.get('evaluate-ceb134ca')?.status, 'ACCEPTED')
  assert.equal(byId.get('evaluate-9682331a')?.status, 'INCONCLUSIVE')
  assert.equal(byId.get('evaluate-rej001')?.status, 'REJECTED')
  assert.equal(byId.get('evaluate-seal001')?.status, 'SEALED')

  // Gate reasons ride onto the audit-only rows.
  assert.match(byId.get('evaluate-ceb134ca')?.gateReason ?? '', /efficiency gain 0.286/)
  assert.match(byId.get('evaluate-9682331a')?.gateReason ?? '', /no significant improvement/)
})

test('buildColumns groups rows into exactly six columns in display order', () => {
  const rows = buildRows(HISTORY, AUDIT, CURRENT.revisionId)
  const columns = buildColumns(rows)
  assert.deepEqual(columns.map((column) => column.status), [
    'SEALED', 'EVALUATING', 'ACCEPTED', 'PROMOTED', 'REJECTED', 'INCONCLUSIVE',
  ])
  const promoted = columns.find((column) => column.status === 'PROMOTED')
  assert.equal(promoted?.rows.length, HISTORY.length) // the whole live chain
  const accepted = columns.find((column) => column.status === 'ACCEPTED')
  assert.ok(accepted?.rows.some((row) => row.revisionId === 'evaluate-ceb134ca'))
  // Rows within a column sort by order (current first in PROMOTED).
  assert.equal(promoted?.rows[0]?.revisionId, CURRENT.revisionId)
})

test('buildCurrentBar shapes the pointer (updatedAt surfaced, resolved carried)', () => {
  const bar = buildCurrentBar(CURRENT)
  assert.equal(bar?.logicalId, 'evaluate')
  assert.equal(bar?.revisionId, CURRENT.revisionId)
  assert.equal(bar?.digestShort, 'c4d8aec0')
  assert.equal(bar?.gateRunId, 'evr-mt55ya37-ta3ww5')
  assert.equal(bar?.approvalId, 'user-approved-p3-governance-2026-08-23')
  assert.equal(bar?.updatedAt, '2026-08-23T02:04:42.130Z')
  assert.equal(bar?.resolved, true)
  assert.equal(buildCurrentBar(null), null)
})

test('buildSnapshot assembles the full /eval/state document', () => {
  const snapshot = buildSnapshot({
    logicalId: 'evaluate',
    revision: AUDIT.length,
    current: CURRENT,
    history: HISTORY,
    audit: AUDIT,
    now: () => '2026-08-23T04:00:00.000Z',
  })
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.logicalId, 'evaluate')
  assert.equal(snapshot.revision, AUDIT.length)
  assert.equal(snapshot.generatedAt, '2026-08-23T04:00:00.000Z')
  assert.equal(snapshot.current?.revisionId, CURRENT.revisionId)
  assert.equal(snapshot.history.length, HISTORY.length)
  assert.equal(snapshot.history[0]?.digestShort, 'c4d8aec0')
  // History entries carry audit-derived timestamps (never truncated client-side).
  assert.equal(snapshot.history[0]?.promotedAt, '2026-08-23T02:04:42.000Z')
  assert.equal(snapshot.history[0]?.sealedAt, '2026-08-23T02:00:00.000Z')
  // History entries carry the one-line candidate hypothesis (summary).
  assert.match(snapshot.history[0]?.summary ?? '', /unattended-mode instruction/)
  // Revisions without audit records keep optional timestamps absent.
  assert.equal(snapshot.history[1]?.promotedAt, undefined)
  assert.equal(snapshot.columns.length, 6)
  // Timeline includes sealed/gate/promoted events only (created/proposal noise
  // that the timeline surfaces? created is surfaced too — assert bounded).
  assert.ok(snapshot.timeline.length > 0)
  assert.ok(snapshot.timeline.every((event) => event.id.startsWith('evt-')))
})
