'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectOverfit, addedLines } = require('../lib/overfit');

const META = {
  benchmarkDigest: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
  cases: [
    {
      id: 'eval-real-session',
      statement: 'Evaluate the DSH session at ./sample-session.jsonl.zstd using the eval profile CLI and write a markdown summary to REPORT.md.',
      privateRubric: 'Score the agent REPORT.md on completeness, accuracy, and analysis; no invented metrics.',
    },
  ],
};

const SOURCE = { 'preset.yml': 'name: evaluate\npersona: evaluate sessions\n' };

test('overfit: clean candidate passes', () => {
  const result = inspectOverfit({
    sourceFiles: SOURCE,
    candidateFiles: { 'preset.yml': 'name: evaluate\npersona: evaluate sessions\noutput: v2\n' },
    benchmarkMeta: META,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test('overfit: benchmark digest in added text is flagged', () => {
  const result = inspectOverfit({
    sourceFiles: SOURCE,
    candidateFiles: { 'preset.yml': `name: evaluate\npersona: evaluate sessions\n# pin ${META.benchmarkDigest}\n` },
    benchmarkMeta: META,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ code: 'BENCHMARK_OVERFIT', kind: 'digest' }]);
});

test('overfit: long statement in added text is flagged', () => {
  const result = inspectOverfit({
    sourceFiles: SOURCE,
    candidateFiles: { 'preset.yml': `name: evaluate\npersona: evaluate sessions\n# ${META.cases[0].statement}\n` },
    benchmarkMeta: META,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ code: 'BENCHMARK_OVERFIT', kind: 'statement', caseId: 'eval-real-session' }]);
});

test('overfit: case_id marker with long id is flagged', () => {
  const result = inspectOverfit({
    sourceFiles: SOURCE,
    candidateFiles: { 'preset.yml': 'name: evaluate\npersona: evaluate sessions\n# case_id: eval-real-session\n' },
    benchmarkMeta: META,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ code: 'BENCHMARK_OVERFIT', kind: 'case-id', caseId: 'eval-real-session' }]);
});

test('overfit: private rubric in added text is contamination', () => {
  const result = inspectOverfit({
    sourceFiles: SOURCE,
    candidateFiles: { 'preset.yml': `name: evaluate\npersona: evaluate sessions\n# ${META.cases[0].privateRubric}\n` },
    benchmarkMeta: META,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ code: 'BENCHMARK_CONTAMINATION', kind: 'private-rubric', caseId: 'eval-real-session' }]);
});

test('overfit: unchanged source lines are not scanned', () => {
  // The statement is present in the SOURCE revision already — the delta scan
  // must not flag content that was not added by this candidate.
  const sourceWithStatement = { 'preset.yml': `name: evaluate\npersona: evaluate sessions\n# ${META.cases[0].statement}\n` };
  const result = inspectOverfit({
    sourceFiles: sourceWithStatement,
    candidateFiles: { 'preset.yml': `name: evaluate\npersona: evaluate sessions\n# ${META.cases[0].statement}\noutput: v2\n` },
    benchmarkMeta: META,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test('overfit: short statement (< 40 chars) is not flagged', () => {
  const result = inspectOverfit({
    sourceFiles: SOURCE,
    candidateFiles: { 'preset.yml': 'name: evaluate\npersona: evaluate sessions\n# short statement\n' },
    benchmarkMeta: { benchmarkDigest: META.benchmarkDigest, cases: [{ id: 'x', statement: 'short statement' }] },
  });
  assert.equal(result.ok, true);
});

test('overfit: no corpus (legacy caller) always passes', () => {
  const result = inspectOverfit({
    sourceFiles: SOURCE,
    candidateFiles: { 'preset.yml': `name: evaluate\n# ${META.cases[0].statement}\n` },
    benchmarkMeta: null,
  });
  assert.equal(result.ok, true);
});

test('overfit: addedLines extracts only candidate-added lines per file', () => {
  const added = addedLines(
    { 'a.yml': 'keep\nbase\n' },
    { 'a.yml': 'keep\nbase\nnew1\n', 'b.yml': 'fresh\n' },
  );
  const lines = added.map((e) => `${e.rel}:${e.line}`).sort();
  assert.deepEqual(lines, ['a.yml:new1', 'b.yml:fresh']);
});
