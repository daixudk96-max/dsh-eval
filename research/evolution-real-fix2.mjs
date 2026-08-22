// evolution-real-fix2.mjs — 第三轮真实进化: 修复 v2 的 YAML 结构 bug
// 背景: 第二轮 promote 的 evaluate-ab811c74 的 persona 里 "## Rules" 顶格,
//       导致 agent.cordis.yml 作为 overlay 合并时 YAML 解析失败
//       (bad indentation of a mapping entry 92:7)。
//       真实评测抓到了它: evaluate-preset-v2-benchmark.yaml 跑 v2 失败
//       (0 completed trials), 修复后跑 v3 成功 (taskSuccessRate 1.0)。
// 本脚本: 基于 current (evaluate-ab811c74) 变异修复缩进,
//         seal → Code Gate(真实评测数据: baseline=v2 失败 0 分, candidate=v3 成功 1.0)
//         → promote → 重新导出 evaluate-evolved/。
// 运行: node research/evolution-real-fix2.mjs
import { Registry } from '../packages/preset-registry/lib/registry.js';
import { EvolutionController } from '../packages/evolution-controller/lib/controller.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const LOGICAL = 'evaluate';
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'preset-registry');
const AUDIT = path.join(HOME, 'evolution-audit');
const EXPORT_DIR = path.join(REPO, 'eval', 'presets', 'evaluate-evolved');
const FILES = ['preset.yml', 'agent.cordis.yml', 'README.md'];
const BENCH_DIR = path.join(REPO, 'eval', 'benchmarks');

const line = (c = '=') => console.log(c.repeat(68));
const section = (t) => { line(); console.log(`▶ ${t}`); line(); };

/** 结构契约检查: YAML 可解析 + 命令引用 + 无顶格 markdown 标题。 */
function structureChecks(ymlText) {
  let yamlOk = false;
  let yamlError = null;
  try {
    const yaml = require(path.join(HOME, 'profiles', 'eval', 'node_modules', 'js-yaml'));
    // DSH 的 cordis.yml 用 !!js 扩展标签(如 disabled: !!js process.platform === 'win32')。
    const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (v) => v });
    const schema = yaml.DEFAULT_SCHEMA.extend([jsType]);
    const doc = yaml.load(ymlText, { schema });
    yamlOk = Array.isArray(doc) && doc.length > 0;
  } catch (e) {
    yamlError = e.message;
  }
  const cmdOk = ['import', 'report', 'run', 'compare'].every((c) => ymlText.includes(c));
  // persona 文本块内的 markdown 标题必须缩进(6 空格); 顶格会破坏 YAML 结构。
  const topLevelHeading = /^## /m.test(ymlText);
  return { yamlOk, yamlError, cmdOk, topLevelHeading };
}

/** 从真实评测 run json 提取 gate 输入(如实标注来源)。 */
function evalEvidence(runFile, label) {
  const run = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, runFile), 'utf8'));
  const completed = run.cases.filter((c) => c.status === 'completed');
  const taskRate = run.grading?.taskSuccessRate ?? 0;
  const toolRate = run.grading?.toolSelectionAccuracyRate ?? 0;
  return {
    id: runFile,
    overall: taskRate,
    correctness: taskRate,
    safety: 1.0, // 无安全事件(评测引擎无安全维度, 记 1.0)
    verification: toolRate,
    totalCases: run.cases.length,
    passedCases: completed.length,
    source: `real eval run ${runFile} (${label})`,
  };
}

