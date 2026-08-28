/**
 * Unit tests: EvalConsoleView scoped state machine — the pure phase derivatio
 * (evalViewPhaseOf) driving which board/empty-state the tab renders.
 * Run via `node test/eval-console-view.test.js` (Node 24 type stripping).
 *
 * The phase derivation is pure (no React/DOM): loading / no-preset / no-chain
 * / ready / error are all derived from (preset, snapshot, error) facts, so the
 * tests assert the exact branch the view renders for each state.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evalViewPhaseOf } from '../src/client/session-preset.ts'

const SNAPSHOT = {
  schemaVersion: 1,
  logicalId: 'evaluate',
  revision: 5,
  current: {
    logicalId: 'evaluate',
    revisionId: 'evaluate-11111111',
    digest: '11111111',
    digestShort: '11111111',
    gateRunId: 'evr-1',
    approvalId: 'a1',
    updatedAt: '2026-08-20T00:00:00Z',
    resolved: true,
  },
  history: [{ revisionId: 'evaluate-11111111', digest: '11111111', digestShort: '11111111', status: 'active' }],
  columns: [],
  timeline: [],
  generatedAt: '2026-08-20T00:05:00Z',
}

const EMPTY_SNAPSHOT = {
  schemaVersion: 1,
  logicalId: 'cordis',
  revision: 0,
  current: null,
  history: [],
  columns: [],
  timeline: [],
  generatedAt: '2026-08-20T00:05:00Z',
}

test('phase = loading while the preset is still resolving', () => {
  assert.equal(evalViewPhaseOf(undefined, null, null), 'loading')
  assert.equal(evalViewPhaseOf(undefined, SNAPSHOT, null), 'loading')
})

test('phase = no-preset when the session records no preset', () => {
  assert.equal(evalViewPhaseOf(null, null, null), 'no-preset')
  assert.equal(evalViewPhaseOf(null, SNAPSHOT, null), 'no-preset')
})

test('phase = error when a fetch failed (preset known)', () => {
  assert.equal(evalViewPhaseOf('evaluate', null, 'boom'), 'error')
  assert.equal(evalViewPhaseOf('evaluate', SNAPSHOT, 'boom'), 'error')
})

test('phase = no-chain for a preset id with an empty registry chain', () => {
  assert.equal(evalViewPhaseOf('cordis', EMPTY_SNAPSHOT, null), 'no-chain')
  assert.equal(evalViewPhaseOf('deep-mindmap', EMPTY_SNAPSHOT, null), 'no-chain')
})

test('phase = ready when the scoped snapshot has a current or history', () => {
  assert.equal(evalViewPhaseOf('evaluate', SNAPSHOT, null), 'ready')
  const historyOnly = { ...SNAPSHOT, current: null }
  assert.equal(evalViewPhaseOf('evaluate', historyOnly, null), 'ready')
})
