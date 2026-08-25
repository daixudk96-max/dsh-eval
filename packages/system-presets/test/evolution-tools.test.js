'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import * as evolutionTools from '../plugins/evolution-tools.js';
import * as evaluationTools from '../plugins/evaluation-tools.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Helper to resolve js-yaml from known locations */
function loadJsYaml() {
  const candidates = [
    path.join(os.homedir(), '.dsh', 'profiles', 'eval', 'node_modules', 'js-yaml'),
    path.join('E:', 'github', 'dsh', 'node_modules', 'js-yaml'),
    path.join('E:', 'github', 'dsh', 'packages', 'preset', 'agent-presets', 'node_modules', 'js-yaml'),
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* continue */
    }
  }
  try {
    return require('js-yaml');
  } catch (err) {
    throw new Error(`cannot load js-yaml: ${err.message}`);
  }
}

test('evolution-tools exports valid plugin interface and registers 4 tools', () => {
  assert.equal(evolutionTools.name, 'system-evolution-tools');
  assert.deepEqual(evolutionTools.inject, ['tools']);
  assert.equal(typeof evolutionTools.apply, 'function');

  const registered = [];
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (def) => registered.push(def),
    },
  };

  evolutionTools.apply(fakeCtx);
  assert.equal(registered.length, 4);

  const toolNames = registered.map((t) => t.name);
  assert.deepEqual(toolNames, [
    'evolution.propose',
    'evolution.mutate',
    'evolution.candidate',
    'evolution.run',
  ]);

  for (const t of registered) {
    assert.ok(t.description, `${t.name} has description`);
    assert.equal(t.output?.schema?.type, 'string', `${t.name} has string schema`);
    assert.equal(typeof t.execute, 'function', `${t.name} has execute function`);
    const rendered = t.output.render({}, 'sample output');
    assert.deepEqual(rendered, [{ type: 'text', text: 'sample output' }]);
  }
});

test('evaluation-tools exports valid plugin interface and registers 4 tools', () => {
  assert.equal(evaluationTools.name, 'system-evaluation-tools');
  assert.deepEqual(evaluationTools.inject, ['tools']);
  assert.equal(typeof evaluationTools.apply, 'function');

  const registered = [];
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (def) => registered.push(def),
    },
  };

  evaluationTools.apply(fakeCtx);
  assert.equal(registered.length, 4);

  const toolNames = registered.map((t) => t.name);
  assert.deepEqual(toolNames, [
    'evaluation.run',
    'evaluation.status',
    'evaluation.report',
    'evaluation.failures',
  ]);

  for (const t of registered) {
    assert.ok(t.description, `${t.name} has description`);
    assert.equal(t.output?.schema?.type, 'string', `${t.name} has string schema`);
    assert.equal(typeof t.execute, 'function', `${t.name} has execute function`);
    const rendered = t.output.render({}, 'sample output');
    assert.deepEqual(rendered, [{ type: 'text', text: 'sample output' }]);
  }
});

test('evolution.mutate executes replacement correctly and handles missing substring', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ev-mutate-test-'));
  t.after(() => fsp.rm(tmpDir, { recursive: true, force: true }));

  const testFile = path.join(tmpDir, 'sample.txt');
  await fsp.writeFile(testFile, 'hello world\nversion: 1.0\nend', 'utf8');

  // Success case
  const resStr1 = await evolutionTools.executeMutate({
    dir: tmpDir,
    file: 'sample.txt',
    from: 'version: 1.0',
    to: 'version: 2.0',
  });
  const res1 = JSON.parse(resStr1);
  assert.equal(res1.ok, true);
  assert.equal(res1.file, 'sample.txt');
  assert.equal(res1.changed, true);

  const updatedContent = await fsp.readFile(testFile, 'utf8');
  assert.ok(updatedContent.includes('version: 2.0'));
  assert.ok(!updatedContent.includes('version: 1.0'));

  // Failure case: missing target string
  const resStr2 = await evolutionTools.executeMutate({
    dir: tmpDir,
    file: 'sample.txt',
    from: 'non_existent_key: foo',
    to: 'replaced: bar',
  });
  const res2 = JSON.parse(resStr2);
  assert.equal(res2.ok, false);
  assert.ok(res2.error.includes('not found'));
});

test('evolution.candidate creates staging candidate with mutations and files', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ev-candidate-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const resStr = await evolutionTools.executeCandidate(
    {
      root,
      logicalId: 'test-preset',
      hypothesis: 'fix prompt clarity',
      evidence: ['case 1 failed with timeout'],
      mutations: [{ file: 'agent.cordis.yml', op: 'replace', summary: 'clarified prompt' }],
      files: {
        'agent.cordis.yml': 'name: test-preset\n',
        'sub/helper.js': 'export const helper = 1;\n',
      },
    },
    { repoRoot: REPO_ROOT },
  );

  const res = JSON.parse(resStr);
  assert.equal(res.ok, true);
  assert.ok(res.candidateId && res.candidateId.startsWith('cand-'));

  // Check staging content
  const stagingDir = path.join(root, 'staging', res.candidateId);
  assert.ok(fs.existsSync(path.join(stagingDir, 'candidate.json')));
  assert.ok(fs.existsSync(path.join(stagingDir, 'agent.cordis.yml')));
  assert.ok(fs.existsSync(path.join(stagingDir, 'sub', 'helper.js')));

  const candidateJson = JSON.parse(await fsp.readFile(path.join(stagingDir, 'candidate.json'), 'utf8'));
  assert.equal(candidateJson.logicalId, 'test-preset');
  assert.equal(candidateJson.status, 'DRAFT');
  assert.equal(candidateJson.mutations.length, 1);
});