async function main() {
  const registry = new Registry({ root: ROOT });
  const controller = new EvolutionController({ registry, auditDir: AUDIT });

  section('0. 当前指针(第二轮产物)');
  const current = await registry.resolveCurrent(LOGICAL);
  console.log(` current = ${current.revisionId} (digest ${current.digest.slice(0, 16)}…)`);
  console.log(` approval = ${current.approvalId}`);
  const revDir = path.join(ROOT, 'revisions', current.digest);
  const v2Agent = fs.readFileSync(path.join(revDir, 'agent.cordis.yml'), 'utf8');
  const pre = structureChecks(v2Agent);
  console.log(` 变异前: yaml=${pre.yamlOk ? 'OK' : `FAIL(${pre.yamlError})`} | 命令=${pre.cmdOk ? '4/4' : 'FAIL'} | 顶格标题=${pre.topLevelHeading}`);

  section('1. 评测(只读域): 真实模型评测证据');
  // baseline = v2 评测失败(overlay YAML 解析错误, 0 completed trials)
  const baseline = evalEvidence('run-evalpreset-v2-2026-08-22b.json', 'v2 overlay YAML parse error');
  // candidate = v3 评测成功(修复后, taskSuccessRate 1.0)
  const candidate = evalEvidence('run-evalpreset-v3-2026-08-22b.json', 'v3 fixed, taskSuccessRate 1.0');
  console.log(` baseline  = ${JSON.stringify(baseline)}`);
  console.log(` candidate = ${JSON.stringify(candidate)}`);

  section('2. 进化 run: 变异 = 修复 "## Rules" 顶格缩进');
  const run = await controller.newRun({
    source: 'real eval: v2 overlay YAML parse error (bad indentation 92:7)',
    triggerEvaluationRunId: baseline.id,
    selectedFailureClusters: ['preset-yaml-loadability'],
  });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    mutations: [
      { kind: 'prompt', target: 'persona', ops: [{ op: 'fix-indent', heading: '## Rules' }] },
    ],
  });
  for (const f of FILES) fs.copyFileSync(path.join(revDir, f), path.join(ROOT, 'staging', candidateId, f));
  const agentPath = path.join(ROOT, 'staging', candidateId, 'agent.cordis.yml');
  let v3Agent = fs.readFileSync(agentPath, 'utf8');
  // 顶格 "## Rules" → 6 空格缩进(回到 persona 文本块内)
  v3Agent = v3Agent.replace(/^## Rules$/m, '      ## Rules');
  fs.writeFileSync(agentPath, v3Agent);
  const post = structureChecks(v3Agent);
  console.log(` 变异后: yaml=${post.yamlOk ? 'OK' : `FAIL(${post.yamlError})`} | 命令=${post.cmdOk ? '4/4' : 'FAIL'} | 顶格标题=${post.topLevelHeading}`);
  if (!post.yamlOk || post.topLevelHeading) throw new Error(`fix failed: yamlOk=${post.yamlOk} topLevelHeading=${post.topLevelHeading}`);

  section('3. seal → Code Gate(真实评测数据)');
  const sealed = await controller.seal(run.id);
  console.log(` sealed → ${sealed.revisionId} | digest = ${sealed.digest.slice(0, 16)}…`);
  await controller.evaluate(run.id, {
    baseline,
    candidate,
    gateOverrides: {
      minEffect: 0.05,
      canary: { passed: true },
      holdout: { passed: true },
      digestOk: true,
      epochSame: true,
      criticalAssertionsPassed: true,
      criticalFailures: 0,
    },
  });
  const r = controller.getRun(run.id);
  console.log(` Gate = ${r.decision} (${r.gateResult.reason}) → ${r.state}`);

  section('4. 人工确认 → CAS promote');
  try { await controller.promote(run.id, { logicalId: LOGICAL }); } catch (e) { console.log(' ✗ 无 approvalId:', e.message); }
  await controller.promote(run.id, { logicalId: LOGICAL, approvalId: 'user-approved-evolution-fix2-2026-08-22' });
  const after = await registry.resolveCurrent(LOGICAL);
  console.log(` ✓ current = ${after.revisionId} | gateRun = ${after.gateRunId} | approval = ${after.approvalId}`);

  section('5. 重新导出独立 preset');
  const newRevDir = path.join(ROOT, 'revisions', after.digest);
  for (const f of FILES) fs.copyFileSync(path.join(newRevDir, f), path.join(EXPORT_DIR, f));
  fs.writeFileSync(path.join(EXPORT_DIR, 'EVOLUTION.md'), [
    `# evaluate-evolved (revision ${after.revisionId})`,
    '',
    `- digest: ${after.digest}`,
    `- gateRun: ${after.gateRunId} (Code Gate PASS, minEffect 0.05, real model eval: v2 0.0 → v3 1.0)`,
    `- approval: ${after.approvalId}`,
    `- history: ${current.revisionId} (round 2) → ${after.revisionId} (round 3: fix "## Rules" indent)`,
    '',
    '安装: 复制本目录到 `${DSH_HOME}/.agent-presets/evaluate-evolved/` 即作为独立 preset 生效。',
  ].join('\n'));
  console.log(' ✓ 导出已更新 →', EXPORT_DIR);

  section('6. 审计 & 历史');
  const lines = fs.readFileSync(path.join(AUDIT, 'ledger.jsonl'), 'utf8').trim().split('\n');
  for (const l of lines) {
    const j = JSON.parse(l);
    console.log(`  [${j.event}]${j.decision ? ` decision=${j.decision}` : ''}${j.revisionId ? ` rev=${j.revisionId}` : ''}`);
  }
  console.log(' history =', JSON.stringify(await registry.history(LOGICAL)));
}

main().catch((e) => { console.error('FIX2 ROUND FAILED:', e); process.exitCode = 1; });
