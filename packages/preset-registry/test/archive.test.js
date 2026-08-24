'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../lib/registry');

async function makeRoot(t, label) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `evc-${label}-`));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

async function seedRegistry(registry, logicalId = 'coding', files = { 'preset.yml': 'name: coding\n' }) {
  const candidateId = await registry.createCandidate(logicalId, { sourceRevisionId: null, evolutionRunId: 'seed' });
  const dir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
  }
  const sealed = await registry.sealRevision(candidateId);
  await registry.promote(logicalId, {
    expectedCurrent: null, targetRevision: sealed.revisionId, candidateDigest: sealed.digest,
    gateRunId: 'seed-gate', approvalId: 'seed-approved',
  });
  return sealed;
}

test('archive: export → import into a new root preserves everything (AC4)', async (t) => {
  const srcRoot = await makeRoot(t, 'src');
  const registry = new Registry({ root: srcRoot });
  const sealed = await seedRegistry(registry, 'coding', { 'preset.yml': 'name: coding\npersona: v1\n' });
  // second generation so history has previous + active
  const cid2 = await registry.createCandidate('coding', { sourceRevisionId: sealed.revisionId, evolutionRunId: 'gen2' });
  const dir2 = path.join(registry.dirs.staging, cid2);
  await fsp.writeFile(path.join(dir2, 'preset.yml'), 'name: coding\npersona: v2\n', 'utf8');
  const sealed2 = await registry.sealRevision(cid2);
  await registry.promote('coding', {
    expectedCurrent: { revisionId: sealed.revisionId, digest: sealed.digest },
    targetRevision: sealed2.revisionId, candidateDigest: sealed2.digest,
    gateRunId: 'g2', approvalId: 'a2',
  });

  const outPath = path.join(srcRoot, 'snapshot.json');
  const exported = await registry.exportSnapshot(outPath);
  assert.equal(exported.schemaVersion, 1);
  assert.match(exported.packageDigest, /^[0-9a-f]{64}$/);
  assert.ok(exported.fileCount > 0);

  const dstRoot = path.join(srcRoot, 'imported');
  const imported = await Registry.importSnapshot({ root: dstRoot, inPath: outPath });
  assert.equal(imported.imported, exported.fileCount);
  assert.equal(imported.packageDigest, exported.packageDigest);
  assert.deepEqual(imported.revisions.sort(), [sealed.digest, sealed2.digest].sort());

  const dst = new Registry({ root: dstRoot });
  const current = await dst.resolveCurrent('coding');
  assert.equal(current.revisionId, sealed2.revisionId);
  assert.equal(current.digest, sealed2.digest);
  assert.equal(current.gateRunId, 'g2');
  assert.equal(current.approvalId, 'a2');
  const history = await dst.history('coding');
  assert.equal(history.length, 2);
  assert.equal(history[0].status, 'active');
  assert.equal(history[1].status, 'previous');
  // every revision verifies
  for (const digest of [sealed.digest, sealed2.digest]) {
    const check = await dst.verifyRevisionDigest(digest);
    assert.equal(check.ok, true);
  }
  // content survived
  const content = await dst.revisionContent(sealed2.digest);
  assert.equal(content.files['preset.yml'], 'name: coding\npersona: v2\n');
  // ledger bytes preserved
  const ledger = await fsp.readFile(path.join(dstRoot, 'ledger', 'ledger.jsonl'), 'utf8');
  assert.match(ledger, /"op":"promote"/);
});

test('archive: tampered file content is rejected (AC4)', async (t) => {
  const srcRoot = await makeRoot(t, 'tamper');
  const registry = new Registry({ root: srcRoot });
  await seedRegistry(registry);
  const outPath = path.join(srcRoot, 'snapshot.json');
  await registry.exportSnapshot(outPath);
  const pkg = JSON.parse(await fsp.readFile(outPath, 'utf8'));
  const target = pkg.files.find((f) => f.path.endsWith('preset.yml'));
  target.content = Buffer.from('tampered').toString('base64');
  await fsp.writeFile(outPath, JSON.stringify(pkg), 'utf8');
  const dstRoot = path.join(srcRoot, 'imported');
  await assert.rejects(
    () => Registry.importSnapshot({ root: dstRoot, inPath: outPath }),
    /hash mismatch/,
  );
  assert.equal(await fsp.stat(dstRoot).catch(() => null), null, 'target must not be created on failure');
});

test('archive: tampered package digest is rejected', async (t) => {
  const srcRoot = await makeRoot(t, 'digest');
  const registry = new Registry({ root: srcRoot });
  await seedRegistry(registry);
  const outPath = path.join(srcRoot, 'snapshot.json');
  await registry.exportSnapshot(outPath);
  const pkg = JSON.parse(await fsp.readFile(outPath, 'utf8'));
  pkg.packageDigest = '0'.repeat(64);
  await fsp.writeFile(outPath, JSON.stringify(pkg), 'utf8');
  await assert.rejects(
    () => Registry.importSnapshot({ root: path.join(srcRoot, 'imported'), inPath: outPath }),
    /package digest mismatch/,
  );
});

test('archive: non-empty target root is rejected', async (t) => {
  const srcRoot = await makeRoot(t, 'nonempty');
  const registry = new Registry({ root: srcRoot });
  await seedRegistry(registry);
  const outPath = path.join(srcRoot, 'snapshot.json');
  await registry.exportSnapshot(outPath);
  const occupied = path.join(srcRoot, 'occupied');
  await fsp.mkdir(occupied);
  await fsp.writeFile(path.join(occupied, 'x.txt'), 'x', 'utf8');
  await assert.rejects(
    () => Registry.importSnapshot({ root: occupied, inPath: outPath }),
    /target root not empty/,
  );
  // untouched
  assert.equal(await fsp.readFile(path.join(occupied, 'x.txt'), 'utf8'), 'x');
});

test('archive: traversal path in the package is rejected', async (t) => {
  const srcRoot = await makeRoot(t, 'traversal');
  const registry = new Registry({ root: srcRoot });
  await seedRegistry(registry);
  const outPath = path.join(srcRoot, 'snapshot.json');
  await registry.exportSnapshot(outPath);
  const pkg = JSON.parse(await fsp.readFile(outPath, 'utf8'));
  pkg.files.push({ path: '../evil.txt', encoding: 'base64', content: Buffer.from('x').toString('base64'), sha256: 'x' });
  await fsp.writeFile(outPath, JSON.stringify(pkg), 'utf8');
  await assert.rejects(
    () => Registry.importSnapshot({ root: path.join(srcRoot, 'imported'), inPath: outPath }),
    /unsafe path/,
  );
});

test('archive: import into an existing EMPTY root fills it', async (t) => {
  const srcRoot = await makeRoot(t, 'emptyfill');
  const registry = new Registry({ root: srcRoot });
  const sealed = await seedRegistry(registry);
  const outPath = path.join(srcRoot, 'snapshot.json');
  await registry.exportSnapshot(outPath);
  const emptyRoot = path.join(srcRoot, 'empty');
  await fsp.mkdir(emptyRoot);
  const imported = await Registry.importSnapshot({ root: emptyRoot, inPath: outPath });
  assert.equal(imported.imported, (await registry.exportSnapshot(path.join(srcRoot, 'x.json'))).fileCount);
  const dst = new Registry({ root: emptyRoot });
  const current = await dst.resolveCurrent('coding');
  assert.equal(current.digest, sealed.digest);
});
