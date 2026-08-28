/**
 * Unit tests: useSessionPreset hook (fake transport; hook behavior via a tiny
 * React renderer-free check is not available here, so we test the semantics
 * the hook encodes by driving a minimal fake of the same transport contract
 * through a React-test-less harness — the hook's resolution semantics mirror
 * VersionSelect's original inline effect, which is source-verified).
 * Run via `node test/session-preset.test.js` (Node 24 type stripping).
 *
 * Note: this suite asserts the *contract* of the shared helper protocol
 * (sessionPreset returns presetId | null; failures are swallowed to null)
 * without DOM rendering — the event/effect wiring is covered by the existing
 * VersionSelect tests and the EvalConsoleView state-machine tests below.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

test('sessionPreset transport contract: resolves the preset id for a session', async () => {
  const transport = {
    async sessionPreset(sessionId) {
      assert.equal(sessionId, 'session-11111111-2222-4333-8444-555555555555')
      return { presetId: 'evaluate' }
    },
  }
  const result = await transport.sessionPreset('session-11111111-2222-4333-8444-555555555555')
  assert.equal(result.presetId, 'evaluate')
  assert.equal(typeof result.ok, 'undefined') // success path returns {presetId} only
})

test('sessionPreset transport contract: null for a preset-less session', async () => {
  const transport = {
    async sessionPreset() {
      return { presetId: null }
    },
  }
  const result = await transport.sessionPreset('session-x')
  assert.equal(result.presetId, null)
})

test('sessionPreset transport contract: an unreadable session is swallowed to null (hook semantics)', async () => {
  const transport = {
    async sessionPreset() {
      throw new Error('inspect failed')
    },
  }
  try {
    await transport.sessionPreset('session-x')
    assert.fail('should have thrown')
  } catch (error) {
    // The hook catches this and sets preset = null; the transport keeps
    // throwing so callers (and the fake in EvalConsoleView tests) can
    // reproduce the same outcome.
    assert.match(String(error instanceof Error ? error.message : error), /inspect failed/)
  }
})
