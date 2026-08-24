'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure, failureRecordsFromRun, summarizeFailures, formatFailureSummary } = require('../lib/failures');

test('classifyFailure maps known messages to classes', () => {
  assert.equal(classifyFailure('rubric decrypt failed'), 'rubric-decrypt');
  assert.equal(classifyFailure('materials changed during run'), 'material-drift');
  assert.equal(classifyFailure('executor failed'), 'executor');
  assert.equal(classifyFailure('reviewer stopped'), 'reviewer');
  assert.equal(classifyFailure('fate assessment error'), 'fate-assessor');
  assert.equal(classifyFailure('trajectory unavailable'), 'trajectory');
  assert.equal(classifyFailure('output budget exhausted'), 'max-tokens');
  assert.equal(classifyFailure('llm call aborted'), 'aborted');
  assert.equal(classifyFailure('llm call failed'), 'llm');
  assert.equal(classifyFailure('gate error'), 'gate');
  assert.equal(classifyFailure('casecheck failed'), 'casecheck');
  assert.equal(classifyFailure('timed out'), 'timed-out');
  assert.equal(classifyFailure('task failed (grade)'), 'task-failed');
  assert.equal(classifyFailure('something unknown'), 'other');
});

test('failureRecordsFromRun extracts failed/error/timed-out/task-failed cases', () => {
  const run = {
    benchmark: 'b1',
    cases: [
      { caseId: 'c1', status: 'completed', grade: { taskSuccess: true } },
      { caseId: 'c2', status: 'error', error: 'llm call failed', exitCode: 1, timedOut: false },
      { caseId: 'c3', status: 'failed', timedOut: true, exitCode: 1 },
      { caseId: 'c4', status: 'completed', grade: { taskSuccess: false } },
    ],
  };
  const records = failureRecordsFromRun(run, 'run-a.json');
  assert.equal(records.length, 3);
  assert.equal(records[0].kind, 'llm');
  assert.equal(records[1].kind, 'timed-out');
  assert.equal(records[2].kind, 'task-failed');
  assert.ok(records[0].source.includes('run-a.json'));
});

test('summarizeFailures aggregates by kind and source, sorted desc', () => {
  const records = [
    { kind: 'llm', source: 'run:a' },
    { kind: 'llm', source: 'run:a' },
    { kind: 'timed-out', source: 'run:b' },
  ];
  const summary = summarizeFailures(records);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.byKind, { llm: 2, 'timed-out': 1 });
  assert.deepEqual(summary.bySource, { 'run:a': 2, 'run:b': 1 });
});

test('formatFailureSummary renders a human-readable report', () => {
  const text = formatFailureSummary({ total: 2, byKind: { llm: 2 }, bySource: { 'run:a': 2 } });
  assert.ok(text.includes('failure summary: 2 total'));
  assert.ok(text.includes('by class:'));
  assert.ok(text.includes('  llm: 2'));
  assert.ok(text.includes('by source:'));
  assert.ok(text.includes('  run:a: 2'));
});
