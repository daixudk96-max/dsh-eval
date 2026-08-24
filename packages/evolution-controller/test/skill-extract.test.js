'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractWorkflow,
  generalizeValue,
  generalizeArguments,
  inferPurpose,
  deduplicateSteps,
  generateSkill,
  generateSkillFilename,
  generateSkillName,
} = require('../lib/skill-extract');

/** Build a realistic DSH session event. */
function ev(type, data, seq) {
  return { type, seq, time: 1787000000000 + (seq || 0), data };
}

/** Build a synthetic EvalTrace-shaped session: user asks, then tool calls. */
function syntheticTrace() {
  const events = [
    ev('turn/start', { turn: 1 }, 0),
    ev('user/message', {
      content: [{ type: 'text', text: 'Summarize every README in the repo into a report' }],
      source: { kind: 'user' },
      role: 'user', id: 'u1',
    }, 1),
    ev('tool/call', { turn: 1, step: 1, callId: 'call_1', name: 'glob', arguments: '{"pattern":"**/README.md"}' }, 2),
    ev('tool/result', {
      turn: 1, step: 1,
      message: { role: 'tool', source: { kind: 'tool', callId: 'call_1' }, content: [{ type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: 'a/README.md\nb/README.md' }] }] },
      meta: { shape: 'array', total: 2 },
    }, 3),
    ev('tool/call', { turn: 1, step: 2, callId: 'call_2', name: 'read', arguments: '{"file_path":"a/README.md"}' }, 4),
    ev('tool/result', {
      turn: 1, step: 2,
      message: { role: 'tool', source: { kind: 'tool', callId: 'call_2' }, content: [{ type: 'text', text: '# a docs' }] },
    }, 5),
    ev('tool/call', { turn: 1, step: 3, callId: 'call_3', name: 'read', arguments: '{"file_path":"b/README.md"}' }, 6),
    ev('tool/result', {
      turn: 1, step: 3,
      message: { role: 'tool', source: { kind: 'tool', callId: 'call_3' }, content: [{ type: 'text', text: '# b docs' }] },
    }, 7),
    ev('step/end', { turn: 1, step: 3 }, 8),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 9),
  ];
  return { sessionId: 'session-x', createdAt: 1787000000000, events };
}

test('generalizeValue maps the five pattern families', () => {
  assert.equal(generalizeValue('https://example.com/x'), '<url>');
  assert.equal(generalizeValue('http://example.com'), '<url>');
  assert.equal(generalizeValue('a/b/c.ts'), '<path>');
  assert.equal(generalizeValue('a\\b\\c.ts'), '<path>'); // Windows backslash
  assert.equal(generalizeValue('42'), '<number>');
  assert.equal(generalizeValue('x'.repeat(51)), '<long_text>');
  assert.equal(generalizeValue('hello'), '"hello"');
  assert.equal(generalizeValue(7), 'number');
  assert.equal(generalizeValue(true), 'boolean');
});

test('generalizeArguments maps every key to its pattern', () => {
  assert.deepEqual(
    generalizeArguments({ pattern: '**/*.md', timeout: 30000, file_path: 'src/x.ts', note: 'hi' }),
    { pattern: '<path>', timeout: 'number', file_path: '<path>', note: '"hi"' },
  );
});

test('inferPurpose covers common dsh eval tools', () => {
  assert.match(inferPurpose('read', { file_path: 'a/b.ts' }), /^Read file:/);
  assert.match(inferPurpose('write', { file_path: 'a/b.ts' }), /^Write file:/);
  assert.match(inferPurpose('edit', { file_path: 'a/b.ts' }), /^Edit file:/);
  assert.match(inferPurpose('pwsh', { command: 'npm test -- --run' }), /^Execute: npm test/);
  assert.match(inferPurpose('glob', { pattern: '*.md' }), /^Find files:/);
  assert.match(inferPurpose('grep', { pattern: 'foo' }), /^Search:/);
  assert.equal(inferPurpose('todo_write', {}), 'Update the task list');
  assert.equal(inferPurpose('mystery-tool', {}), 'Use mystery-tool');
});

