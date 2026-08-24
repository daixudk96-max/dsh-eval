/**
 * Unit tests: audit ledger -> timeline events.
 * Run via `node --test test/` (Node 24 type stripping, single process).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timelineEvents } from '../src/domain/timeline.ts'

const AUDIT = [
  { op: 'audit', ts: '2026-08-23T01:50:00.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'created' },
  { op: 'audit', ts: '2026-08-23T02:00:00.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'sealed', revisionId: 'evaluate-c4d8aec0' },
  { op: 'audit', ts: '2026-08-23T02:04:00.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'gate', from: 'EVALUATING', to: 'ACCEPTED', decision: 'PASS', reason: 'all code gates passed' },
  { op: 'audit', ts: '2026-08-23T02:04:42.000Z', runId: 'evr-mt55ya37-ta3ww5', event: 'promoted', revisionId: 'evaluate-c4d8aec0', approvalId: 'user-approved-p3-governance-2026-08-23' },
  { op: 'audit', ts: '2026-08-23T03:10:00.000Z', runId: 'evr-mt57y2h8-0m3tsl', event: 'gate', from: 'EVALUATING', to: 'INCONCLUSIVE', decision: 'INCONCLUSIVE', reason: 'no significant improvement' },
  { op: 'audit', ts: '2026-08-23T03:20:00.000Z', runId: 'evr-mt57y2h8-0m3tsl', event: 'rollback-applied', targetRevisionId: 'evaluate-ab63a9b7' },
  { op: 'other', ts: '2026-08-23T03:21:00.000Z', runId: 'x', event: 'sealed' }, // non-audit op: surfaced anyway? event still present
]

test('timelineEvents maps gate/promoted/sealed to statuses and details', () => {
  const events = timelineEvents(AUDIT)
  assert.equal(events.length, AUDIT.length) // every record with a usable event name surfaces

  const gate = events.find((event) => event.event === 'gate' && event.runId === 'evr-mt55ya37-ta3ww5')
  assert.equal(gate?.status, 'ACCEPTED')
  assert.match(gate?.detail ?? '', /gate PASS/)
  assert.match(gate?.detail ?? '', /all code gates passed/)

  const inconclusive = events.find((event) => event.event === 'gate' && event.runId === 'evr-mt57y2h8-0m3tsl')
  assert.equal(inconclusive?.status, 'INCONCLUSIVE')
  assert.match(inconclusive?.detail ?? '', /gate INCONCLUSIVE/)

  const promoted = events.find((event) => event.event === 'promoted')
  assert.equal(promoted?.status, 'PROMOTED')
  assert.match(promoted?.detail ?? '', /approval user-approved-p3-governance-2026-08-23/)

  const sealed = events.find((event) => event.event === 'sealed')
  assert.equal(sealed?.status, 'SEALED')
  assert.equal(sealed?.revisionId, 'evaluate-c4d8aec0')

  const rollback = events.find((event) => event.event === 'rollback-applied')
  assert.match(rollback?.detail ?? '', /target evaluate-ab63a9b7/)
})

test('timeline ids are stable per input index', () => {
  const a = timelineEvents(AUDIT)
  const b = timelineEvents(AUDIT)
  assert.deepEqual(a.map((event) => event.id), b.map((event) => event.id))
  assert.deepEqual(a.map((event) => event.id), AUDIT.map((_, index) => `evt-${index}`))
})

test('records without an event name are skipped', () => {
  const events = timelineEvents([
    { op: 'audit', ts: 't', runId: 'r', event: '' },
    { op: 'audit', ts: 't', runId: 'r' },
    { op: 'audit', ts: 't', runId: 'r', event: 'sealed', revisionId: 'x' },
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0]?.event, 'sealed')
})
