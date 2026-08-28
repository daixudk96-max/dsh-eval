/**
 * Unit tests: EvalConsoleHostService.apply() switch-revision branch.
 * Run via `node test/service.test.js` (Node 24 type stripping).
 *
 * Uses a mock RegistryLike (resolveCurrent/history/revisionContent) plus real
 * tempdirs for the audit ledger and the agent-presets root, asserting the
 * full call chain: digestForRevision -> revisionContent -> syncRevision ->
 * audit line append, and the returned payload shape.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EvalConsoleHostService } from '../src/host-service.ts'
import { readAuditEntries } from '../src/audit.ts'
import { OWNER_FILE } from '../src/version-sync.ts'

const LOGICAL = 'evaluate'
const CURRENT_REV = 'evaluate-94a7c40b'
const PREV_REV = 'evaluate-ab63a9b7'
const CURRENT_DIGEST = '94a7c40b8283ddf70559106c172bb6700b21610711c9ce8376ab04b2164dfe71'
const PREV_DIGEST = 'ab63a9b700000000000000000000000000000000000000000000000000000000'
const FILES = {
  'preset.yml': 'model: evaluate-v7\n',
  'prompt/system.txt': 'you are the evaluator\n',
}

function mockRegistry() {
  const calls = { resolveCurrent: 0, history: 0, revisionContent: 0 }
  return {
    calls,
    async resolveCurrent(logicalId) {
      calls.resolveCurrent += 1
      assert.equal(logicalId, LOGICAL)
      return {
        logicalId,
        revisionId: CURRENT_REV,
        digest: CURRENT_DIGEST,
        gateRunId: 'evr-mt55ya37-ta3ww5',
        approvalId: 'user-approved-p3-governance-2026-08-23',
        resolved: true,
      }
    },
    async history(logicalId) {
      calls.history += 1
      assert.equal(logicalId, LOGICAL)
      return [
        { revisionId: CURRENT_REV, digest: CURRENT_DIGEST, status: 'active' },
        { revisionId: PREV_REV, digest: PREV_DIGEST, status: 'previous' },
      ]
    },
    async revisionContent(digest) {
      calls.revisionContent += 1
      assert.equal(digest, PREV_DIGEST)
      return { files: FILES, text: Object.values(FILES).join('\n') }
    },
    async revisionManifest() {
      return null
    },
  }
}

async function tmpDirs() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-eval-console-svc-'))
  return {
    root,
    auditFile: path.join(root, 'ledger.jsonl'),
    agentPresetsRoot: path.join(root, '.agent-presets'),
  }
}

test('switch-revision: full call chain + audit line + payload', async () => {
  const dirs = await tmpDirs()
  try {
    const registry = mockRegistry()
    const service = new EvalConsoleHostService({
      registry,
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    const result = await service.apply('req-1', { kind: 'switch-revision', revisionId: PREV_REV })

    assert.equal(result.ok, true)
    assert.equal(result.action, 'switch-revision')
    assert.equal(result.revisionId, PREV_REV)
    assert.equal(result.digest, PREV_DIGEST)
    assert.equal(result.targetDir, path.join(dirs.agentPresetsRoot, PREV_REV))
    assert.deepEqual(result.files, FILES)
    // digestForRevision resolves the previous revision via history (current mismatch).
    assert.equal(registry.calls.resolveCurrent, 1)
    assert.equal(registry.calls.history, 1)
    assert.equal(registry.calls.revisionContent, 1)

    // The synced directory exists with the revision files + owner marker.
    const dir = result.targetDir
    assert.equal(await readFile(path.join(dir, 'preset.yml'), 'utf8'), FILES['preset.yml'])
    assert.equal(await readFile(path.join(dir, 'prompt/system.txt'), 'utf8'), FILES['prompt/system.txt'])
    const owner = JSON.parse(await readFile(path.join(dir, OWNER_FILE), 'utf8'))
    assert.equal(owner.package, 'dsh-eval-console')
    assert.equal(owner.revisionId, PREV_REV)
    assert.equal(owner.digest, PREV_DIGEST)

    // The audit ledger gained exactly one parseable switch-to-revision record.
    const entries = await readAuditEntries(dirs.auditFile)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].op, 'audit')
    assert.equal(entries[0].event, 'switch-to-revision')
    assert.equal(entries[0].logicalId, LOGICAL)
    assert.equal(entries[0].revisionId, PREV_REV)
    assert.equal(entries[0].digest, PREV_DIGEST)
    assert.equal(entries[0].targetDir, dir)
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('switch-revision: unknown revision throws, nothing synced or appended', async () => {
  const dirs = await tmpDirs()
  try {
    const registry = mockRegistry()
    const service = new EvalConsoleHostService({
      registry,
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    await assert.rejects(
      service.apply('req-2', { kind: 'switch-revision', revisionId: 'evaluate-unknown00' }),
      /unknown revision: evaluate-unknown00/,
    )
    // No sync happened (no directory) and no audit line was appended.
    assert.deepEqual(await readdir(dirs.agentPresetsRoot).catch(() => []), [])
    assert.deepEqual(await readAuditEntries(dirs.auditFile), [])
    assert.equal(registry.calls.revisionContent, 0)
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('switch-revision: sync is idempotent — second apply appends no files but audits again', async () => {
  const dirs = await tmpDirs()
  try {
    const registry = mockRegistry()
    const service = new EvalConsoleHostService({
      registry,
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    const first = await service.apply('req-1', { kind: 'switch-revision', revisionId: PREV_REV })
    const second = await service.apply('req-2', { kind: 'switch-revision', revisionId: PREV_REV })
    assert.equal(second.ok, true)
    assert.equal(second.targetDir, first.targetDir)
    // Both runs audit (each is a user-intent switch), ledger has 2 records.
    const entries = await readAuditEntries(dirs.auditFile)
    assert.equal(entries.length, 2)
    assert.equal(entries[1].event, 'switch-to-revision')
    // Directory still has no residue.
    assert.deepEqual((await readdir(dirs.agentPresetsRoot)).sort(), [PREV_REV])
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('switch-revision: missing revision content throws', async () => {
  const dirs = await tmpDirs()
  try {
    const registry = {
      ...mockRegistry(),
      async revisionContent() {
        return null
      },
    }
    const service = new EvalConsoleHostService({
      registry,
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    await assert.rejects(
      service.apply('req-3', { kind: 'switch-revision', revisionId: PREV_REV }),
      /revision content unavailable: ab63a9b7/,
    )
    assert.deepEqual(await readdir(dirs.agentPresetsRoot).catch(() => []), [])
    assert.deepEqual(await readAuditEntries(dirs.auditFile), [])
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('sessionPresetOf: last agent-preset/selected event wins (newest first scan)', async () => {
  const dirs = await tmpDirs()
  try {
    const persistence = {
      async inspect(sessionId) {
        // The id is passed through verbatim — DSH session ids carry the
        // 'session-' prefix in the header id itself, and inspect keys on it.
        assert.equal(sessionId, 'session-11111111-2222-4333-8444-555555555555')
        return {
          meta: { agentPreset: 'older-preset' },
          events: [
            { type: 'agent-preset/selected', seq: 1, data: { agentPreset: 'first' } },
            { type: 'something-else', seq: 2 },
            { type: 'agent-preset/selected', seq: 3, data: { agentPreset: 'evaluate' } },
          ],
        }
      },
    }
    const service = new EvalConsoleHostService({
      registry: mockRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
      sessionPersistence: persistence,
    })
    assert.equal(await service.sessionPresetOf('session-11111111-2222-4333-8444-555555555555'), 'evaluate')
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('sessionPresetOf: no event falls back to the header meta.agentPreset', async () => {
  const dirs = await tmpDirs()
  try {
    const persistence = {
      async inspect() {
        return { meta: { agentPreset: 'deep-mindmap' }, events: [] }
      },
    }
    const service = new EvalConsoleHostService({
      registry: mockRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
      sessionPersistence: persistence,
    })
    assert.equal(await service.sessionPresetOf('any'), 'deep-mindmap')
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('sessionPresetOf: unreadable session or missing service yields null', async () => {
  const dirs = await tmpDirs()
  try {
    // inspect returns null → null.
    const nullPersistence = {
      async inspect() {
        return null
      },
    }
    const serviceWithNull = new EvalConsoleHostService({
      registry: mockRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
      sessionPersistence: nullPersistence,
    })
    assert.equal(await serviceWithNull.sessionPresetOf('any'), null)

    // inspect throws → null.
    const throwingPersistence = {
      async inspect() {
        throw new Error('boom')
      },
    }
    const serviceWithThrow = new EvalConsoleHostService({
      registry: mockRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
      sessionPersistence: throwingPersistence,
    })
    assert.equal(await serviceWithThrow.sessionPresetOf('any'), null)

    // No persistence service at all → null.
    const bareService = new EvalConsoleHostService({
      registry: mockRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    assert.equal(await bareService.sessionPresetOf('any'), null)
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('sessionPresetOf: no agentPreset anywhere yields null', async () => {
  const dirs = await tmpDirs()
  try {
    const persistence = {
      async inspect() {
        return {
          meta: { id: 'some-session' },
          events: [{ type: 'agent-message', data: {} }],
        }
      },
    }
    const service = new EvalConsoleHostService({
      registry: mockRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
      sessionPersistence: persistence,
    })
    assert.equal(await service.sessionPresetOf('any'), null)
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('snapshot: per-logical query — preset without a chain yields current null + empty history', async () => {
  const dirs = await tmpDirs()
  try {
    const seen = []
    const registry = {
      async resolveCurrent(logicalId) {
        seen.push(`resolve:${logicalId}`)
        return null
      },
      async history(logicalId) {
        seen.push(`history:${logicalId}`)
        return []
      },
    }
    const service = new EvalConsoleHostService({
      registry,
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    const snap = await service.snapshot('deep-mindmap')
    // The requested logical is what the registry was asked about...
    assert.deepEqual(seen.sort(), ['history:deep-mindmap', 'resolve:deep-mindmap'])
    // ...and the snapshot reports that logical with no version data.
    assert.equal(snap.logicalId, 'deep-mindmap')
    assert.equal(snap.current, null)
    assert.deepEqual(snap.history, [])
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('snapshot: defaults to the configured logical when the id is omitted', async () => {
  const dirs = await tmpDirs()
  try {
    const seen = []
    const registry = {
      async resolveCurrent(logicalId) {
        seen.push(`resolve:${logicalId}`)
        return null
      },
      async history(logicalId) {
        seen.push(`history:${logicalId}`)
        return []
      },
    }
    const service = new EvalConsoleHostService({
      registry,
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    const snap = await service.snapshot()
    assert.equal(snap.logicalId, LOGICAL)
    assert.deepEqual(seen.sort(), ['history:evaluate', 'resolve:evaluate'])
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('switch-revision: manifest mutations become the change note on the synced preset.yml', async () => {
  const dirs = await tmpDirs()
  try {
    const registry = {
      async resolveCurrent() {
        return { logicalId: LOGICAL, revisionId: CURRENT_REV, digest: CURRENT_DIGEST, gateRunId: null, approvalId: null, resolved: true }
      },
      async history() {
        return [
          { revisionId: CURRENT_REV, digest: CURRENT_DIGEST, status: 'active' },
          { revisionId: PREV_REV, digest: PREV_DIGEST, status: 'previous' },
        ]
      },
      async revisionContent() {
        return {
          files: { 'preset.yml': 'name: 评测\ndescription: 评测 DSH 会话与基准。\norder: 2\n' },
          text: 'name: 评测\ndescription: 评测 DSH 会话与基准。\norder: 2\n',
        }
      },
      async revisionManifest() {
        return {
          mutations: [
            { summary: 'tool-fs-search 补 config.sampleOverCapGlobResults: false' },
            { summary: 'tool-todo 补 config.allowParallelInProgress: true' },
            { file: 'agent.cordis.yml' },
          ],
        }
      },
    }
    const service = new EvalConsoleHostService({
      registry,
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: LOGICAL,
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    const result = await service.apply('req-note', { kind: 'switch-revision', revisionId: PREV_REV })
    assert.equal(result.action, 'switch-revision')
    const written = await readFile(path.join(result.targetDir, 'preset.yml'), 'utf8')
    assert.match(written, /^name: 评测 · ab63a9b7$/m)
    assert.match(
      written,
      /本版变更: tool-fs-search 补 config\.sampleOverCapGlobResults: false; tool-todo 补 config\.allowParallelInProgress: true/,
    )
    // The audit line records the switch with the digest.
    const audit = await readAuditEntries(dirs.auditFile)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].event, 'switch-to-revision')
    assert.equal(audit[0].digest, PREV_DIGEST)
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

// ---- Cross-logical write actions (review F1): a non-evaluate preset's
// detail / switch-revision must resolve and sync under ITS OWN logical id,
// never the config default 'evaluate'. ----

const EVOLVER_REV = 'system-evolver-5fac7f0b'
const EVOLVER_DIGEST = '5fac7f0b00000000000000000000000000000000000000000000000000000000'
const EVOLVER_FILES = { 'preset.yml': 'name: 进化工作台\n', 'agent.cordis.yml': 'rows\n' }

function evolverRegistry() {
  return {
    async resolveCurrent(id) {
      return id === 'system-evolver'
        ? { logicalId: id, revisionId: EVOLVER_REV, digest: EVOLVER_DIGEST, gateRunId: 'evr-2', approvalId: 'a2', resolved: true }
        : null
    },
    async history(id) {
      return id === 'system-evolver'
        ? [{ revisionId: EVOLVER_REV, digest: EVOLVER_DIGEST, digestShort: '5fac7f0b', status: 'active' }]
        : []
    },
    async revisionContent(digest) {
      assert.equal(digest, EVOLVER_DIGEST)
      return { files: EVOLVER_FILES, text: Object.values(EVOLVER_FILES).join('\n') }
    },
    async revisionManifest() {
      return { mutations: [{ summary: 'wire evolution tools' }] }
    },
  }
}

test('detail: a system-evolver revision resolves under its own logical, not evaluate', async () => {
  const dirs = await tmpDirs()
  try {
    const service = new EvalConsoleHostService({
      registry: evolverRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: 'evaluate', // config default is evaluate — must NOT be used
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    const result = await service.apply('req-evolver-detail', { kind: 'detail', revisionId: EVOLVER_REV })
    assert.equal(result.action, 'detail')
    assert.equal(result.digest, EVOLVER_DIGEST)
    assert.deepEqual(result.files, EVOLVER_FILES)
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('switch-revision: a system-evolver revision syncs to system-evolver-<digest8>, never evaluate', async () => {
  const dirs = await tmpDirs()
  try {
    const service = new EvalConsoleHostService({
      registry: evolverRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: 'evaluate',
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    const result = await service.apply('req-evolver-switch', { kind: 'switch-revision', revisionId: EVOLVER_REV })
    assert.equal(result.action, 'switch-revision')
    // The target directory is the evolver's own, not evaluate's.
    assert.equal(result.targetDir, path.join(dirs.agentPresetsRoot, 'system-evolver-5fac7f0b'))
    assert.ok(!result.targetDir.includes('evaluate-'), 'must not write into an evaluate-* directory')
    // The audit record carries the evolver logical id.
    const audit = await readAuditEntries(dirs.auditFile)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].event, 'switch-to-revision')
    assert.equal(audit[0].logicalId, 'system-evolver')
    assert.equal(audit[0].revisionId, EVOLVER_REV)
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})

test('rollback: a revision whose derived logical mismatches the action logicalId is refused', async () => {
  const dirs = await tmpDirs()
  try {
    const service = new EvalConsoleHostService({
      registry: evolverRegistry(),
      registryRoot: path.join(dirs.root, 'registry'),
      logicalId: 'evaluate',
      auditFile: dirs.auditFile,
      agentPresetsRoot: dirs.agentPresetsRoot,
    })
    // action.logicalId = evaluate, but the revision derives system-evolver.
    await assert.rejects(
      service.apply('req-mismatch', { kind: 'rollback', logicalId: 'evaluate', revisionId: EVOLVER_REV, confirm: `ROLLBACK:${EVOLVER_REV}` }),
      /rollback logicalId mismatch: evaluate != system-evolver/,
    )
    // Nothing was written to the ledger.
    assert.deepEqual(await readAuditEntries(dirs.auditFile), [])
  } finally {
    await rm(dirs.root, { recursive: true, force: true })
  }
})
