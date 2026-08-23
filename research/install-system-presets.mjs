// install-system-presets.mjs — 把 shipped system presets 初始安装进真实 registry。
// logical: system-evaluator ← packages/system-presets/presets/system-evaluator
//          system-evolver  ← packages/system-presets/presets/system-evolver
// 与 evaluate 首次安装同流程: createCandidate → seal → promote(expectedCurrent: null)。
// 运行: node research/install-system-presets.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Registry } = require('../packages/preset-registry/lib/registry.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const ROOT = 'C:/Users/daixu/.dsh/preset-registry';
function readDirAsFiles(dir) {
  const files = {};
  const walk = (child) => {
    const abs = path.join(dir, child);
    for (const name of fs.readdirSync(abs)) {
      const full = path.join(abs, name);
      if (fs.statSync(full).isDirectory()) walk(path.join(child, name));
      else files[child.split(path.sep).join('/') + '/' + name] = fs.readFileSync(full, 'utf8');
    }
  };
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(name);
    else files[name] = fs.readFileSync(full, 'utf8');
  }
  return files;
}

async function install(registry, logicalId, srcDir, gateRunId, approvalId) {
  const exists = await registry.resolveCurrent(logicalId);
  if (exists && exists.revisionId) {
    console.log(`⏭ ${logicalId}: 已安装 (${exists.revisionId}), 跳过`);
    return exists;
  }
  const files = readDirAsFiles(srcDir);
  const seed = await registry.createCandidate(logicalId, { sourceRevisionId: null, evolutionRunId: 'install-system' });
  const stagingDir = path.join(registry.dirs.staging, seed);
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(stagingDir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  const sealed = await registry.sealRevision(seed);
  const promoted = await registry.promote(logicalId, {
    expectedCurrent: null,
    targetRevision: sealed.revisionId,
    candidateDigest: sealed.digest,
    gateRunId: gateRunId,
    approvalId: approvalId,
  });
  console.log(`✓ ${logicalId} 初始安装: ${promoted.revisionId} (digest ${promoted.digest.slice(0, 12)}…)`);
  return promoted;
}

async function main() {
  const registry = new Registry({ root: ROOT });
  const presetsDir = path.join(REPO, 'packages', 'system-presets', 'presets');
  await install(registry, 'system-evaluator', path.join(presetsDir, 'system-evaluator'), 'install-system-evaluator', 'install-approved-evaluator-2026-08-23');
  await install(registry, 'system-evolver', path.join(presetsDir, 'system-evolver'), 'install-system-evolver', 'install-approved-evolver-2026-08-23');
  for (const logical of ['system-evaluator', 'system-evolver']) {
    const cur = await registry.resolveCurrent(logical);
    console.log(`resolveCurrent(${logical}) → ${cur.revisionId} (digest ${cur.digest.slice(0, 12)}…)`);
  }
  console.log('✓ 系统 preset 治理完成');
}

main().catch((e) => { console.error('install-system-presets failed:', e); process.exitCode = 1; });
