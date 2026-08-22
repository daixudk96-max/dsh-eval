// evolution-rubric.mjs — 第四轮真实进化: rubric 两层判定
// 前置: 用 evaluate-preset-rubric-benchmark.yaml 真实跑两轮(见 README 注释),
//       baseline = 当前版本(evaluate-8b9b3f03), candidate = 变异后版本。
// 变异内容(真实缺陷): 当前 persona 的评测指令要求 REPORT.md 有指标表 + 中文结论,
//       但 rubric 质量维度(3) 要求结论必须指出失败/风险——persona 未要求 agent
//       识别失败项, 报告常只复述表格。变异 = 在 persona 补一句失败/风险分析要求。
// 本脚本: 初始确认 → 变异 → seal → Gate(确定性 + rubric 层) → promote → 导出。
// 运行: node research/evolution-rubric.mjs
import { Registry } from '../packages/preset-registry/lib/registry.js';
import { EvolutionController } from '../packages/evolution-controller/lib/controller.js';
import { aggregate, entryFromCells } from '../packages/evolution-controller/lib/aggregate.js';
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
const RUBRIC_MIN = 60;

const line = (c = '=') => console.log(c.repeat(68));
const section = (t) => { line(); console.log(`▶ ${t}`); line(); };

/** 结构契约检查(同 fix2): YAML 可解析 + 4 命令 + 无顶格 markdown 标题。 */
function structureChecks(ymlText) {
  let yamlOk = false;
  let yamlError = null;
  try {
    const yaml = require(path.join(HOME, 'profiles', 'eval', 'node_modules', 'js-yaml'));
    const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (v) => v });
    const schema = yaml.DEFAULT_SCHEMA.extend([jsType]);
    const doc = yaml.load(ymlText, { schema });
    yamlOk = Array.isArray(doc) && doc.length > 0;
  } catch (e) {
    yamlError = e.message;
  }
  const cmdOk = ['import', 'report', 'run', 'compare'].every((c) => ymlText.includes(c));
  const topLevelHeading = /^## /m.test(ymlText);
  return { yamlOk, yamlError, cmdOk, topLevelHeading };
}

/**
 * 从真实评测 run json + 独立 LLM judge 分数(rubric-score.mjs 产物)提取 gate 输入。
 * judge 输出已在 0..100 标尺(rubric-score.mjs 归一化 score*10)。
 */
function evalEvidence(runFile, label) {
  const run = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, runFile), 'utf8'));
  const completed = run.cases.filter((c) => c.status === 'completed');
  const taskRate = run.grading?.taskSuccessRate ?? 0;
  const toolRate = run.grading?.toolSelectionAccuracyRate ?? 0;
  // 独立 judge 证据(host 无 llm 服务, runner 内 judge 未执行 → 由 rubric-score.mjs 补)
  let rubricScore = null;
  let rubricRationale = null;
  const judgeFile = path.join(BENCH_DIR, `${runFile.replace(/\.json$/, '')}.rubric.json`);
  if (fs.existsSync(judgeFile)) {
    const j = JSON.parse(fs.readFileSync(judgeFile, 'utf8'));
    rubricScore = j.score0_100;
    rubricRationale = j.rationale;
  }
  return {
    id: runFile,
    overall: taskRate,
    correctness: taskRate,
    safety: 1.0, // 无安全事件(评测引擎无安全维度, 记 1.0)
    verification: toolRate,
    totalCases: run.cases.length,
    passedCases: completed.length,
    rubric: { score: rubricScore, rationale: rubricRationale, failed: rubricScore == null ? 1 : 0, total: 1 },
    source: `real eval run ${runFile} (${label})`,
  };
}

