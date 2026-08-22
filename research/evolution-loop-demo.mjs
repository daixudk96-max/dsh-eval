// evolution-loop-demo.mjs
// 完整闭环演示：初始安装 → 评测 → 候选 → 封印 → Code Gate → Promote → 回滚 → 反例
// 使用真实实现：packages/preset-registry + packages/evolution-controller
// 运行：node research/evolution-loop-demo.mjs
import { Registry } from '../packages/preset-registry/lib/registry.js';
import { EvolutionController } from '../packages/evolution-controller/lib/controller.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-loop-demo-'));
const LOGICAL = 'coding';

const line = (c = '-') => console.log(c.repeat(64));
const section = (t) => { line(); console.log(`▶ ${t}`); line(); };

async function main() {
  const registry = new Registry({ root });
  const controller = new EvolutionController({ registry, auditDir: path.join(root, 'audit') });

  // ---------- 0. 初始安装：确立基线 revision coding-v1 ----------
  section('0. 初始安装：确立基线版本（current 指针 = coding-v1）');
  const seed = await registry.createCandidate(LOGICAL, { sourceRevisionId: null, evolutionRunId: 'install' });
  const seedSealed = await registry.sealRevision(seed);
  const seedPromoted = await registry.promote(LOGICAL, {
    expectedCurrent: null,               // 首次安装：无现有 current
    targetRevision: seedSealed.revisionId,
    candidateDigest: seedSealed.digest,
    gateRunId: 'install-gate', approvalId: 'install-approved',
  });
  console.log(`✓ 初始版本确立: ${seedPromoted.revisionId}（digest ${seedPromoted.digest.slice(0, 12)}…）`);

  // ---------- 1. 评测（只读域）：对当前线上版本跑 benchmark ----------
  section('1. 评测 EvaluationRun（只读域）— 对当前版本跑 benchmark');
  const current = await registry.resolveCurrent(LOGICAL);
  console.log('resolveCurrent →', current.revisionId, '（老 Session 已挂载该 generation）');
  const baselineEval = {
    id: 'eval-run-0001',
    overall: 0.42,
    correctness: 0.50,
    safety: 1.0,
    verification: 0.33,
    totalCases: 30, passedCases: 13,
    failureClusters: ['prompt-following/basic', 'tool-call/fs-write'],
  };
  console.log('baseline.overall =', baselineEval.overall, '| 通过', baselineEval.passedCases, '/', baselineEval.totalCases);
  console.log('失败簇（进化的输入）:', baselineEval.failureClusters.join(', '));

  // ---------- 2. 进化（只写域）：newRun + 候选 ----------
  section('2. 进化 request_evolution（只写域）：创建候选');
  const run = await controller.newRun({
    source: 'session-42',
    triggerEvaluationRunId: baselineEval.id,
    selectedFailureClusters: baselineEval.failureClusters,
  });
  console.log('newRun →', run.id, '| state =', run.state, '| 关联评测 =', run.triggerEvaluationRunId);
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    mutations: [
      { kind: 'prompt', target: 'persona', ops: [{ op: 'replace', old: '你只需要输出答案', new: '先输出计划，再逐步执行并自我核验' }] },
      { kind: 'tool', target: 'agent.cordis.yml', ops: [{ op: 'add-tool', tool: 'fs.writeFile' }] },
    ],
  });
  console.log('候选 →', candidateId, '| 变异 2 条（persona 重写 + 工具面补充），状态 = DRAFT（staging 可写）');

  // ---------- 3. 封印 ----------
  section('3. 封印 seal：DRAFT → SEALED（不可变 revision）');
  const sealed = await controller.seal(run.id);
  console.log('sealed → revisionId =', sealed.revisionId);
  console.log('       digest     =', sealed.digest.slice(0, 20) + '…');
  const { ok } = await registry.verifyRevisionDigest(sealed.digest);
  console.log('       内容寻址校验 =', ok ? 'OK（不可变，篡改可检测）' : 'FAILED');

  // ---------- 4. 验证 + Code Gate（同 Frozen Epoch） ----------
  section('4. 同一 Frozen Epoch 下验证 + Code Gate（代码判定，无 LLM 自证）');
  await controller.evaluate(run.id, {
    baseline: { overall: baselineEval.overall },
    candidate: {
      overall: 0.80,            // 提升 +0.38 >> minEffect
      correctness: 0.85, safety: 1.0, verification: 1.0,
      perCaseRegression: 0.02,  // ≤ tolerance 0.05
    },
    criticalAssertionsPassed: true, criticalFailures: 0,
    canary: { passed: true },      // 少量 case 先跑
    holdout: { passed: true },     // 盲测集
    digestOk: true, epochSame: true,
  });
  const r = controller.getRun(run.id);
  console.log(`Gate 判定 = ${r.decision}（${r.gateResult.reason}）→ state = ${r.state}`);

  // ---------- 5. 用户确认 + CAS promote ----------
  section('5. 用户确认（approvalId）→ CAS promote');
  try {
    await controller.promote(run.id, { logicalId: LOGICAL }); // 故意不带 approvalId
  } catch (e) {
    console.log('✗ 无 approvalId 的 promote 被拒绝:', e.message);
  }
  await controller.promote(run.id, { logicalId: LOGICAL, approvalId: 'user-approved-2026-08-20' });
  const after = await registry.resolveCurrent(LOGICAL);
  console.log('✓ promoted → current 已切换:');
  console.log('  current   =', after.revisionId, '| digest =', after.digest.slice(0, 16) + '…');
  console.log('  gateRun   =', after.gateRunId, '| approvalId =', after.approvalId);
  console.log('  → 新 Session resolveCurrent 得新版本；老 Session 保持已挂载 generation');

  // ---------- 6. 历史 / 审计 / 回滚 ----------
  section('6. 历史、审计、回滚');
  console.log('history =', JSON.stringify(await registry.history(LOGICAL)));
  const lines = fs.readFileSync(path.join(root, 'audit', 'ledger.jsonl'), 'utf8').trim().split('\n');
  console.log('controller 审计 ledger 事件序列:');
  for (const l of lines) {
    const j = JSON.parse(l);
    console.log(`  [${j.event}]${j.decision ? ` decision=${j.decision}` : ''}${j.revisionId ? ` rev=${j.revisionId}` : ''}`);
  }
  await registry.rollback(LOGICAL, seedSealed.revisionId);
  let rolled = await registry.resolveCurrent(LOGICAL);
  console.log('回滚 → current =', rolled.revisionId, '（O(1) 切指针，历史不删除）');
  await registry.rollback(LOGICAL, sealed.revisionId);
  rolled = await registry.resolveCurrent(LOGICAL);
  console.log('再回滚 → current =', rolled.revisionId);

  // ---------- 7. 反例：不达标的候选 ----------
  section('7. 反例：Gate 拒绝 / 存疑的候选（current 不受影响）');
  const bad = await controller.newRun({ source: 'session-43', triggerEvaluationRunId: 'eval-run-0002' });
  await controller.createCandidate(bad.id, { logicalId: LOGICAL, sourceRevisionId: sealed.revisionId, mutations: [{ kind: 'prompt', ops: [{ op: 'replace', old: 'X', new: 'Y' }] }] });
  await controller.seal(bad.id);
  await controller.evaluate(bad.id, {
    baseline: { overall: 0.80, correctness: 0.85, safety: 1.0, verification: 1.0 },
    candidate: { overall: 0.90, correctness: 0.30, safety: 1.0, verification: 0.9 },
  });
  const b = controller.getRun(bad.id);
  console.log('正确性回归 0.85→0.30 →', b.gateResult.decision, '| state =', b.state, `(${b.gateResult.reason})`);

  const inc = await controller.newRun({ source: 'session-44', triggerEvaluationRunId: 'eval-run-0003' });
  await controller.createCandidate(inc.id, { logicalId: LOGICAL, sourceRevisionId: sealed.revisionId, mutations: [] });
  await controller.seal(inc.id);
  await controller.evaluate(inc.id, {
    baseline: { overall: 0.80, correctness: 0.85, safety: 1.0, verification: 1.0 },
    candidate: { overall: 0.801, correctness: 0.85, safety: 1.0, verification: 1.0 },
    gateOverrides: { minEffect: 0.05 }, // 配置要求提升必须 > 5%
  });
  const ic = controller.getRun(inc.id);
  console.log('提升 0.001 ≤ minEffect 0.05 →', ic.gateResult.decision, '| state =', ic.state, `(${ic.gateResult.reason})`);
  await controller.resample(inc.id);
  console.log('INCONCLUSIVE → resample 后 state =', controller.getRun(inc.id).state, '（可加试重跑）');
  console.log('current 不受失败影响，仍 =', (await registry.resolveCurrent(LOGICAL)).revisionId);

  // ---------- 8. 清理 ----------
  fs.rmSync(root, { recursive: true, force: true });
  line();
  console.log('演示结束，临时目录已清理:', root);
}

main().catch((e) => { console.error('DEMO FAILED:', e); process.exitCode = 1; });
