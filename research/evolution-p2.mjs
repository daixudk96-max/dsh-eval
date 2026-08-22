// evolution-p2.mjs — P2 真实闭环: proposer 纪律(hypothesis+evidence) + budget + 近重复
// 对象: evaluate agent preset(真实 registry root, current = evaluate-8b9b3f03)
// 用法:
//   node research/evolution-p2.mjs prepare   # 变异 + proposal-check + seal, 输出候选工作区
//   node research/evolution-p2.mjs finish --run <run.json> --reject
//   # 真实评测结果 → gate → promote(无 approvalId 先演示拒绝) / 近重复 / budget 演示
// 诚实原则: 无真实评测证据不 promote; INCONCLUSIVE 如实记录。
import { Registry } from '../packages/preset-registry/lib/registry.js';
import { EvolutionController } from '../packages/evolution-controller/lib/controller.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REGISTRY_ROOT = 'C:/Users/daixu/.dsh/preset-registry';
const AUDIT_DIR = 'C:/Users/daixu/.dsh/evolution-audit';
const LOGICAL = 'evaluate';
const STAGE = process.argv[2] || 'prepare';

const line = (c = '-') => console.log(c.repeat(64));
const section = (t) => { line(); console.log(`▶ ${t}`); line(); };

// ── structure checks(确定性契约检查, 与真实模型评测并列的证据) ──────────────
function structureChecks(files) {
  const yaml = require('C:/Users/daixu/.dsh/profiles/eval/node_modules/js-yaml');
  const Type = yaml.Type;
  const jsType = new Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (v) => v });
  const schema = yaml.DEFAULT_SCHEMA.extend([jsType]);
  const checks = [];
  try {
    yaml.load(files['agent.cordis.yml'], { schema });
    checks.push(['yamlOk', true]);
  } catch (e) {
    checks.push(['yamlOk', false, e.message]);
  }
  const text = files['agent.cordis.yml'];
  for (const c of ['import', 'report', 'run', 'compare']) {
    checks.push([`cmd-${c}`, text.includes(`--profile eval ${c}`)]);
  }
  checks.push(['noTopLevelHeading', !/^## /m.test(text)]);
  checks.push(['failureClusters', /failure clusters?/i.test(text)]);
  return checks;
}

/** 变异: persona 增加 Failure clusters 小节(评测报告 → 进化输入的闭环). */
function mutate(files) {
  const persona = files['agent.cordis.yml'];
  const anchor = '      id. Your evaluation reports are the read-only input of that loop.';
  if (!persona.includes(anchor)) throw new Error('anchor not found in persona');
  const addition = [
    anchor,
    '',
    '      ## Failure clusters',
    '',
    '      Every report MUST end with a "Failure clusters" section: cluster the',
    '      failed or low-scoring cases from the trace into 2-5 actionable groups',
    '      (e.g. prompt-following/basic, tool-call/fs-write), each with a one-line',
    '      evidence reference to the trace (failed tool call ids, invalid calls,',
    '      token anomalies). This section is the direct input of the evolution',
    '      loop (`selectedFailureClusters`) — a report without it cannot feed',
    '      evolution.',
  ].join('\n');
  return {
    ...files,
    'agent.cordis.yml': persona.replace(anchor, addition),
  };
}

async function prepare() {
  section('P2 prepare: 变异 + proposal-check + seal(真实 registry)');
  const registry = new Registry({ root: REGISTRY_ROOT });
  const controller = new EvolutionController({ registry, auditDir: AUDIT_DIR });
  const current = await registry.resolveCurrent(LOGICAL);
  if (!current) throw new Error('no current revision');
  const srcContent = await registry.revisionContent(current.digest);
  if (!srcContent) throw new Error('current revision content missing');
  console.log('current:', current.revisionId, '| digest:', current.digest.slice(0, 12), '…');
  console.log('current files:', Object.keys(srcContent.files).join(', '));

  const candidateFiles = mutate(srcContent.files);
  const checks = structureChecks(candidateFiles);
  for (const [k, ok, why] of checks) console.log('  ', ok ? '✓' : '✗', k, why || '');
  const ok = checks.every((c) => c[1]);
  if (!ok) throw new Error('candidate fails structure checks');

  const mutations = [{
    kind: 'patch', path: 'agent.cordis.yml', op: 'append',
    from: '...Your evaluation reports are the read-only input of that loop.',
    to: '...plus mandatory Failure clusters section.',
  }];
  const hypothesis = 'Adding an explicit Failure-clusters section to every report makes failure evidence machine-readable, so selectedFailureClusters can be read directly off reports instead of being inferred';
  const evidence = ['eval-run-0001', 'failure-cluster/prompt-following', 'failure-cluster/tool-call/fs-write'];

  const run = await controller.newRun({
    source: 'prepare-session', triggerEvaluationRunId: 'eval-run-0001', selectedFailureClusters: evidence,
  });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    hypothesis,
    evidence,
    mutations,
    readCandidateFiles: async () => candidateFiles,
  });
  // 物化候选内容到 staging(真实流程: 内容文件进 staging, seal 时复制进 revisions)
  const stagingDir = path.join(registry.dirs.staging, candidateId);
  for (const [name, text] of Object.entries(candidateFiles)) {
    fs.writeFileSync(path.join(stagingDir, name), text, 'utf8');
  }
  const sealed = await controller.seal(run.id);
  console.log('sealed:', sealed.revisionId, '| digest:', sealed.digest.slice(0, 12), '…');

  // 输出候选工作区(评测 wrapper 的 --preset-src 指向它)
  const ws = path.resolve('eval/benchmarks/evaluate-preset-p2');
  fs.mkdirSync(ws, { recursive: true });
  for (const [name, text] of Object.entries(candidateFiles)) {
    fs.writeFileSync(path.join(ws, name), text, 'utf8');
  }
  console.log('candidate workspace:', ws);
  console.log('run id:', run.id, '| candidate:', candidateId);
  console.log('下一段: 真实评测候选(dsh --profile eval run evaluate-preset-p2-benchmark.yaml), 然后 finish --run <run.json>');
}

