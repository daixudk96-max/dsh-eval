'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../lib/registry');
const { appendLedger } = require('../lib/fs-store');

async function makeRegistry(t, { adapter } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'preset-registry-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const registry = new Registry({
    root,
    agentPresets: adapter || null,
    rollbackWindow: 3,
  });
  return { registry, root };
}

/** Helper: create a DRAFT candidate from a source, patch, seal. */
async function makeSealed(registry, logicalId, { sourceRevisionId = 'src-1', evolutionRunId = 'ev-1', mutations = [{ kind: 'prompt', op: 'rewrite' }] } = {}) {
  const candidateId = await registry.createCandidate(logicalId, { sourceRevisionId, evolutionRunId });
  await registry.patchCandidate(candidateId, mutations[0]);
  return registry.sealRevision(candidateId); // { revisionId, digest }
}

test('resolveCurrent returns stable current revision', async (t) => {
  const { registry } = await makeRegistry(t);
  const first = await makeSealed(registry, 'coding');
  await registry.promote('coding', { targetRevision: first.revisionId, candidateDigest: first.digest, gateRunId: 'g1', approvalId: 'a1' });
  const resolved = await registry.resolveCurrent('coding');
  assert.equal(resolved.revisionId, first.revisionId);
  assert.equal(resolved.digest, first.digest);
  assert.equal(resolved.gateRunId, 'g1', 'gate run that promoted the revision is exposed');
  assert.equal(resolved.approvalId, 'a1', 'approval binding of the promotion is exposed');
  const again = await registry.resolveCurrent('coding');
  assert.equal(again.revisionId, resolved.revisionId);
});

