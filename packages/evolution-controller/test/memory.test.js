'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ENTRY_DELIMITER,
  DEFAULT_BUDGET,
  parseEntries,
  renderEntries,
  contentChars,
  normalizeLine,
  updateMemoryFile,
  describe,
} = require('../lib/memory');

const A = 'User prefers concise answers.';
const B = 'Project uses ESM with vitest.';
const C = 'Rollback needs force across intermediate versions.';

test('append: new lines are added and reported', () => {
  const first = updateMemoryFile('', A, {});
  assert.deepEqual(first.added, [A]);
  assert.equal(first.content, `${A}\n`);
  assert.deepEqual(first.evicted, []);
  const second = updateMemoryFile(first.content, [A, B], {});
  assert.deepEqual(second.added, [B]); // A already present -> deduped
  assert.equal(second.content, `${A}${ENTRY_DELIMITER}${B}\n`);
});

test('dedup: identical lines are never re-appended', () => {
  const { added } = updateMemoryFile(`${A}\n`, [A, A, ` ${A} `], {});
  assert.deepEqual(added, []);
});

test('dedup: near-identical variants (date prefix / whitespace) collapse', () => {
  const existing = `${A}\n`;
  const nearSame = `## 2026-08-23\n${A}`;
  const result = updateMemoryFile(existing, [nearSame], {});
  assert.deepEqual(result.added, []);
  assert.equal(result.content, existing);
  assert.equal(normalizeLine(nearSame), A);
});

test('budget: overflow evicts the oldest entries first', () => {
  const tiny = { budget: 80 };
  let content = '';
  for (const line of [C, B, A]) content = updateMemoryFile(content, line, tiny).content;
  assert.deepEqual(parseEntries(content), [B, A]); // B survives the C eviction
  const noop = updateMemoryFile(content, '', tiny);
  assert.equal(noop.added.length, 0);
  // a new entry that fits but pushes the file over budget evicts oldest (front) lines
  const huge = 'z'.repeat(60);
  const result = updateMemoryFile(content, huge, tiny);
  assert.deepEqual(result.added, [huge]);
  assert.deepEqual(result.evicted, [B, A]); // oldest-first eviction
  assert.ok(result.content.includes(huge), 'newest survives');
  assert.ok(!result.content.includes(A) && !result.content.includes(B), 'evicted lines are gone');
  assert.ok(describe(result.content).chars <= 80, 'file fits the budget');
});

test('empty store renders empty content (zero tokens)', () => {
  assert.equal(renderEntries([]), '');
  const result = updateMemoryFile(null, [], {});
  assert.equal(result.content, '');
  assert.deepEqual(result.added, []);
  const shape = describe('');
  assert.equal(shape.entries, 0);
});

test('array input appends several lines', () => {
  const result = updateMemoryFile('', [A, B], {});
  assert.deepEqual(result.added, [A, B]);
  assert.equal(parseEntries(result.content).length, 2);
});

test('budget validation rejects non-positive budgets', () => {
  assert.throws(() => updateMemoryFile('', A, { budget: 0 }), /positive/);
  assert.throws(() => updateMemoryFile('', A, { budget: -5 }), /positive/);
});

test('a single entry larger than the budget still survives (keeps newest)', () => {
  const one = 'a'.repeat(200);
  const result = updateMemoryFile('', one, { budget: 100 });
  assert.equal(result.added.length, 1);
  assert.equal(result.evicted.length, 0);
  assert.equal(result.content, `${one}\n`);
});

test('parse/render round-trip and char accounting', () => {
  const content = `${A}${ENTRY_DELIMITER}${B}\n`;
  assert.deepEqual(parseEntries(content), [A, B]);
  assert.equal(renderEntries([A, B]), content);
  assert.equal(contentChars([A, B]), A.length + B.length + ENTRY_DELIMITER.length + 1);
});