test('evolution.run invokes dsh-evolve and parses gate.json output', async (t) => {
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ev-run-test-'));
  t.after(() => fsp.rm(outDir, { recursive: true, force: true }));

  const fakeGateJson = {
    runId: 'run-test-123',
    decision: 'ACCEPTED',
    reason: 'gate passed with sufficient gain',
    gain: 0.15,
    efficiencyGain: 0.05,
    baseline: { overall: 0.7 },
    candidate: { overall: 0.85 },
  };

  const mockExecFile = async (_file, argv, _opts) => {
    // Locate the out dir from argv
    const outIdx = argv.indexOf('--out');
    const targetOutDir = outIdx >= 0 ? argv[outIdx + 1] : outDir;
    fs.mkdirSync(targetOutDir, { recursive: true });
    fs.writeFileSync(path.join(targetOutDir, 'gate.json'), JSON.stringify(fakeGateJson, null, 2), 'utf8');
    return { err: null, stdout: 'evolve completed', stderr: '' };
  };

  const resStr = await evolutionTools.executeRun(
    {
      benchmark: 'eval/benchmarks/test.yaml',
      registryRoot: 'fake-root',
      logicalId: 'test-logical',
      split: 'dev',
      minEffect: 0.05,
      out: outDir,
    },
    { repoRoot: REPO_ROOT, execFile: mockExecFile },
  );

  const res = JSON.parse(resStr);
  assert.equal(res.ok, true);
  assert.equal(res.decision, 'ACCEPTED');
  assert.equal(res.reason, 'gate passed with sufficient gain');
  assert.equal(res.gain, 0.15);
  assert.equal(res.efficiencyGain, 0.05);
});

test('evolution.propose reads failures and baseline files, generating proposal artifacts', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ev-propose-test-'));
  t.after(() => fsp.rm(tmpDir, { recursive: true, force: true }));

  const evidenceRunPath = path.join(tmpDir, 'failed-run.json');
  const fakeRun = {
    status: 'completed',
    grading: { taskSuccessRate: 0.0 },
    cases: [
      { caseId: 'fix-multiply', status: 'completed', grade: { taskSuccess: false }, exitCode: 1, error: 'calculation mismatch' },
    ],
  };
  await fsp.writeFile(evidenceRunPath, JSON.stringify(fakeRun, null, 2), 'utf8');

  const baselineDir = path.join(tmpDir, 'baseline');
  await fsp.mkdir(baselineDir, { recursive: true });
  await fsp.writeFile(path.join(baselineDir, 'agent.cordis.yml'), 'persona: baseline instructions', 'utf8');

  const outDir = path.join(tmpDir, 'proposal-out');

  const mockLlm = {
    complete: async () => JSON.stringify({
      hypothesis: 'Clarify multiplication operation precedence',
      evidence: ["case fix-multiply: task failed (exit 1)"],
      mutations: [{ file: 'agent.cordis.yml', op: 'replace', summary: 'added operation rule' }],
      files: { 'agent.cordis.yml': 'persona: baseline instructions with multiplication rule' },
    }),
  };

  const resStr = await evolutionTools.executePropose(
    {
      evidenceRun: evidenceRunPath,
      baselineDir,
      outDir,
      logicalId: 'test-evolver',
    },
    { repoRoot: REPO_ROOT, llm: mockLlm },
  );

  const res = JSON.parse(resStr);
  assert.equal(res.ok, true);
  assert.equal(res.hypothesis, 'Clarify multiplication operation precedence');
  assert.ok(fs.existsSync(path.join(outDir, 'proposal.json')));
  assert.ok(fs.existsSync(path.join(res.candidateDir, 'agent.cordis.yml')));

  const candContent = await fsp.readFile(path.join(res.candidateDir, 'agent.cordis.yml'), 'utf8');
  assert.ok(candContent.includes('multiplication rule'));
});

