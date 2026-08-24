'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KINDS,
  displayKind,
  truncate,
  rankScore,
  formatEntry,
  rankNotes,
} = require('../lib/injection');

const T0 = '2026-08-01T00:00:00.000Z';
const T1 = '2026-08-02T00:00:00.000Z';
const T2 = '2026-08-03T00:00:00.000Z';

function note(id, kind, { content, version = 1, updatedAt = T0, title, description, metadata } = {}) {
  return { id, kind, version, content: content === undefined ? `content of ${id}` : content, updatedAt, title, description, metadata };
}

test('empty store renders an empty string (zero tokens)', () => {
  assert.equal(rankNotes([]), '');
  assert.equal(rankNotes(null, {}), '');
  assert.equal(rankNotes([], { maxPerKind: 6, maxChars: 180 }), '');
});

test('renders headers for every kind in section order', () => {
  const notes = [
    note('p1', 'prompt', { version: 2, content: 'keep it short' }),
    note('m1', 'memory', { content: 'user prefers python' }),
    note('s1', 'skill', { description: 'review pull requests' }),
    note('sb1', 'subagent', { content: 'delegation spec' }),
  ];
  const out = rankNotes(notes);
  const positions = KINDS.map((kind) => out.indexOf(`## ${kind}`));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b)); // section order preserved
  assert.ok(out.includes('## prompt (1)'));
  assert.ok(out.includes('## memory (1)'));
  assert.ok(out.includes('subagent (1)'));
  // a kind without entries still renders its header and '- none'
  const single = rankNotes([note('m1', 'memory', { content: 'x' })]);
  assert.ok(single.includes('## prompt (0)'));
  assert.ok(single.includes('- none'));
});

test('kind alias: subagent-spec renders under the subagent section', () => {
  const out = rankNotes([note('sb1', 'subagent-spec', { content: 'x' })]);
  assert.ok(out.includes('## subagent (1)'));
  assert.ok(!out.includes('## subagent-spec'));
  assert.ok(out.includes('- sb1 v1: x'));
  assert.equal(displayKind('subagent-spec'), 'subagent');
});

test('per-kind cap renders N entries plus a more-marker', () => {
  const notes = Array.from({ length: 8 }, (_, i) => note(`m${i}`, 'memory', { updatedAt: T1 }));
  const out = rankNotes(notes, { maxPerKind: 6 });
  const shown = (out.match(/^- m\d v1:/gm) || []).length;
  assert.equal(shown, 6);
  assert.ok(out.includes('## memory (8)'));
  assert.ok(out.includes('- … 2 more'));
});

test('entry summaries are truncated to maxChars with an ellipsis', () => {
  const long = 'x'.repeat(300);
  const out = rankNotes([note('m1', 'memory', { content: long })], { maxChars: 180 });
  const line = out.split('\n').find((l) => l.startsWith('- m1 '));
  assert.ok(line.endsWith('…'));
  assert.equal(truncate(long, 180).length, 181);
  assert.equal(truncate('short', 180), 'short');
});

test('ranking: query boosts title hits over content hits, none first by update', () => {
  const titleHit = note('a', 'memory', { title: 'deploy pipeline', content: 'deploy steps', updatedAt: T0 });
  const contentHit = note('b', 'memory', { title: 'general', content: 'deploy the app via ssh', updatedAt: T2 });
  const miss = note('c', 'memory', { content: 'logging', updatedAt: T1 });
  const out = rankNotes([miss, contentHit, titleHit], { query: 'deploy' });
  const order = ['- a v1', '- b v1', '- c v1'];
  let cursor = -1;
  for (const prefix of order) {
    const at = out.indexOf(prefix);
    assert.ok(at > cursor, `${prefix} should come after previous`);
    cursor = at;
  }
  assert.equal(rankScore(titleHit, 'deploy'), 2);
  assert.equal(rankScore(contentHit, 'deploy'), 1);
  assert.equal(rankScore(miss, 'deploy'), 0);
  assert.equal(rankScore(titleHit, ''), 0);
});

test('archived and local: entries are filtered out of injection', () => {
  const archived = note('x', 'memory', { content: 'old', metadata: { lifecycleState: 'archived' } });
  const local = note('local:scratch', 'memory', { content: 'temp' });
  const keep = note('y', 'memory', { content: 'keep' });
  const out = rankNotes([archived, local, keep]);
  assert.ok(!out.includes('old'));
  assert.ok(!out.includes('temp'));
  assert.ok(out.includes('## memory (1)'));
  assert.ok(out.includes('- y v1: keep'));
});

test('formatEntry shape is `<id> v<version>: <summary>`', () => {
  const entry = note('skill-x', 'skill', { version: 3, description: 'three step review' });
  assert.equal(formatEntry(entry, 180), '- skill-x v3: three step review');
});