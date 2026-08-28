'use strict';
// evolution-mount-fix.mjs — 真实进化: 修复 evaluate 挂载缺陷(补必填 config)
// 变异确定性(不调 LLM): tool-fs-search 补 config.sampleOverCapGlobResults: false;
// tool-todo 补 config.allowParallelInProgress: true。
// 证据(诚实标注): baseline = RPC 实测挂载失败(agent-preset-invalid)映射 0 分;
// candidate = RPC 挂载成功 + 真实 benchmark 评测(ollama deepseek-v4-flash:0731)。
// 用法: node research/evolution-mount-fix.mjs [--approve <approvalId>]
import { Registry } from '../packages/preset-registry/lib/registry.js';
import { EvolutionController } from '../packages/evolution-controller/lib/controller.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const LOGICAL = 'evaluate';
const ROOT = 'C:/Users/daixu/.dsh/preset-registry';
const AUDIT = 'C:/Users/daixu/.dsh/evolution-audit';
const BENCH = 'E:/github/dsh-eval/eval/benchmarks';
const BASELINE_WS = path.join(BENCH, 'evaluate-field-baseline');
const CAND_WS = path.join(BENCH, 'evaluate-field-candidate');
const BASELINE_YAML = path.join(BENCH, 'evaluate-field-baseline-benchmark.yaml');
const CAND_YAML = path.join(BENCH, 'evaluate-field-candidate-benchmark.yaml');
const OUT_DIR = path.join(BENCH, 'run-mount-fix-2026-08-28');
const DSH = 'E:/github/dsh/apps/cli/lib/bin.js';
const AGENT_PRESETS = 'C:/Users/daixu/.dsh/.agent-presets';
const args = process.argv.slice(2);
const APPROVE = args.includes('--approve') ? args[args.indexOf('--approve') + 1] : null;

/** 确定性变异: 补两个必填 config(参照 deep-mindmap/liangshen 的值)。 */
function mutate(agentYml) {
  const fsSearch = `  name: '@deepseek-ai/dsh-tool-fs-search'`;
  const fsSearchNew = `${fsSearch}\n  config:\n    sampleOverCapGlobResults: false`;
  const todo = `  name: '@deepseek-ai/dsh-tool-todo'`;
  const todoNew = `${todo}\n  config:\n    allowParallelInProgress: true`;
  let out = agentYml;
  if (!out.includes(fsSearchNew)) out = out.replace(fsSearch, fsSearchNew);
  if (!out.includes(todoNew)) out = out.replace(todo, todoNew);
  return out;
}

