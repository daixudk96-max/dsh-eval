/**
 * Unit tests: six-state model.
 * Run via `node --test test/` (Node 24 type stripping, single process).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EVAL_COLUMNS,
  EVAL_STATUSES,
  STATUS_DOT_TOKEN,
  STATUS_LABEL_EN,
  STATUS_LABEL_ZH,
  isEvalStatus,
  statusFromGateDecision,
  statusLabel,
} from '../src/domain/states.ts'

test('EVAL_STATUSES holds exactly the six columns in display order', () => {
  assert.deepEqual(EVAL_STATUSES, [
    'SEALED',
    'EVALUATING',
    'ACCEPTED',
    'PROMOTED',
    'REJECTED',
    'INCONCLUSIVE',
  ])
})

test('isEvalStatus narrows known statuses and rejects others', () => {
  for (const status of EVAL_STATUSES) assert.equal(isEvalStatus(status), true)
  for (const value of ['DRAFT', 'unknown', '', 42, null, undefined, {}]) {
    assert.equal(isEvalStatus(value), false)
  }
})

test('EVAL_COLUMNS carries status, zh label and a --dsw dot token for all six', () => {
  assert.equal(EVAL_COLUMNS.length, 6)
  for (const column of EVAL_COLUMNS) {
    assert.ok(EVAL_STATUSES.includes(column.status), `unexpected column ${column.status}`)
    assert.equal(column.label, STATUS_LABEL_ZH[column.status])
    assert.equal(column.color, STATUS_DOT_TOKEN[column.status])
    assert.match(column.color, /^var\(--dsw/)
  }
})

test('statusLabel resolves zh by default and en on demand', () => {
  assert.equal(statusLabel('ACCEPTED'), '已通过')
  assert.equal(statusLabel('ACCEPTED', 'en'), 'Accepted')
  assert.equal(statusLabel('PROMOTED', 'en'), STATUS_LABEL_EN.PROMOTED)
})

test('statusFromGateDecision maps PASS/FAIL/INCONCLUSIVE/INVALID', () => {
  assert.equal(statusFromGateDecision('PASS'), 'ACCEPTED')
  assert.equal(statusFromGateDecision('FAIL'), 'REJECTED')
  assert.equal(statusFromGateDecision('INCONCLUSIVE'), 'INCONCLUSIVE')
  assert.equal(statusFromGateDecision('INVALID'), 'SEALED')
  // Unknown decisions fall back to SEALED (or the caller's fallback).
  assert.equal(statusFromGateDecision('BOGUS'), 'SEALED')
  assert.equal(statusFromGateDecision('BOGUS', 'EVALUATING'), 'EVALUATING')
})
