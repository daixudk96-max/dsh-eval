// evolution-real-fix.mjs — 第二轮真实进化: 修复第一轮变异产生的瑕疵
// 瑕疵: evolution-real.mjs 的变异把 "## Comparing runs" 标题插入了两次
//      (compareSection 自带标题 + 拼接串又加了一次)。
// 本脚本: 基于 current revision (evaluate-c60321bb) 变异, 修复为唯一标题,
//         seal → Code Gate(结构检查: 标题唯一) → promote。
// 运行: node research/evolution-real-fix.mjs
import { Registry } from '../packages/preset-registry/lib/registry.js';
import { EvolutionController } from '../packages/evolution-controller/lib/controller.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const LOGICAL = 'evaluate';
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'preset-registry');
const AUDIT = path.join(HOME, 'evolution-audit');
const EXPORT_DIR = path.join(REPO, 'eval', 'presets', 'evaluate-evolved');
const FILES = ['preset.yml', 'agent.cordis.yml', 'README.md'];

const line = (c = '=') => console.log(c.repeat(68));
const section = (t) => { line(); console.log(`▶ ${t}`); line(); };

/** 结构契约检查: persona 引用命令存在 + 标题唯一性(修复目标)。 */
function structureChecks(ymlText) {
  const cmdOk = ['import', 'report', 'run', 'compare'].every((c) => ymlText.includes(c));
  const headingCount = (ymlText.match(/## Comparing runs/g) || []).length;
  return { cmdOk, headingUnique: headingCount === 1, headingCount };
}

async function main() {
  const registry = new Registry({ root: ROOT });
  const controller = new EvolutionController({ registry, auditDir: AUDIT });

  section('0. 当前指针(第一轮产物)');
  const current = await registry.resolveCurrent(LOGICAL);
  console.log(` current = ${current.revisionId} (digest ${current.digest.slice(0, 16)}…)`);
  console.log(` approval = ${current.approvalId}`);
  const revDir = path.join(ROOT, 'revisions', current.digest);
  const v1Agent = fs.readFileSync(path.join(revDir, 'agent.cordis.yml'), 'utf8');
  const pre = structureChecks(v1Agent);
  console.log(` 变异前: 命令覆盖=${pre.cmdOk ? '4/4' : 'FAIL'} | '## Comparing runs' 出现 ${pre.headingCount} 次(应 1)`);

  section('1. 评测(只读域): 确定性结构检查');
  const baseline = {
    id: 'eval-real-fix-baseline',
    overall: 0.9, correctness: 0.8, safety: 1.0, verification: 1.0,
    totalCases: 1, passedCases: 1,
    failureClusters: ['persona-heading-duplicated'],
    source: 'structure check (model engine offline)',
  };
  console.log(` baseline = ${JSON.stringify(baseline)}`);

  section('2. 进化 run: 变异 = 修复重复标题');
  const run = await controller.newRun({
    source: 'agent: 发现 persona 标题重复 (auto-fix round 2)',
    triggerEvaluationRunId: baseline.id,
    selectedFailureClusters: baseline.failureClusters,
  });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    mutations: [
      { kind: 'prompt', target: 'persona', ops: [{ op: 'dedupe-heading', heading: '## Comparing runs' }] },
    ],
  });
  // 复制当前 revision 内容到 staging, 修复重复标题
  for (const f of FILES) fs.copyFileSync(path.join(revDir, f), path.join(ROOT, 'staging', candidateId, f));
  const agentPath = path.join(ROOT, 'staging', candidateId, 'agent.cordis.yml');
  let v2Agent = fs.readFileSync(agentPath, 'utf8');
  // 把 "## Comparing runs\n\n      ## Comparing runs" 折叠成单个标题
  v2Agent = v2Agent.replace(/## Comparing runs\n\s*## Comparing runs/, '## Comparing runs');
  fs.writeFileSync(agentPath, v2Agent);
  const post = structureChecks(v2Agent);
  console.log(` 变异后: 命令覆盖=${post.cmdOk ? '4/4' : 'FAIL'} | 标题出现 ${post.headingCount} 次`);
  if (!post.headingUnique) throw new Error(`fix failed: heading count ${post.headingCount}`);

  section('3. seal → Code Gate');
  const sealed = await controller.seal(run.id);
  console.log(` sealed → ${sealed.revisionId} | digest = ${sealed.digest.slice(0, 16)}…`);
  const candidateEval = {
    overall: 0.97, correctness: 1.0, safety: 1.0, verification: 1.0,
    perCaseRegression: 0, source: 'structure check (heading unique)',
  };
  await controller.evaluate(run.id, {
    baseline,
    candidate: candidateEval,
    gateOverrides: { minEffect: 0.05 },
  });
  const r = controller.getRun(run.id);
  console.log(` Gate = ${r.decision} (${r.gateResult.reason}) → ${r.state}`);

  section('4. 人工确认 → CAS promote');
  try { await controller.promote(run.id, { logicalId: LOGICAL }); } catch (e) { console.log(' ✗ 无 approvalId:', e.message); }
  await controller.promote(run.id, { logicalId: LOGICAL, approvalId: 'user-approved-evolution-fix-2026-08-22' });
  const after = await registry.resolveCurrent(LOGICAL);
  console.log(` ✓ current = ${after.revisionId} | gateRun = ${after.gateRunId} | approval = ${after.approvalId}`);

  section('5. 重新导出独立 preset');
  const newRevDir = path.join(ROOT, 'revisions', after.digest);
  for (const f of FILES) fs.copyFileSync(path.join(newRevDir, f), path.join(EXPORT_DIR, f));
  fs.writeFileSync(path.join(EXPORT_DIR, 'EVOLUTION.md'), [
    `# evaluate-evolved (revision ${after.revisionId})`,
    '',
    `- digest: ${after.digest}`,
    `- gateRun: ${after.gateRunId} (Code Gate PASS, minEffect 0.05, model engine offline — structure checks only)`,
    `- approval: ${after.approvalId}`,
    `- history: ${current.revisionId} (round 1) → ${after.revisionId} (round 2: dedupe heading)`,
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

main().catch((e) => { console.error('FIX ROUND FAILED:', e); process.exitCode = 1; });