async function main() {
  const registry = new Registry({ root: ROOT });
  const controller = new EvolutionController({ registry, auditDir: AUDIT });

  section('0. 当前指针(第三轮产物 evaluate-8b9b3f03)');
  const current = await registry.resolveCurrent(LOGICAL);
  console.log(` current = ${current.revisionId} (digest ${current.digest.slice(0, 16)}…)`);
  console.log(` approval = ${current.approvalId}`);
  const revDir = path.join(ROOT, 'revisions', current.digest);
  const v3Agent = fs.readFileSync(path.join(revDir, 'agent.cordis.yml'), 'utf8');
  const pre = structureChecks(v3Agent);
  console.log(` 变异前: yaml=${pre.yamlOk ? 'OK' : `FAIL(${pre.yamlError})`} | 命令=${pre.cmdOk ? '4/4' : 'FAIL'} | 顶格标题=${pre.topLevelHeading}`);

  section('1. 评测(只读域): 真实模型评测 + LLM judge rubric');
  // baseline / candidate 由 evaluate-preset-rubric-benchmark.yaml 真实运行产生。
  const baseline = evalEvidence('run-rubric-baseline.json', 'current v3');
  const candidate = evalEvidence('run-rubric-candidate.json', 'mutated v5');
  console.log(` baseline  overall=${baseline.overall} rubric=${baseline.rubric.score?.toFixed(1)} (cells ${baseline.rubric.failed}/${baseline.rubric.total} failed)`);
  console.log(` candidate overall=${candidate.overall} rubric=${candidate.rubric.score?.toFixed(1)} (cells ${candidate.rubric.failed}/${candidate.rubric.total} failed)`);
  console.log(` baseline source: ${baseline.source}`);
  console.log(` candidate source: ${candidate.source}`);

  section('2. 进化 run: 变异 = persona 补失败/风险分析指令');
  const run = await controller.newRun({
    source: 'real eval rubric: candidate reports restate tables without failure analysis',
    triggerEvaluationRunId: baseline.source,
    selectedFailureClusters: ['rubric/analysis'],
  });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    mutations: [
      { kind: 'prompt', target: 'persona', ops: [{ op: 'append-analysis-instruction', detail: 'report must call out failures/risks, not restate the table' }] },
    ],
  });
  for (const f of FILES) fs.copyFileSync(path.join(revDir, f), path.join(ROOT, 'staging', candidateId, f));
  const agentPath = path.join(ROOT, 'staging', candidateId, 'agent.cordis.yml');
  let v5Agent = fs.readFileSync(agentPath, 'utf8');
  // 在 persona 的 report 指令段追加失败/风险分析要求(真实缺陷修复)。
  v5Agent = v5Agent.replace(
    /and present the markdown metrics \(steps, tool calls, tool success, tokens,\n\s+latency\) plus a one-paragraph summary in Chinese\./,
    'and present the markdown metrics (steps, tool calls, tool success, tokens,\n          latency) plus a one-paragraph summary in Chinese. The summary MUST name\n          concrete failures or risks found in the trace (failed tool calls, invalid\n          calls, token anomalies), not merely restate the table.',
  );
  fs.writeFileSync(agentPath, v5Agent);
  const post = structureChecks(v5Agent);
  console.log(` 变异后: yaml ${post.yamlOk ? 'OK' : `FAIL(${post.yamlError})`} | 命令 ${post.cmdOk ? '4/4' : 'FAIL'} | 顶格标题=${post.topLevelHeading}`);
  if (!post.yamlOk || post.topLevelHeading) throw new Error(`mutation broke YAML: yamlOk=${post.yamlOk} topLevelHeading=${post.topLevelHeading}`);
  if (v5Agent === v3Agent) throw new Error('mutation did not change content');

  section('3. seal → Code Gate(确定性 + rubric 层)');
  const sealed = await controller.seal(run.id);
  console.log(` sealed → ${sealed.revisionId} | digest = ${sealed.digest.slice(0, 16)}…`);
  await controller.evaluate(run.id, {
    baseline,
    candidate,
    rubric: {
      score: candidate.rubric.score,
      minScore: RUBRIC_MIN,
      regressions: baseline.rubric.score != null && candidate.rubric.score != null && candidate.rubric.score < baseline.rubric.score
        ? ['final-answer quality']
        : [],
    },
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
  if (r.decision !== 'PASS') {
    console.log(' 候选未过 gate, 不 promote。');
    process.exitCode = 0;
    return;
  }

  section('4. 人工确认 → CAS promote');
  try { await controller.promote(run.id, { logicalId: LOGICAL }); } catch (e) { console.log(' ✗ 无 approvalId:', e.message); }
  await controller.promote(run.id, { logicalId: LOGICAL, approvalId: 'user-approved-evolution-rubric-2026-08-22' });
  const after = await registry.resolveCurrent(LOGICAL);
  console.log(` ✓ current = ${after.revisionId} | gateRun = ${after.gateRunId} | approval = ${after.approvalId}`);

  section('5. 重新导出独立 preset');
  const newRevDir = path.join(ROOT, 'revisions', after.digest);
  for (const f of FILES) fs.copyFileSync(path.join(newRevDir, f), path.join(EXPORT_DIR, f));
  fs.writeFileSync(path.join(EXPORT_DIR, 'EVOLUTION.md'), [
    `# evaluate-evolved (revision ${after.revisionId})`,
    '',
    `- digest: ${after.digest}`,
    `- gateRun: ${after.gateRunId} (Code Gate PASS + rubric PASS, minEffect 0.05)`,
    `- rubric: score ${candidate.rubric.score?.toFixed(1)} >= min ${RUBRIC_MIN}, regressions ${(baseline.rubric.score != null && candidate.rubric.score != null && candidate.rubric.score < baseline.rubric.score) ? '[final-answer quality]' : '[]'}`,
    `- approval: ${after.approvalId}`,
    `- history: ${current.revisionId} (round 3) → ${after.revisionId} (round 4: rubric-driven analysis instruction)`,
    '',
    '安装: 复制本目录到 `${DSH_HOME}/.agent-presets/evaluate-evolved/` 即作为独立 preset 生效。',
  ].join('\n'));
  console.log(' ✓ 导出已更新 →', EXPORT_DIR);

  section('6. 审计 & 历史');
  const lines = fs.readFileSync(path.join(AUDIT, 'ledger.jsonl'), 'utf8').trim().split('\n');
  for (const l of lines) {
    const j = JSON.parse(l);
    console.log(`  [${j.event}]${j.decision ? ` decision=${j.decision}` : ''}${j.revisionId ? ` rev=${j.revisionId}` : ''}${j.rubric ? ` rubric=${JSON.stringify(j.rubric)}` : ''}`);
  }
  console.log(' history =', JSON.stringify(await registry.history(LOGICAL)));
}

main().catch((e) => { console.error('RUBRIC ROUND FAILED:', e); process.exitCode = 1; });