test('sealed revision is immutable: digest verification detects tampering', async (t) => {
  const { registry } = await makeRegistry(t);
  const sealed = await makeSealed(registry, 'coding');
  let check = await registry.verifyRevisionDigest(sealed.digest);
  assert.equal(check.ok, true);
  // tamper: modify the manifest inside revisions/<digest>/
  const revDir = path.join(registry.root, 'revisions', sealed.digest);
  const manifestPath = path.join(revDir, 'manifest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  manifest.mutations = [{ kind: 'prompt', op: 'evil-rewrite' }];
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  check = await registry.verifyRevisionDigest(sealed.digest);
  assert.equal(check.ok, false);
});

test('concurrent promotes: exactly one succeeds (CAS)', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await makeSealed(registry, 'coding');
  await registry.promote('coding', { targetRevision: v1.revisionId, candidateDigest: v1.digest, gateRunId: 'g0', approvalId: 'a0' });
  const v2 = await makeSealed(registry, 'coding', { sourceRevisionId: 'src-2', mutations: [{ kind: 'prompt', op: 'b' }] });
  const v3 = await makeSealed(registry, 'coding', { sourceRevisionId: 'src-3', mutations: [{ kind: 'prompt', op: 'c' }] });
  const expectedCurrent = { revisionId: v1.revisionId, digest: v1.digest };
  const results = await Promise.allSettled([
    registry.promote('coding', { expectedCurrent, targetRevision: v2.revisionId, candidateDigest: v2.digest, gateRunId: 'g2', approvalId: 'a2' }),
    registry.promote('coding', { expectedCurrent, targetRevision: v3.revisionId, candidateDigest: v3.digest, gateRunId: 'g3', approvalId: 'a3' }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1, 'exactly one promote must succeed');
  assert.equal(failed.length, 1, 'the loser must be rejected');
  const current = await registry.resolveCurrent('coding');
  // current must be the winner (whichever won), not corrupted
  assert.ok([v2.revisionId, v3.revisionId].includes(current.revisionId));
});

test('crash recovery: stray .tmp removed and WAL replays missing pointer', async (t) => {
  const { registry, root } = await makeRegistry(t);
  const v1 = await makeSealed(registry, 'coding');
  await registry.promote('coding', { targetRevision: v1.revisionId, candidateDigest: v1.digest, gateRunId: 'g1', approvalId: 'a1' });
  // simulate crash: write a ledger promote entry for v2 but delete the pointer (write happened, rename lost)
  const v2 = await makeSealed(registry, 'coding', { sourceRevisionId: 'src-2', mutations: [{ kind: 'prompt', op: 'x' }] });
  const ts = new Date(Date.now() + 1000).toISOString();
  await appendLedger(path.join(root, 'ledger'), { op: 'promote', logicalId: 'coding', targetRevision: v2.revisionId, candidateDigest: v2.digest, gateRunId: 'g2', approvalId: 'a2', ts });
  await fsp.writeFile(path.join(root, 'pointers', 'coding.current.json.tmp'), 'junk', 'utf8');
  await fsp.rm(path.join(root, 'pointers', 'coding.current.json'));
  // reopen a fresh registry instance over the same root (recovery runs in _ensure)
  const fresh = new Registry({ root });
  const resolved = await fresh.resolveCurrent('coding');
  assert.ok(resolved, 'pointer must be recovered');
  assert.equal(resolved.revisionId, v2.revisionId, 'WAL replay must restore the last promote');
  assert.equal(resolved.gateRunId, 'g2', 'WAL replay restores the gate run binding');
  assert.equal(resolved.approvalId, 'a2', 'WAL replay restores the approval binding');
});

test('gcCandidates removes only unsealed DRAFT candidates, never sealed ones', async (t) => {
  const { registry } = await makeRegistry(t);
  const sealed = await makeSealed(registry, 'coding');
  await registry.promote('coding', { targetRevision: sealed.revisionId, candidateDigest: sealed.digest, gateRunId: 'g1', approvalId: 'a1' });
  const draftId = await registry.createCandidate('coding', { sourceRevisionId: sealed.revisionId, evolutionRunId: 'ev-2' });
  const removed = await registry.gcCandidates();
  assert.equal(removed, 1, 'only the DRAFT candidate is removable');
  // sealed candidate dir must still exist (owns the immutable revision)
  const staging = path.join(registry.root, 'staging');
  const entries = await fsp.readdir(staging);
  assert.ok(entries.some((n) => n.startsWith('cand-')), 'sealed candidate dir remains');
  // the promoted revision still resolves
  const current = await registry.resolveCurrent('coding');
  assert.equal(current.revisionId, sealed.revisionId);
  void draftId;
});

test('rollback is O(1) pointer switch and history stays intact', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await makeSealed(registry, 'coding', { mutations: [{ kind: 'prompt', op: 'a' }] });
  await registry.promote('coding', { targetRevision: v1.revisionId, candidateDigest: v1.digest, gateRunId: 'g1', approvalId: 'a1' });
  const v2 = await makeSealed(registry, 'coding', { sourceRevisionId: 'src-2', mutations: [{ kind: 'prompt', op: 'b' }] });
  await registry.promote('coding', { targetRevision: v2.revisionId, candidateDigest: v2.digest, gateRunId: 'g2', approvalId: 'a2' });
  let history = await registry.history('coding');
  assert.equal(history.length, 2);
  await registry.rollback('coding', v1.revisionId);
  const current = await registry.resolveCurrent('coding');
  assert.equal(current.revisionId, v1.revisionId);
  history = await registry.history('coding');
  assert.equal(history.length, 2, 'rollback must not delete history');
});

test('old-session pinning: adapter resolve honors pinned generation', async (t) => {
  const generations = new Map(); // revisionId -> revision record
  const adapter = {
    copy: async (src, dir) => fsp.writeFile(path.join(dir, 'src-copy.txt'), src, 'utf8'),
    resolve: async (revisionId) => {
      const rec = generations.get(revisionId);
      return rec ? { revisionId, digest: rec.digest, generation: rec.generation } : null;
    },
  };
  const { registry } = await makeRegistry(t, { adapter });
  const v1 = await makeSealed(registry, 'coding');
  generations.set(v1.revisionId, { ...v1, generation: 'gen-1' });
  await registry.promote('coding', { targetRevision: v1.revisionId, candidateDigest: v1.digest, gateRunId: 'g1', approvalId: 'a1' });
  // old session pinned to v1; new current becomes v2
  const v2 = await makeSealed(registry, 'coding', { sourceRevisionId: 'src-2', mutations: [{ kind: 'prompt', op: 'z' }] });
  generations.set(v2.revisionId, { ...v2, generation: 'gen-2' });
  await registry.promote('coding', { targetRevision: v2.revisionId, candidateDigest: v2.digest, gateRunId: 'g2', approvalId: 'a2' });
  // new session resolves current = v2
  const current = await registry.resolveCurrent('coding');
  assert.equal(current.revisionId, v2.revisionId);
  // old session keeps v1 (simulate via adapter resolve of pinned revision)
  const old = await adapter.resolve(v1.revisionId);
  assert.equal(old.revisionId, v1.revisionId);
  assert.equal(old.generation, 'gen-1');
});

test('promote validates sealed target and CAS digest', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await makeSealed(registry, 'coding');
  await registry.promote('coding', { targetRevision: v1.revisionId, candidateDigest: v1.digest, gateRunId: 'g1', approvalId: 'a1' });
  // unsealed digest must be rejected
  await assert.rejects(
    () => registry.promote('coding', { targetRevision: 'coding-unknown', candidateDigest: '0'.repeat(64), gateRunId: 'g2', approvalId: 'a2' }),
    /not sealed/,
  );
  // wrong expectedCurrent must be rejected
  const v2 = await makeSealed(registry, 'coding', { sourceRevisionId: 'src-2' });
  await assert.rejects(
    () => registry.promote('coding', { expectedCurrent: { revisionId: 'nope', digest: 'deadbeef' }, targetRevision: v2.revisionId, candidateDigest: v2.digest, gateRunId: 'g3', approvalId: 'a3' }),
    /CAS failed/,
  );
});
