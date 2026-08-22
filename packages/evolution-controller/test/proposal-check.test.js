'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proposalCheck, normalizeText, MAX_HYPOTHESES } = require('../lib/proposal-check');
const { sha256 } = require('../../preset-registry/lib/hash');

const SRC = 'coding-v1';

function runC(args) {
  return proposalCheck({
    logicalId: 'coding',
    sourceRevisionId: SRC,
    hypothesis: 'rewrite improves prompt adherence',
    evidence: ['eval-1', 'failure-cluster/prompt-following'],
    mutations: [{ kind: 'prompt', op: 'rewrite', from: 'old', to: 'new' }],
    sourceContent: { 'preset.yml': 'name: coding' },
    candidateContent: { 'preset.yml': 'name: coding\noutput: v2' },
    existingCandidates: [],
    ...args,
  });
}

test('proposal-check: accepts a well-formed proposal', () => {
  const r = runC();
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
});

test('proposal-check: rejects missing hypothesis', () => {
  const r = runC({ hypothesis: '' });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('hypothesis')));
});

test('proposal-check: rejects missing evidence (AC1)', () => {
  const r = runC({ evidence: [] });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('evidence')));
});

test('proposal-check: rejects no-change copy of source (AC1)', () => {
  const r = runC({ candidateContent: { 'preset.yml': 'name: coding' } });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('no-change')));
});

test('proposal-check: rejects test-only mutations (AC1)', () => {
  const r = runC({ mutations: [{ kind: 'patch', path: 'test/runner.spec.js' }] });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('only tests')));
});

test('proposal-check: rejects comment-only mutations (AC1)', () => {
  const r = runC({
    mutations: [{ kind: 'patch', path: 'preset.yml', from: '# old\nname: coding\n', to: '# new\nname: coding\n' }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('only comments')));
});

test('proposal-check: hypothesis cap W_p=3 (AC2)', () => {
  const existing = [
    { candidateId: 'c1', hypothesis: 'h1', contentHash: 'a'.repeat(64) },
    { candidateId: 'c2', hypothesis: 'h2', contentHash: 'b'.repeat(64) },
    { candidateId: 'c3', hypothesis: 'h3', contentHash: 'c'.repeat(64) },
  ];
  const r = runC({ hypothesis: 'h4', existingCandidates: existing });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('distinct hypotheses')));
});

test('proposal-check: duplicate hypothesis in run rejected (AC2)', () => {
  const existing = [{ candidateId: 'h1', hypothesis: 'rewrite the prompt adherence', contentHash: 'a'.repeat(64) }];
  const r = runC({ hypothesis: 'rewrite the prompt adherence', existingCandidates: existing });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('duplicate hypothesis')));
});

test('proposal-check: semantic duplicate candidate rejected (AC2)', () => {
  // same normalized candidate content as an earlier candidate in the run
  const candText = normalizeText('name: coding\noutput: v2');
  const dupHash = sha256(candText);
  const r = runC({ existingCandidates: [{ candidateId: 'c1', hypothesis: 'other', contentHash: dupHash }] });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('duplicate of candidate c1')));
});

test('proposal-check: rejects empty candidate content', () => {
  const r = runC({ candidateContent: {} });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('no content files')));
});

test('normalizeText strips BOM, whitespace, blanks, and # comments', () => {
  const normalized = normalizeText('\uFEFF  # comment\n\nname: coding  \n\t# another\n');
  assert.equal(normalized, 'name: coding');
});

test('proposal-check: MAX_HYPOTHESES constant is 3', () => {
  assert.equal(MAX_HYPOTHESES, 3);
});