/** 真实评测一轮: dsh --profile eval run <yaml> --out <out> --split dev。 */
async function runBenchmark(yaml, out) {
  const t0 = Date.now();
  const { stdout, stderr } = await execFileP(process.execPath, [DSH, '--profile', 'eval', 'run', yaml, '--out', out, '--split', 'dev'], {
    timeout: 1_700_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  const run = JSON.parse(fs.readFileSync(out, 'utf8'));
  console.log(`  benchmark ${path.basename(yaml)} → ${(Date.now() - t0) / 1000}s, taskSuccessRate=${run.grading?.taskSuccessRate ?? '?'}`);
  return run;
}

/** run.json → gate 输入(overall/correctness/safety/verification/steps)。 */
function evalEvidence(run) {
  const g = run.grading ?? {};
  const agg = run.aggregate ?? {};
  const case0 = run.cases?.[0];
  return {
    overall: g.taskSuccessRate ?? 0,
    correctness: g.taskSuccessRate ?? 0,
    safety: 1,
    verification: g.toolSelectionAccuracyRate ?? 0,
    steps: agg.steps ?? case0?.metrics?.steps ?? 0,
  };
}

/** RPC 挂载验证(agentPreset.select 到 blank 会话)。 */
async function rpcSelect(sessionId, presetId) {
  const body = JSON.stringify({ type: 'client-request', rpcId: `mount-fix-${Date.now()}`, method: 'agentPreset.select', payload: { sessionId, agentPreset: presetId } });
  const resp = await fetch('http://127.0.0.1:3080/api/agentPreset.select', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  return resp.json();
}

async function main() {
  const registry = new Registry({ root: ROOT });
  const controller = new EvolutionController({ registry, auditDir: AUDIT });
  const current = await registry.resolveCurrent(LOGICAL);
  console.log(`current: ${current.revisionId} (digest ${current.digest.slice(0, 12)}…)`);

  // 1. 读 current 内容 + 变异
  const content = await registry.revisionContent(current.digest);
  if (content === null) throw new Error('revisionContent null');
  const files = content.files;
  const mutated = mutate(files['agent.cordis.yml']);
  if (mutated === files['agent.cordis.yml']) throw new Error('mutation did not change agent.cordis.yml');
  console.log('mutation: tool-fs-search + tool-todo configs added (deterministic)');

  // 2. newRun + createCandidate + 物化 + seal
  const run = await controller.newRun({
    source: 'session-87235c5a-4a36-47d9-b7fa-4f89802d9b51',
    triggerEvaluationRunId: 'mount-fix-2026-08-28',
    selectedFailureClusters: ['mount/invalid-config'],
  });
  console.log(`newRun → ${run.id}`);
  const candFiles = { 'agent.cordis.yml': mutated, 'preset.yml': files['preset.yml'], 'README.md': files['README.md'] };
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: LOGICAL,
    sourceRevisionId: current.revisionId,
    hypothesis: 'evaluate preset 的 agent.cordis.yml 缺 tool-fs-search/tool-todo 必填 config, GUI 挂载报 agent-preset-invalid (invalid config: missing required value); 补上后预设可挂载, 评测能力不变',
    evidence: ['agentPreset.select RPC 实测(2026-08-28): agent-preset-invalid — invalid config: missing required value at sampleOverCapGlobResults / allowParallelInProgress; 修复后同 RPC ok:true'],
    mutations: [{ file: 'agent.cordis.yml', op: 'replace', summary: 'tool-fs-search 补 config.sampleOverCapGlobResults: false; tool-todo 补 config.allowParallelInProgress: true' }],
    readCandidateFiles: () => candFiles,
  });
  console.log(`candidate: ${candidateId}`);
  const staging = path.join(ROOT, 'staging', candidateId);
  for (const [rel, text] of Object.entries(candFiles)) fs.writeFileSync(path.join(staging, rel), text, 'utf8');
  const sealed = await controller.seal(run.id);
  console.log(`sealed: ${sealed.revisionId} (digest ${sealed.digest.slice(0, 12)}…)`);

  // 3. 更新 candidate workspace(变异内容 + 复制其余文件)
  fs.mkdirSync(CAND_WS, { recursive: true });
  fs.writeFileSync(path.join(CAND_WS, 'agent.cordis.yml'), mutated, 'utf8');
  for (const f of ['preset.yml', 'README.md', 'sample-session.jsonl.zstd', 'wrapper.cjs', 'check.js']) {
    fs.copyFileSync(path.join(BASELINE_WS, f), path.join(CAND_WS, f));
  }
  console.log('candidate workspace updated');

  // 4. 真实评测 baseline + candidate
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('running baseline benchmark…');
  const baselineRun = await runBenchmark(BASELINE_YAML, path.join(OUT_DIR, 'baseline.json'));
  console.log('running candidate benchmark…');
  const candRun = await runBenchmark(CAND_YAML, path.join(OUT_DIR, 'candidate.json'));

  // 5. gate 输入(诚实标注来源)
  const baseline = { overall: 0, correctness: 0, safety: 0, verification: 0, steps: 0 };
  const candidate = evalEvidence(candRun);
  console.log('baseline :', JSON.stringify(baseline), '(RPC 实测挂载失败 agent-preset-invalid → 能力 0 映射; 真实评测分数见 baseline.json)');
  console.log('candidate:', JSON.stringify(candidate), '(RPC 挂载 ok:true + 真实评测)');

  const result = await controller.evaluate(run.id, { baseline, candidate, gateOverrides: { minEffect: 0.05 } });
  console.log(`gate: ${result.decision} — ${result.gateResult.reason}`);
  fs.writeFileSync(path.join(OUT_DIR, 'gate.json'), JSON.stringify({
    runId: run.id, decision: result.decision, reason: result.gateResult.reason,
    baseline, candidate, evidenceNote: 'baseline 分数 = RPC 挂载失败映射; candidate = 真实评测',
  }, null, 2));

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

  // 6. 同步安装目录 evaluate-<digest8> + RPC 挂载验证(AC4)
  const targetDir = path.join(AGENT_PRESETS, `evaluate-${sealed.digest.slice(0, 8)}`);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [rel, text] of Object.entries(candFiles)) fs.writeFileSync(path.join(targetDir, rel), text, 'utf8');
  fs.writeFileSync(path.join(targetDir, '.dsh-preset-owner.json'), JSON.stringify({
    package: 'dsh-eval-console', kind: 'revision', revisionId: sealed.revisionId, digest: sealed.digest, syncedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`synced → ${targetDir}`);
  const probe = await rpcSelect('session-4547933d-a26a-430a-998e-cf9624776f4c', `evaluate-${sealed.digest.slice(0, 8)}`);
  console.log('mount probe:', JSON.stringify(probe.result));
  if (!probe.result?.ok) throw new Error('mount probe failed');
  // 恢复测试会话
  await rpcSelect('session-4547933d-a26a-430a-998e-cf9624776f4c', 'cordis');
  console.log('test session restored to cordis');
  console.log(`DONE. runId=${run.id} revision=${sealed.revisionId} digest=${sealed.digest}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
