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
