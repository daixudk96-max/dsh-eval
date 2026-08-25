/**
 * Unit tests: client display formatting (fmtTime — seconds never truncated).
 * Run via `node test/format.test.js` (Node 24 type stripping, single process).
 *
 * Assertions are timezone-agnostic (fmtTime renders local time): shape regex
 * + the seconds part, which is the regression this module guards against.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtTime } from '../src/client/format.ts'

const SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

test('fmtTime includes seconds (never truncates to the minute)', () => {
  const out = fmtTime('2026-08-23T02:04:42.130Z')
  assert.match(out, SHAPE)
  assert.ok(out.endsWith(':42'), `expected seconds :42 in ${out}`)
})

test('fmtTime pads hours, minutes and seconds to two digits', () => {
  const out = fmtTime('2026-01-02T03:04:05.000Z')
  assert.match(out, SHAPE)
  assert.ok(out.endsWith(':04:05'), `expected padded :04:05 in ${out}`)
})

test('fmtTime renders local calendar date from the ISO input', () => {
  const iso = '2026-08-23T02:04:42.130Z'
  const date = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  const expected =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  assert.equal(fmtTime(iso), expected)
})

test('fmtTime returns the raw input for invalid dates', () => {
  assert.equal(fmtTime('not-a-date'), 'not-a-date')
  assert.equal(fmtTime(''), '')
})
