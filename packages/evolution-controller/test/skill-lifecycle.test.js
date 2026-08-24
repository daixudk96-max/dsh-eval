'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeLifecycleTransitions,
  applyLifecycle,
  decideLifecycle,
  idleDays,
  ageDays,
  consolidate,
  restore,
  validateConfig,
  PROTECTED_SKILLS,
} = require('../lib/skill-lifecycle');

const DAY = 86_400_000;
const NOW = new Date('2026-08-23T00:00:00.000Z');
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

function skill(name, { createdAgo = 10, usedAgo, state = 'active', pinned = false, qualityWarn = false, createdBy = 'agent' } = {}) {
  return {
    name,
    created: iso(createdAgo),
    lastUsedAt: usedAgo === undefined ? null : iso(usedAgo),
    state,
    pinned,
    qualityWarn,
    createdBy,
    content: `content of ${name}`,
  };
}

const names = (list) => list.map((t) => t.name);
const kinds = (list) => list.map((t) => `${t.name}:${t.from}→${t.to}`);

test('thresholds: staleAfterDays default 30, archiveAfterDays default 90', () => {
  assert.equal(validateConfig({}).staleAfterDays, 30);
  assert.equal(validateConfig({}).archiveAfterDays, 90);
  assert.throws(() => validateConfig({ staleAfterDays: 0 }), /positive/);
  assert.throws(() => validateConfig({ staleAfterDays: 50, archiveAfterDays: 50 }), /exceed/);
});

test('idle and age days are computed from ISO timestamps', () => {
  const record = skill('x', { createdAgo: 200, usedAgo: 12 });
  assert.equal(Math.round(idleDays(record, NOW)), 12);
  assert.equal(Math.round(ageDays(record, NOW)), 200);
  assert.equal(idleDays(skill('y', { createdAgo: 55 }), NOW), 55); // falls back to created
});

test('transition: active -> stale after the stale threshold', () => {
  const result = computeLifecycleTransitions([skill('a', { createdAgo: 120, usedAgo: 40 })], {}, NOW);
  assert.deepEqual(kinds(result.transitions), ['a:active→stale']);
  assert.deepEqual(result.markStale, ['a']);
});

test('transition: active -> archived after the archive threshold (skips stale)', () => {
  const result = computeLifecycleTransitions([skill('a', { createdAgo: 200, usedAgo: 120 })], {}, NOW);
  assert.deepEqual(kinds(result.transitions), ['a:active→archived']);
  assert.deepEqual(result.archive, ['a']);
});

test('transition: stale -> archived when idling past archive', () => {
  const result = computeLifecycleTransitions([skill('a', { createdAgo: 200, usedAgo: 150, state: 'stale' })], {}, NOW);
  assert.deepEqual(kinds(result.transitions), ['a:stale→archived']);
});

test('transition: stale -> active reactivates when used again', () => {
  const result = computeLifecycleTransitions([skill('a', { createdAgo: 80, usedAgo: 3, state: 'stale' })], {}, NOW);
  assert.deepEqual(kinds(result.transitions), ['a:stale→active']);
  assert.deepEqual(result.reactivate, ['a']);
});

test('pinned skills are exempt from auto-archival', () => {
  const pinned = skill('a', { createdAgo: 200, usedAgo: 120, pinned: true });
  const protectedPlan = skill('plan', { createdAgo: 200, usedAgo: 120 });
  const result = computeLifecycleTransitions([pinned, protectedPlan], {}, NOW);
  assert.equal(result.transitions.length, 0);
  assert.ok(PROTECTED_SKILLS.includes('plan'));
});

test('thresholds are configurable', () => {
  const config = { staleAfterDays: 7, archiveAfterDays: 21 };
  const staleSoon = computeLifecycleTransitions([skill('a', { createdAgo: 30, usedAgo: 10 })], config, NOW);
  assert.deepEqual(kinds(staleSoon.transitions), ['a:active→stale']);
  const archived = computeLifecycleTransitions([skill('b', { createdAgo: 40, usedAgo: 25 })], config, NOW);
  assert.deepEqual(kinds(archived.transitions), ['b:active→archived']);
});

test('qualityWarn skills use the qualityWarn stale threshold', () => {
  const record = skill('a', { createdAgo: 40, usedAgo: 15, qualityWarn: true });
  const result = computeLifecycleTransitions([record], { staleAfterDays: 30, qualityWarnStaleAfterDays: 10 }, NOW);
  assert.deepEqual(kinds(result.transitions), ['a:active→stale']);
});

test('unmanaged (createdBy !== agent) skills are skipped unless manageUnmanaged', () => {
  const manual = skill('m', { createdAgo: 200, usedAgo: 120, createdBy: 'user' });
  assert.equal(computeLifecycleTransitions([manual], {}, NOW).transitions.length, 0);
  const managed = computeLifecycleTransitions([manual], { manageUnmanaged: true }, NOW);
  assert.deepEqual(kinds(managed.transitions), ['m:active→archived']);
});

test('applyLifecycle returns updated copies and leaves exempt records unchanged', () => {
  const records = [
    skill('stale', { createdAgo: 120, usedAgo: 40 }),
    skill('keep', { createdAgo: 10, usedAgo: 2 }),
    skill('pin', { createdAgo: 200, usedAgo: 120, pinned: true }),
    skill('brchr', { createdAgo: 300, usedAgo: 250, state: 'archived' }),
  ];
  const updated = applyLifecycle(records, {}, NOW);
  const byName = Object.fromEntries(updated.map((r) => [r.name, r]));
  assert.equal(byName.stale.state, 'stale');
  assert.equal(byName.keep.state, 'active');
  assert.equal(byName.pin.state, 'active');
  assert.equal(byName.brchr.state, 'archived'); // unchanged, not orphaned
  // inputs are not mutated
  assert.equal(records[0].state, 'active');
});

test('restore flips an archived skill back to active with a timestamp', () => {
  const archived = skill('x', { createdAgo: 200, usedAgo: 150, state: 'archived' });
  const restored = restore(archived, NOW);
  assert.equal(restored.state, 'active');
  assert.equal(restored.restoredAt, NOW.toISOString());
  assert.equal(archived.state, 'archived');
});

test('consolidate merges stale skills into one active record', () => {
  const stale = [skill('a', { state: 'stale' }), skill('b', { state: 'stale' })];
  const merged = consolidate(stale, { now: NOW });
  assert.equal(merged.state, 'active');
  assert.deepEqual(merged.mergedFrom, ['a', 'b']);
  assert.equal(merged.content, 'content of a\n\ncontent of b');
  assert.equal(merged.name, 'consolidated');
  // explicit name override
  assert.equal(consolidate(stale, { name: 'weekly-fix', now: NOW }).name, 'weekly-fix');
  assert.throws(() => consolidate([], {}), /at least one/);
});

test('decideLifecycle stays active under the stale threshold', () => {
  const fresh = skill('a', { createdAgo: 5, usedAgo: 1 });
  assert.equal(decideLifecycle(fresh, validateConfig({}), NOW).next, 'active');
});