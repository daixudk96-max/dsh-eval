/**
 * Unit tests: /eval action-envelope parsing + rollback confirm token.
 * Run via `node --test test/` (Node 24 type stripping, single process).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EVAL_API_PREFIX,
  EVAL_SCHEMA_VERSION,
  parseActionEnvelope,
  rollbackConfirmToken,
} from '../src/domain/protocol.ts'

test('constants', () => {
  assert.equal(EVAL_SCHEMA_VERSION, 1)
  assert.equal(EVAL_API_PREFIX, '/eval')
})

test('rollbackConfirmToken is ROLLBACK:<revisionId>', () => {
  assert.equal(rollbackConfirmToken('evaluate-abc'), 'ROLLBACK:evaluate-abc')
})

test('accepts a valid detail envelope', () => {
  const parsed = parseActionEnvelope({ requestId: 'r1', action: { kind: 'detail', revisionId: 'evaluate-x' } })
  assert.deepEqual(parsed, { requestId: 'r1', action: { kind: 'detail', revisionId: 'evaluate-x' } })
})

test('accepts a valid rollback envelope with the exact confirm token', () => {
  const revisionId = 'evaluate-old'
  const parsed = parseActionEnvelope({
    requestId: 'r2',
    action: { kind: 'rollback', logicalId: 'evaluate', revisionId, confirm: rollbackConfirmToken(revisionId) },
  })
  assert.deepEqual(parsed?.action, { kind: 'rollback', logicalId: 'evaluate', revisionId, confirm: `ROLLBACK:${revisionId}` })
})

test('accepts a valid refresh envelope', () => {
  const parsed = parseActionEnvelope({ requestId: 'r3', action: { kind: 'refresh' } })
  assert.deepEqual(parsed, { requestId: 'r3', action: { kind: 'refresh' } })
})

test('accepts a valid switch-revision envelope (exactKeys 2 keys, no confirm)', () => {
  const parsed = parseActionEnvelope({ requestId: 'r5', action: { kind: 'switch-revision', revisionId: 'evaluate-94a7c40b' } })
  assert.deepEqual(parsed, {
    requestId: 'r5',
    action: { kind: 'switch-revision', revisionId: 'evaluate-94a7c40b' },
  })
})

test('rejects switch-revision with missing/extra keys or an empty revisionId', () => {
  assert.equal(parseActionEnvelope({ requestId: 'r5', action: { kind: 'switch-revision' } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r5', action: { kind: 'switch-revision', revisionId: '' } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r5', action: { kind: 'switch-revision', revisionId: 'x', extra: 1 } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r5', action: { kind: 'switch-revision', revisionId: 42 } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r5', action: { kind: 'switch-revision', revisionId: 'x', confirm: 'ROLLBACK:x' } }), undefined)
})

test('rejects rollback with a mismatched confirm token (read-only-first guard)', () => {
  const revisionId = 'evaluate-old'
  for (const confirm of ['', 'ROLLBACK:other', 'rollback:evaluate-old', revisionId, '   ']) {
    assert.equal(
      parseActionEnvelope({ requestId: 'r4', action: { kind: 'rollback', logicalId: 'evaluate', revisionId, confirm } }),
      undefined,
      `confirm=${JSON.stringify(confirm)} must be rejected`,
    )
  }
})

test('rejects malformed envelopes', () => {
  assert.equal(parseActionEnvelope(undefined), undefined)
  assert.equal(parseActionEnvelope(null), undefined)
  assert.equal(parseActionEnvelope('nope'), undefined)
  assert.equal(parseActionEnvelope([]), undefined)
  assert.equal(parseActionEnvelope({}), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r' }), undefined)
  assert.equal(parseActionEnvelope({ action: { kind: 'refresh' } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: '', action: { kind: 'refresh' } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r', action: {} }), undefined)
})

test('rejects unknown kinds and extra keys (strict exactKeys)', () => {
  assert.equal(parseActionEnvelope({ requestId: 'r', action: { kind: 'promote', revisionId: 'x' } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r', action: { kind: 'refresh', extra: 1 } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r', extra: 1, action: { kind: 'refresh' } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r', action: { kind: 'detail' } }), undefined)
  assert.equal(parseActionEnvelope({ requestId: 'r', action: { kind: 'detail', revisionId: '' } }), undefined)
})