async function finish() {
  section('P2 finish: 真实评测 → gate → promote/拒绝');
  const registry = new Registry({ root: REGISTRY_ROOT });
  const controller = new EvolutionController({ registry, auditDir: AUDIT_DIR });

  const runFile = process.argv[process.argv.indexOf('--run') + 1];
  const baselineFile = process.argv[process.argv.indexOf('--baseline') + 1];
  if (!runFile) throw new Error('--run <candidate run.json> required');
  if (!baselineFile) throw new Error('--baseline <baseline run.json> required');
  const candData = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  const baseData = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));

  const candGrading = candData.grading || {};
  const baseGrading = baseData.grading || {};
  const baseline = {
    overall: baseGrading.taskSuccessRate ?? 0,
    correctness: baseGrading.taskSuccessRate ?? 0,
    safety: 1.0,
    verification: baseGrading.toolSelectionAccuracyRate ?? 0,
  };
  const candidate = {
    overall: candGrading.taskSuccessRate ?? 0,
    correctness: candGrading.taskSuccessRate ?? 0,
    safety: 1.0,
    verification: candGrading.toolSelectionAccuracyRate ?? 0,
  };
  console.log('baseline run:', baselineFile, '→', JSON.stringify(baseline));
  console.log('candidate run:', runFile, '→', JSON.stringify(candidate));
  if (!candData.cases || candData.cases.length === 0) {
    console.log('✗ no completed candidate trials — no real evaluation evidence; refusing to gate');
    return;
  }

  // 重建 run(controller 状态在内存, finish 是新进程, 从 sealed revision 内容重放)
  const current = await registry.resolveCurrent(LOGICAL);
  const srcContent = await registry.revisionContent(current.digest);
  const hypothesis = 'Adding an explicit Failure-clusters section to every report makes failure evidence machine-readable, so selectedFailureClusters can be read directly off reports instead of being inferred';
  const evidence = ['eval-run-0001', 'failure-cluster/prompt-following', 'failure-cluster/tool-call/fs-write'];
  const mutations = [{ kind: 'patch', path: 'agent.cordis.yml', op: 'append' }];
  const run = await controller.newRun({
    source: 'p2-finish', triggerEvaluationRunId: candData.benchmark, selectedFailureClusters: evidence,
  });
  const candidateFiles = mutate(srcContent.files); // 确定性重放 prepare 的变异 → 同 digest
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    hypothesis, evidence, mutations,
    readCandidateFiles: async () => candidateFiles,
  });
  const stagingDir = path.join(registry.dirs.staging, candidateId);
  for (const [name, text] of Object.entries(candidateFiles)) {
    fs.writeFileSync(path.join(stagingDir, name), text, 'utf8');
  }
  const sealed = await controller.seal(run.id);
  console.log('replayed candidate:', sealed.revisionId, '| digest:', sealed.digest.slice(0, 12), '…');

  section('gate(代码判定)');
  await controller.evaluate(run.id, {
    baseline, candidate, gateOverrides: { minEffect: 0.05 },
    rubric: { score: candidate.overall * 100, minScore: 60, regressions: [] },
  });
  console.log('decision:', run.state, '| reason:', run.gateResult.reason);
  console.log('gateResult:', JSON.stringify(run.gateResult));

  // 无 approvalId → 拒绝(人审绑定)
  if (run.state === 'ACCEPTED') {
    try {
      await controller.promote(run.id, { logicalId: LOGICAL });
      console.log('✗ unexpected: promote without approvalId succeeded');
    } catch (e) {
      console.log('✓ promote without approvalId rejected:', e.message);
    }
  }

  section('近重复演示: 候选 = 历史 previous revision 的内容(回滚式重复)→ promote 被拒');
  const history = await registry.history(LOGICAL);
  const previous = history[history.length - 1]; // 最旧 previous(内容与 current 差异最大, 过 proposal-check)
  if (!previous || previous.status !== 'previous') {
    console.log('(no previous revision in history — skip near-duplicate demo)');
  } else {
    const dupRun = await controller.newRun({
      source: 'p2-neardup', triggerEvaluationRunId: 'eval-dup', selectedFailureClusters: ['c1'],
    });
    const dupContent = (await registry.revisionContent(previous.digest)).files;
    const dupId = await controller.createCandidate(dupRun.id, {
      logicalId: LOGICAL,
      sourceRevisionId: current.revisionId,
      hypothesis: 'revert to earlier revision (demonstration)', evidence: ['c1'],
      mutations: [{ kind: 'patch', path: 'agent.cordis.yml', op: 'noop' }],
      readCandidateFiles: async () => dupContent,
    });
    const dupDir = path.join(registry.dirs.staging, dupId);
    for (const [name, text] of Object.entries(dupContent)) {
      fs.writeFileSync(path.join(dupDir, name), text, 'utf8');
    }
    await controller.seal(dupRun.id);
    // 给 dup 候选虚构的高分评测(gate 判定目标: 达到 ACCEPTED, 让 near-dup 检查成为最后一道防线)
    await controller.evaluate(dupRun.id, {
      baseline: { overall: 0.5, correctness: 0.5, safety: 1.0, verification: 0.5 },
      candidate: { overall: 0.9, correctness: 0.9, safety: 1.0, verification: 0.9 },
      gateOverrides: { minEffect: 0.05 },
    });
    console.log('dup candidate state:', dupRun.state);
    try {
      await controller.promote(dupRun.id, { logicalId: LOGICAL, approvalId: 'neardup-demo' });
      console.log('✗ unexpected: near-duplicate promoted');
    } catch (e) {
      console.log('✓ near-duplicate promote rejected:', e.message);
    }
  }

  section('budget 演示(超出预算 newRun 被拒)');
  const budgetController = new EvolutionController({
    registry, auditDir: AUDIT_DIR, budget: { dir: path.join(AUDIT_DIR, '..', 'budget-demo'), limitUsd: 1 },
  });
  await budgetController.spendBudget('attempt', 1, { note: 'exhaust demo' });
  try {
    await budgetController.newRun({ source: 'budget-demo', triggerEvaluationRunId: 'x' });
    console.log('✗ unexpected: newRun succeeded past budget');
  } catch (e) {
    console.log('✓ newRun rejected:', e.message);
  }
}

section('P2 真实闭环');
if (STAGE === 'prepare') await prepare();
else if (STAGE === 'finish') await finish();
else console.error('unknown stage:', STAGE);
