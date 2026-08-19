'use strict';
const fs = require('node:fs');
const path = require('node:path');
const fsp = require('node:fs/promises');

async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); return p; }

async function appendLedger(dir, entry) {
  await ensureDir(dir);
  const line = JSON.stringify({ ...entry });
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

module.exports = { ensureDir, appendLedger, readLedger, existsSync: fs.existsSync };
