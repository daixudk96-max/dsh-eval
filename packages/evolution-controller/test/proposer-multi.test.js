'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proposeMultiple } = require('../lib/proposer');

const RUN = {
  cases: [
    { caseId: 'fix-multiply', status: 'completed', exitCode: 1, grade: { taskSuccess: false } },
    { caseId: 'ok-case', status: 'completed', grade: { taskSuccess: true } },
  ],
};
const FILES = { 'preset.yml': 'name: eval\n', 'agent.cordis.yml': 'persona: hi\n' };

function fakeLlm(sequence) {
  let i = 0;
  return {
    complete: async () => {
      const item = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      return typeof item === 'function' ? item(i) : item;
    },
  };
}

const json = (hypothesis, fileText) => JSON.stringify({
  hypothesis,
  evidence: ['case fix-multiply: task failed (exit 1)'],
  mutations: [{ file: 'agent.cordis.yml', op: 'rewrite', summary: 'tweak' }],
  files: { 'agent.cordis.yml': fileText },
});

test('proposeMultiple: returns count distinct candidates', async (t) => {
  const llm = fakeLlm([
    json('h1: persona too terse', 'persona: be verbose\n'),
    json('h2: missing tool', 'persona: add tool\n'),
    json('h3: wrong order', 'persona: reorder\n'),
  ]);
  const res = await proposeMultiple({ count: 3, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.ok, true);
  assert.equal(res.candidates.length, 3);
  assert.notEqual(res.candidates[0].hypothesis, res.candidates[1].hypothesis);
});

test('proposeMultiple: count > 3 is capped at 3', async (t) => {
  const llm = fakeLlm(Array.from({ length: 6 }, (_, i) => json(`h${i}`, `text ${i}`)));
  const res = await proposeMultiple({ count: 9, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.candidates.length, 3);
});

test('proposeMultiple: drops carbon copies and re-asks with a hint', async (t) => {
  const calls = [];
  const llm = fakeLlm([
    json('same', 'x'),
    json('same', 'x'), // carbon copy — dropped
    json('different', 'y'), // hint now demands different hypothesis
  ]);
  const origComplete = llm.complete;
  llm.complete = async (sys, user) => {
    calls.push(user);
    return origComplete(sys, user);
  };
  const res = await proposeMultiple({ count: 2, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.candidates.length, 2);
  assert.equal(res.candidates[0].hypothesis, 'same');
  assert.equal(res.candidates[1].hypothesis, 'different');
  // the re-ask carries the variant hint mentioning the earlier hypothesis
  assert.ok(calls[2].includes('MUST differ'));
});

test('proposeMultiple: LLM refusal stops honestly with partial results', async (t) => {
  const llm = fakeLlm([
    json('h1', 'a'),
    () => 'not json at all',
  ]);
  const res = await proposeMultiple({ count: 3, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.ok, true); // partial result is honest
  assert.equal(res.candidates.length, 1);
});

test('proposeMultiple: all-refused returns ok:false with reason', async (t) => {
  const llm = fakeLlm(['garbage', 'garbage']);
  const res = await proposeMultiple({ count: 2, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.ok, false);
  assert.match(res.reason, /non-JSON/);
});

test('proposeMultiple: no failed cases returns ok:false (nothing to fix)', async (t) => {
  const llm = fakeLlm([json('h1', 'a')]);
  const res = await proposeMultiple({ count: 2, runJson: { cases: [{ caseId: 'a', grade: { taskSuccess: true } }] }, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.ok, false);
  assert.match(res.reason, /no failed cases/);
});

test('proposeMultiple: transient LLM failure is retried, not fatal', async (t) => {
  let calls = 0;
  const llm = {
    complete: async () => {
      calls += 1;
      if (calls === 1) throw new Error('fetch failed (ECONNRESET)');
      return json('h1: transient then ok', 'text');
    },
  };
  const res = await proposeMultiple({ count: 1, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.ok, true);
  assert.equal(res.candidates.length, 1);
  assert.ok(calls >= 2, `expected a retry, got ${calls} calls`);
});

test('proposeMultiple: non-retryable refusal surfaces immediately (no retry)', async (t) => {
  let calls = 0;
  const llm = {
    complete: async () => {
      calls += 1;
      return 'garbage';
    },
  };
  const res = await proposeMultiple({ count: 1, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm });
  assert.equal(res.ok, false);
  assert.equal(calls, 1, 'non-retryable refusal must not be retried');
});

test('proposeMultiple: redaction applies to evidence', async (t) => {
  const llm = fakeLlm([JSON.stringify({
    hypothesis: 'h',
    evidence: ['token sk-abcdef123456 leaked'],
    mutations: [{ file: 'a', op: 'rewrite', summary: 's' }],
    files: { a: 'x' },
  })]);
  const res = await proposeMultiple({ count: 1, runJson: RUN, baselineFiles: FILES, logicalId: 'evaluate', llm, redactValues: ['sk-abcdef123456'] });
  assert.equal(res.ok, true);
  assert.ok(!res.candidates[0].evidence.join(' ').includes('sk-abcdef123456'));
});
