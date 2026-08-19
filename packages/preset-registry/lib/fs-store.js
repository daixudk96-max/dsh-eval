'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
  return p;
}

/** Atomic JSON write: write to <file>.tmp then rename over the target (same volume => atomic). */
async function writeJsonAtomic(file, obj) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

/** Append-only ledger (WAL): every mutation is recorded before the pointer rename. */
async function appendLedger(dir, entry) {
  await ensureDir(dir);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  await fsp.appendFile(path.join(dir, 'ledger.jsonl'), `${line}\n`, 'utf8');
}

async function readLedger(dir) {
  try {
    const txt = await fsp.readFile(path.join(dir, 'ledger.jsonl'), 'utf8');
    return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/** Remove stray atomic-write temp files left by a crash before the rename step. */
async function removeStrayTmp(dir) {
  const entries = await fsp.readdir(dir).catch(() => []);
  for (const name of entries) {
    if (name.endsWith('.tmp')) await fsp.rm(path.join(dir, name), { force: true });
  }
}

module.exports = { ensureDir, writeJsonAtomic, readJson, appendLedger, readLedger, removeStrayTmp };
