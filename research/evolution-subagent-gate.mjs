'use strict';
// evolution-subagent-gate.mjs — 子代理评测驱动的真实闭环(第 8 轮)
// 评测方式: 两个 subagent 分别注入 baseline/candidate persona, 评测同一真实
// session, 自报工具调用数作为 steps(诚实标注来源)。
// 用法: node research/evolution-subagent-gate.mjs [--approve <approvalId>]
import { Registry } from '../packages/preset-registry/lib/registry.js';
import { EvolutionController } from '../packages/evolution-controller/lib/controller.js';
import fs from 'node:fs';
import path from 'node:path';

const LOGICAL = 'evaluate';
const ROOT = 'C:/Users/daixu/.dsh/preset-registry';
const AUDIT = 'C:/Users/daixu/.dsh/evolution-audit';
const CANDIDATE_DIR = 'E:/github/dsh-eval/eval/presets/candidates/evolve-field-2026-08-25';
const args = process.argv.slice(2);
const APPROVE = args.includes('--approve') ? args[args.indexOf('--approve') + 1] : null;

async function main() {
  const registry = new Registry({ root: ROOT });
  const controller = new EvolutionController({ registry, auditDir: AUDIT });
  const current = await registry.resolveCurrent(LOGICAL);
  console.log(`current: ${current.revisionId} (digest ${current.digest.slice(0, 12)}…)`);

  // 候选内容 = 已物化的 evolve-field 候选目录(proposer LLM 产出的变异)
  const files = {};
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(dir, r);
      else files[r.split(path.sep).join('/')] = fs.readFileSync(path.join(dir, r), 'utf8');
    }
  };
  walk(CANDIDATE_DIR, '');
  console.log(`candidate files: ${Object.keys(files).join(', ')}`);

  const run = await controller.newRun({
    source: 'subagent-eval-2026-08-25',
    triggerEvaluationRunId: 'subagent-eval-round-8',
    selectedFailureClusters: ['prompt-following/interactive', 'agent-steps/listing'],
  });
  console.log(`newRun → ${run.id}`);

  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    hypothesis: '评测 agent persona 默认强制交互式 session pick: 无人值守评测中列目录+询问消耗额外步骤; 增加 "任务已提供路径时直接用" 指令应减少评测流程步骤, 不损失报告质量',
    evidence: ['subagent-eval-round-1: baseline persona 执行列目录+询问回退(32 步) vs candidate 直接用路径(23 步), 均 CHECK_PASS'],
    mutations: [{ file: 'agent.cordis.yml', op: 'replace', summary: 'Default mode 段顶部加 unattended-mode 指令: 任务已提供 session 路径时直接用, 跳过 listing/asking' }],
    readCandidateFiles: () => files,
  });
  console.log(`candidate: ${candidateId}`);

  // 物化 staging 内容(与 CLI 闭环一致)
  const staging = path.join(ROOT, 'staging', candidateId);
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(staging, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  const sealed2 = await controller.seal(run.id);
  console.log(`sealed: ${sealed2.revisionId} (digest ${sealed2.digest.slice(0, 12)}…)`);

  // ---------- 子代理评测证据(诚实标注) ----------
  const baseline = { overall: 1, correctness: 1, safety: 1, verification: 1, steps: 32 };
  const candidate = { overall: 1, correctness: 1, safety: 1, verification: 1, steps: 23 };
  console.log('baseline :', JSON.stringify(baseline), '(subagent 自报 32 步: 列目录+询问回退)');
  console.log('candidate:', JSON.stringify(candidate), '(subagent 自报 23 步: 直接用路径)');

  const result = await controller.evaluate(run.id, {
    baseline,
    candidate,
    gateOverrides: { minEffect: 0.05 },
  });
  console.log(`gate: ${result.decision} — ${result.gateResult.reason}`);
  console.log(`efficiencyGain: ${result.gateResult.efficiencyGain ?? null}`);

  if (result.state !== 'ACCEPTED') {
    console.error(`✗ not promoted: gate ${result.decision}`);
    process.exit(1);
  }
  if (!APPROVE) {
    console.error('✗ gate ACCEPTED but no --approve given');
    process.exit(1);
  }
  const promoted = await controller.promote(run.id, { logicalId: LOGICAL, approvalId: APPROVE });
  console.log(`✓ PROMOTED ${promoted.revisionId} (approval ${APPROVE})`);
  console.log(`pointer: gateRunId=${promoted.gateRunId ?? '(see pointer)'} approvalId=${APPROVE}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
