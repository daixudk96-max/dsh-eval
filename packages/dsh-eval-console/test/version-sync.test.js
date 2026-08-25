/**
 * Unit tests: preset version synchronizer (real tempdir filesystem).
 * Run via `node test/version-sync.test.js` (Node 24 type stripping).
 *
 * Covers: fresh write / idempotent skip / foreign-owner refusal / missing-
 * owner refusal / atomic commit (no staging residue) / failure cleanup +
 * backup restore / path-escape refusal / targetId shape / empty files.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OWNER_FILE, OWNER_PACKAGE, syncRevision } from '../src/version-sync.ts'

const DIGEST = '94a7c40b8283ddf70559106c172bb6700b21610711c9ce8376ab04b2164dfe71'
const DIGEST8 = '94a7c40b'
const FILES = {
  'preset.yml': 'model: evaluate-v7\n',
  'prompt/system.txt': 'you are the evaluator\n',
}

async function tmpRoot() {
  return await mkdtemp(path.join(tmpdir(), 'dsh-eval-console-vsync-'))
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function listDir(dir) {
  return (await readdir(dir)).sort()
}

test('writes a fresh directory with owner marker (targetId = <logicalId>-<digest8>)', async () => {
  const root = await tmpRoot()
  try {
    const result = await syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: FILES })
    assert.equal(result.targetId, `evaluate-${DIGEST8}`)
    assert.equal(result.dir, path.join(root, `evaluate-${DIGEST8}`))
    assert.equal(result.existed, false)
    assert.deepEqual(result.written.sort(), Object.keys(FILES).sort())
    assert.deepEqual(result.skipped, [])
    assert.equal(await readFile(path.join(result.dir, 'preset.yml'), 'utf8'), FILES['preset.yml'])
    assert.equal(await readFile(path.join(result.dir, 'prompt/system.txt'), 'utf8'), FILES['prompt/system.txt'])
    const owner = await readJson(path.join(result.dir, OWNER_FILE))
    assert.equal(owner.package, OWNER_PACKAGE)
    assert.equal(owner.kind, 'revision')
    assert.equal(owner.revisionId, `evaluate-${DIGEST8}`)
    assert.equal(owner.digest, DIGEST)
    assert.ok(typeof owner.syncedAt === 'string' && owner.syncedAt !== '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('idempotent: unchanged content is skipped, nothing rewritten', async () => {
  const root = await tmpRoot()
  try {
    const first = await syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: FILES })
    assert.equal(first.written.length, 2)
    const second = await syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: FILES })
    assert.equal(second.existed, true)
    assert.deepEqual(second.written, [])
    assert.deepEqual(second.skipped.sort(), Object.keys(FILES).sort())
    // No staging / backup residue after an atomic commit.
    assert.deepEqual(await listDir(root), [`evaluate-${DIGEST8}`])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses a directory owned by another package', async () => {
  const root = await tmpRoot()
  try {
    const dir = path.join(root, `evaluate-${DIGEST8}`)
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, OWNER_FILE),
      JSON.stringify({ package: 'other-plugin', kind: 'revision', revisionId: 'x', digest: DIGEST, syncedAt: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    )
    await writeFile(path.join(dir, 'preset.yml'), 'foreign content\n', 'utf8')
    await assert.rejects(
      syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: FILES }),
      /refusing to overwrite .*\(owned by other-plugin\)/,
    )
    // Nothing was written; the foreign content is untouched.
    assert.equal(await readFile(path.join(dir, 'preset.yml'), 'utf8'), 'foreign content\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses a directory with a missing owner marker', async () => {
  const root = await tmpRoot()
  try {
    const dir = path.join(root, `evaluate-${DIGEST8}`)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'preset.yml'), 'unowned content\n', 'utf8')
    await assert.rejects(
      syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: FILES }),
      /refusing to overwrite .*\(owned by \(missing\)\)/,
    )
    assert.equal(await readFile(path.join(dir, 'preset.yml'), 'utf8'), 'unowned content\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('atomic commit: existing owned directory is replaced without residue', async () => {
  const root = await tmpRoot()
  try {
    const first = await syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: FILES })
    // Re-sync with a changed file list (simulating content evolution under the same digest-8 dir).
    const changed = { ...FILES, 'preset.yml': 'model: evaluate-v7b\n' }
    const second = await syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: changed })
    assert.equal(second.written.length, 1)
    assert.equal(await readFile(path.join(first.dir, 'preset.yml'), 'utf8'), 'model: evaluate-v7b\n')
    assert.equal(await readFile(path.join(first.dir, 'prompt/system.txt'), 'utf8'), FILES['prompt/system.txt'])
    assert.deepEqual(await listDir(root), [`evaluate-${DIGEST8}`])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failure cleanup: a colliding file/dir pair aborts and restores the previous content', async () => {
  const root = await tmpRoot()
  try {
    const first = await syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: FILES })
    // 'preset.yml' as a file then a nested path under it forces mkdir EEXIST.
    const bad = { 'preset.yml': 'x\n', 'preset.yml/nested.txt': 'y\n' }
    await assert.rejects(
      syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: bad }),
      /EEXIST|already exists|ENOTDIR/,
    )
    // The previous content survived and no staging/backup residue remains.
    assert.equal(await readFile(path.join(first.dir, 'preset.yml'), 'utf8'), FILES['preset.yml'])
    assert.deepEqual(await listDir(root), [`evaluate-${DIGEST8}`])
    assert.deepEqual(await listDir(first.dir), [OWNER_FILE, 'preset.yml', 'prompt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses path-escape keys (dotdot, absolute, drive, backslash, empty segment)', async () => {
  const root = await tmpRoot()
  try {
    for (const bad of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/windows/x', 'a\\b.txt', 'a//b.txt', './a.txt', '']) {
      await assert.rejects(
        syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: { [bad]: 'x' } }),
        /unsafe revision file path/,
        `key ${JSON.stringify(bad)} must be rejected`,
      )
    }
    // The attacker's directory was never created.
    assert.deepEqual(await listDir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('empty files map writes only the owner marker', async () => {
  const root = await tmpRoot()
  try {
    const result = await syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: DIGEST, files: {} })
    assert.equal(result.written.length, 0)
    assert.equal(result.skipped.length, 0)
    assert.deepEqual(await listDir(result.dir), [OWNER_FILE])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects an invalid digest and an unsafe logical id', async () => {
  const root = await tmpRoot()
  try {
    await assert.rejects(
      syncRevision({ agentPresetsRoot: root, logicalId: 'evaluate', digest: 'nope', files: {} }),
      /invalid revision digest/,
    )
    for (const bad of ['', '.', '..', 'a/b']) {
      await assert.rejects(
        syncRevision({ agentPresetsRoot: root, logicalId: bad, digest: DIGEST, files: {} }),
        /unsafe logical id/,
        `logicalId ${JSON.stringify(bad)} must be rejected`,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
