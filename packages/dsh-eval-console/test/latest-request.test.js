/**
 * Unit tests: LatestRequestController — the "only the most recent request may
 * land" guard shared by useSessionPreset / useEvalState / VersionSelect.refresh
 * (review F2/F3). Pure, no DOM/React, so the race semantics are testable
 * directly: an old request that resolves after a newer one must be stale.
 * Run via `node test/latest-request.test.js` (Node 24 type stripping).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LatestRequestController } from '../src/client/latest-request.ts'

test('begin() invalidates the previous scope; isStale reflects the latest', () => {
  const c = new LatestRequestController()
  const a = c.begin()
  assert.equal(c.isStale(a), false)
  const b = c.begin()
  assert.equal(c.isStale(a), true, 'older scope becomes stale after a new begin')
  assert.equal(c.isStale(b), false)
})

test('an old request resolving after a newer one is ignored (the F2/F3 race)', () => {
  const c = new LatestRequestController()
  // Simulate: request A (old session) starts, then request B (new session).
  const scopeA = c.begin()
  const scopeB = c.begin()
  // B resolves first and lands.
  assert.equal(c.isStale(scopeB), false)
  // A resolves late — it must be stale and must not overwrite B.
  assert.equal(c.isStale(scopeA), true)
})

test('invalidate() makes every in-flight scope stale (unmount/cleanup)', () => {
  const c = new LatestRequestController()
  const scope = c.begin()
  assert.equal(c.isStale(scope), false)
  c.invalidate()
  assert.equal(c.isStale(scope), true)
})

test('count() is monotonic across begin() calls', () => {
  const c = new LatestRequestController()
  assert.equal(c.count(), 0)
  c.begin()
  c.begin()
  c.begin()
  assert.equal(c.count(), 3)
})

test('a fresh controller has no current scope (all scopes stale)', () => {
  const c = new LatestRequestController()
  assert.equal(c.isStale({ id: 1 }), true)
})
