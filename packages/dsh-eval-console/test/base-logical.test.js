/**
 * Unit tests: baseLogicalId — versioned preset dir id -> registry logical id.
 * Run via `node test/base-logical.test.js` (Node 24 type stripping).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseLogicalId } from '../src/host-routes.ts'

test('strips a hex-8 suffix from a versioned preset dir id', () => {
  assert.equal(baseLogicalId('evaluate-0c3922a0'), 'evaluate')
  assert.equal(baseLogicalId('system-evolver-5fac7f0b'), 'system-evolver')
  assert.equal(baseLogicalId('evaluate-94a7c40b'), 'evaluate')
})

test('returns null when there is no hex-8 suffix', () => {
  assert.equal(baseLogicalId('evaluate'), null)
  assert.equal(baseLogicalId('evaluate-0c3922a'), null)
  assert.equal(baseLogicalId('evaluate-xyz12345'), null)
  assert.equal(baseLogicalId('evaluate-0c3922a0-extra'), null)
  assert.equal(baseLogicalId(''), null)
  // A bare 8-hex tail with no dash is not a versioned dir id.
  assert.equal(baseLogicalId('0c3922a0'), null)
})

test('keeps multi-dash ids: only the final 8-hex segment is stripped', () => {
  assert.equal(baseLogicalId('a-b-c-1234abcd'), 'a-b-c')
  assert.equal(baseLogicalId('a-b-c-1234abcd-'), null)
})
