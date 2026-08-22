'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BudgetLedger, BUCKETS } = require('../lib/budget');

async function makeLedger(t, limitUsd = 0) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'evc-budget-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return new BudgetLedger({ dir, limitUsd });
}

test('budget: buckets are proposal/attempt/failed', () => {
  assert.deepEqual(BUCKETS, ['proposal', 'attempt', 'failed']);
});

test('budget: unlimited by default; remaining is Infinity', async (t) => {
  const ledger = await makeLedger(t);
  assert.equal(await ledger.remaining(), Infinity);
  assert.equal(await ledger.canAfford('attempt', 10), true);
  await ledger.spend('attempt', 3.5);
  assert.equal(await ledger.remaining(), Infinity);
});

test('budget: spend records append-only with timestamps and meta (AC3)', async (t) => {
  const ledger = await makeLedger(t, 100);
  const e1 = await ledger.spend('proposal', 1.25, { runId: 'evr-1', note: 'proposer' });
  const e2 = await ledger.spend('attempt', 0.5, { runId: 'evr-1' });
  const entries = await ledger.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].bucket, 'proposal');
  assert.equal(entries[0].amountUsd, 1.25);
  assert.equal(entries[0].meta?.note, undefined); // meta is spread, not nested
  assert.equal(entries[1].bucket, 'attempt');
  assert.ok(entries[0].ts <= entries[1].ts);
});

test('budget: spent() sums per bucket and total', async (t) => {
  const ledger = await makeLedger(t, 100);
  await ledger.spend('proposal', 1);
  await ledger.spend('proposal', 2);
  await ledger.spend('attempt', 3);
  await ledger.spend('failed', 4);
  const spent = await ledger.spent();
  assert.equal(spent.proposal, 3);
  assert.equal(spent.attempt, 3);
  assert.equal(spent.failed, 4);
  assert.equal(spent.total, 10);
});

test('budget: exhaustion blocks affordability and remaining hits 0 (AC3)', async (t) => {
  const ledger = await makeLedger(t, 5);
  assert.equal(await ledger.canAfford('attempt', 5), true);
  assert.equal(await ledger.canAfford('attempt', 5.01), false);
  await ledger.spend('attempt', 5);
  assert.equal(await ledger.remaining(), 0);
  assert.equal(await ledger.canAfford('attempt', 0.01), false);
});

test('budget: invalid bucket or amount rejected', async (t) => {
  const ledger = await makeLedger(t);
  await assert.rejects(() => ledger.spend('nope', 1), /unknown bucket/);
  await assert.rejects(() => ledger.spend('attempt', -1), /invalid amount/);
  await assert.rejects(() => ledger.spend('attempt', NaN), /invalid amount/);
});