test('extractWorkflow parses an EvalTrace-shaped trace into steps', () => {
  const workflow = extractWorkflow(syntheticTrace());
  assert.equal(workflow.taskDescription, 'Summarize every README in the repo into a report');
  assert.equal(workflow.turnCount, 1);
  assert.equal(workflow.success, true);
  assert.deepEqual(workflow.toolsUsed.sort(), ['glob', 'read']);
  assert.equal(workflow.steps.length, 2); // glob + read collapse (same <path> pattern)
  const readStep = workflow.steps.find((s) => s.tool === 'read');
  assert.ok(readStep);
  assert.equal(readStep.action, 'read');
  assert.equal(readStep.params.file_path, 'a/README.md');
  assert.equal(readStep.argsPattern.file_path, '<path>');
  assert.match(readStep.result, /# a docs/);
});

test('steps carry the concrete first-wins params and matched result', () => {
  const workflow = extractWorkflow(syntheticTrace());
  // glob step keeps its own concrete params and its result summary
  const globStep = workflow.steps.find((s) => s.tool === 'glob');
  assert.deepEqual(globStep.params, { pattern: '**/README.md' });
  assert.equal(globStep.result, 'a/README.md\nb/README.md');
  assert.equal(typeof globStep.order, 'number');
});

test('dedup collapses identical shapes and keeps distinct ones', () => {
  const steps = [
    { tool: 'read', argsPattern: { file_path: '<path>' }, order: 0 },
    { tool: 'read', argsPattern: { file_path: '<path>' }, order: 1 },
    { tool: 'read', argsPattern: { file_path: '"README.md"' }, order: 2 },
    { tool: 'glob', argsPattern: { pattern: '"*.md"' }, order: 3 },
  ];
  const deduped = deduplicateSteps(steps);
  assert.equal(deduped.length, 3);
  assert.equal(deduped[0].order, 0); // first wins
  assert.equal(deduped[1].tool, 'read');
  assert.equal(deduped[1].argsPattern.file_path, '"README.md"');
});

test('extractWorkflow accepts a bare event array too', () => {
  const trace = syntheticTrace();
  const workflow = extractWorkflow(trace.events);
  assert.equal(workflow.steps.length, 2);
});

test('extractWorkflow handles malformed tool arguments gracefully', () => {
  const events = [
    ev('user/message', { content: [{ type: 'text', text: 'do it' }], role: 'user' }, 0),
    ev('tool/call', { name: 'read', arguments: '{not json' }, 1),
  ];
  const workflow = extractWorkflow(events);
  assert.equal(workflow.steps[0].params._raw, '{not json');
  assert.equal(workflow.steps[0].argsPattern._raw, '"{not json"');
});

test('generateSkill renders frontmatter and the full section order', () => {
  const workflow = extractWorkflow(syntheticTrace());
  const md = generateSkill(workflow, { name: 'doc-summarizer', description: 'Sum up README files', generatedFrom: 'session-x', generatedAt: '2026-08-23T00:00:00.000Z' });
  assert.match(md, /^---\nname: doc-summarizer\ndescription: Sum up README files\nsource: session-x\n---/);
  for (const section of ['## When to use', '## Steps', '## Parameters', '## Examples', '## Notes']) {
    assert.ok(md.includes(section), `missing section ${section}`);
  }
  assert.match(md, /### 1. Find files: \*\*\/README\.md/);
  assert.ok(md.includes('- Tool: `read`'));
  assert.ok(md.includes('`file_path`: <path>'));
  assert.ok(md.includes('> Summarize every README in the repo into a report'));
  // trojan-free: no stray raw stream chunks
  assert.ok(!md.includes('undefined'));
});

test('generateSkill overview line carries the descriptive sentence', () => {
  const workflow = extractWorkflow(syntheticTrace());
  const md = generateSkill(workflow, { name: 'doc-summarizer' });
  assert.match(md, /Auto-generated from session `session` on /);
});

test('generateSkillFilename slugs CJK and ASCII names into .md', () => {
  assert.equal(generateSkillFilename('Doc Summarizer!'), 'doc-summarizer.md');
  assert.equal(generateSkillFilename('总结 报告 MD'), '总结-报告-md.md');
  assert.equal(generateSkillFilename('...'), 'skill.md');
});

test('generateSkillName derives a readable default name', () => {
  assert.equal(generateSkillName('Fix the flaky login test'), 'fix-the-flaky-login-test');
});

test('generateSkill handles an empty workflow deterministically', () => {
  const workflow = extractWorkflow({ events: [] });
  assert.equal(workflow.turnCount, 0);
  assert.equal(workflow.success, false);
  assert.equal(workflow.steps.length, 0);
  assert.deepEqual(workflow.toolsUsed, []);
  const md = generateSkill(workflow, { name: 'empty' });
  assert.match(md, /^---\nname: empty\n/);
  assert.ok(md.includes('## When to use'));
  assert.ok(md.includes('(no user message recorded)'));
  assert.ok(md.includes('_No parameters observed._'));
  assert.ok(md.includes('_No tool invocations observed._'));
});