test('evaluation.status parses run.json metrics accurately', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'eval-status-test-'));
  t.after(() => fsp.rm(tmpDir, { recursive: true, force: true }));

  const runJsonPath = path.join(tmpDir, 'run.json');
  const fakeRun = {
    status: 'completed',
    grading: { taskSuccessRate: 0.8, toolSelectionAccuracyRate: 0.95 },
    aggregate: { steps: 24 },
    cases: [
      { caseId: 'c1', grade: { taskSuccess: true } },
      { caseId: 'c2', grade: { taskSuccess: true } },
      { caseId: 'c3', grade: { taskSuccess: true } },
      { caseId: 'c4', grade: { taskSuccess: true } },
      { caseId: 'c5', grade: { taskSuccess: false } },
    ],
  };
  await fsp.writeFile(runJsonPath, JSON.stringify(fakeRun, null, 2), 'utf8');

  const resStr = await evaluationTools.executeEvaluationStatus({ runJson: runJsonPath });
  const res = JSON.parse(resStr);

  assert.equal(res.ok, true);
  assert.equal(res.status, 'completed');
  assert.equal(res.taskSuccessRate, 0.8);
  assert.equal(res.steps, 24);
  assert.equal(res.totalCases, 5);
  assert.equal(res.passedCases, 4);
  assert.equal(res.failedCases, 1);
});

test('evaluation.run, report, and failures execute and format output', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'eval-tools-test-'));
  t.after(() => fsp.rm(tmpDir, { recursive: true, force: true }));

  const runJsonPath = path.join(tmpDir, 'out-run.json');
  const fakeRun = {
    status: 'completed',
    grading: { taskSuccessRate: 1.0, toolSelectionAccuracyRate: 1.0 },
    cases: [{ caseId: 'c1', grade: { taskSuccess: true } }],
  };

  // 1. evaluation.run
  const mockExecRun = async (_cmd, argv, _opts) => {
    const outIdx = argv.indexOf('--out');
    const targetOut = argv[outIdx + 1];
    fs.writeFileSync(targetOut, JSON.stringify(fakeRun, null, 2), 'utf8');
    return { err: null, stdout: '', stderr: '' };
  };

  const runResStr = await evaluationTools.executeEvaluationRun(
    { benchmark: 'eval/benchmarks/demo.yaml', out: runJsonPath },
    { execFile: mockExecRun },
  );
  const runRes = JSON.parse(runResStr);
  assert.equal(runRes.ok, true);
  assert.equal(runRes.taskSuccessRate, 1.0);
  assert.equal(runRes.passedCases, 1);

  // 2. evaluation.report
  const mockExecReport = async () => ({
    err: null,
    stdout: '# Evaluation Report\n\nTask Success Rate: 100%',
    stderr: '',
  });
  const reportResStr = await evaluationTools.executeEvaluationReport(
    { runJson: runJsonPath },
    { execFile: mockExecReport },
  );
  const reportRes = JSON.parse(reportResStr);
  assert.equal(reportRes.ok, true);
  assert.ok(reportRes.report.includes('Task Success Rate: 100%'));

  // 3. evaluation.failures
  const mockExecFailures = async () => ({
    err: null,
    stdout: 'Failure Cluster 1: timeout (2 cases)',
    stderr: '',
  });
  const failuresResStr = await evaluationTools.executeEvaluationFailures(
    { runJsons: [runJsonPath] },
    { repoRoot: REPO_ROOT, execFile: mockExecFailures },
  );
  const failuresRes = JSON.parse(failuresResStr);
  assert.equal(failuresRes.ok, true);
  assert.ok(failuresRes.summary.includes('Failure Cluster 1'));
});

test('preset YAML structure and metadata files match DSH specification', () => {
  const yaml = loadJsYaml();
  const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (v) => v });
  const schema = yaml.DEFAULT_SCHEMA.extend([jsType]);

  const presets = [
    {
      id: 'system-evolver',
      expectedPlugin: './plugins/evolution-tools.js',
      expectedName: '进化工作台',
    },
    {
      id: 'system-evaluator',
      expectedPlugin: './plugins/evaluation-tools.js',
      expectedName: '评测工作台',
    },
  ];

  for (const p of presets) {
    const presetDir = path.join(REPO_ROOT, 'packages', 'system-presets', 'presets', p.id);
    const cordisPath = path.join(presetDir, 'agent.cordis.yml');
    const metadataPath = path.join(presetDir, 'preset.yml');

    assert.ok(fs.existsSync(cordisPath), `${p.id} has agent.cordis.yml`);
    assert.ok(fs.existsSync(metadataPath), `${p.id} has preset.yml`);

    // Verify agent.cordis.yml structure
    const cordisContent = fs.readFileSync(cordisPath, 'utf8');
    const cordisDoc = yaml.load(cordisContent, { schema });

    assert.ok(Array.isArray(cordisDoc), `${p.id} cordis.yml is top-level array`);
    assert.ok(cordisDoc.length >= 3, `${p.id} has at least 3 plugin rows`);

    const rowNames = cordisDoc.map((r) => r.name);
    assert.ok(rowNames.includes('@deepseek-ai/dsh-persona'), `${p.id} includes persona`);
    assert.ok(rowNames.includes(p.expectedPlugin), `${p.id} includes ${p.expectedPlugin}`);
    assert.ok(rowNames.includes('@deepseek-ai/dsh-agent-instructions'), `${p.id} includes instructions`);

    // Verify preset.yml metadata
    const metadataContent = fs.readFileSync(metadataPath, 'utf8');
    const metadataDoc = yaml.load(metadataContent);

    assert.equal(metadataDoc.name, p.expectedName);
    assert.ok(metadataDoc.description && metadataDoc.description.length > 0);
  }
});
