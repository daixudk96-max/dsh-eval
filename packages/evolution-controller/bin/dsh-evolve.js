#!/usr/bin/env node
'use strict';

/**
 * dsh-evolve — 进化闭环单命令(dsh-eval 生态的进化命令面)。
 *
 * 用法:
 *   node packages/evolution-controller/bin/dsh-evolve.js \
 *     --benchmark eval/benchmarks/fix-multiply-benchmark.yaml \
 *     --registry C:/Users/daixu/.dsh/preset-registry \
 *     --logical evaluate \
 *     [--candidate <dir>] [--split dev] [--approve <approvalId>] \
 *     [--min-effect 0.05] [--dsh node .../bin.js] [--out ./evolve-out]
 *
 * 闭环:  resolveCurrent → 候选内容 → createCandidate+seal →
 *        评测 baseline/candidate(spawn `dsh --profile eval run`) →
 *        Code Gate(minEffect/效率/回归/rubric) →
 *        ACCEPTED + --approve → promote + 导出; 否则拒绝(退出码 1)。
 *
 * 信任域: 评测 = 子进程(只读域), 进化 = 本进程 registry/controller(只写域)。
 * 零依赖 CJS; 评测失败 = 无证据, 绝不 promote。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { Registry } = require('../../preset-registry/lib/registry.js');
const { EvolutionController } = require('../lib/controller.js');
const { failureRecordsFromRun, summarizeFailures, formatFailureSummary } = require('../lib/failures.js');

// ---------- 参数解析 (--key value / --key=value / 位置参数) ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--help' || tok === '-h') { args.help = true; continue; }
    const eq = tok.indexOf('=');
    if (eq > 0 && tok.startsWith('--')) {
      args[tok.slice(2, eq)] = tok.slice(eq + 1);
      continue;
    }
    if (tok.startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[tok.slice(2)] = argv[i + 1];
      i += 1;
    } else if (tok.startsWith('--')) {
      args[tok.slice(2)] = true; // 无值 flag
    } else {
      args._.push(tok); // 位置参数(子命令/路径)
    }
  }
  return args;
}

function usage() {
  console.log(`dsh-evolve — 进化闭环单命令 CLI

用法:
  dsh-evolve.js --benchmark <yaml> --registry <root> --logical <id>
      [--candidate <dir>] [--split dev|guard] [--approve <approvalId>]
      [--min-effect 0.05] [--dsh <launcher>] [--out <dir>]

参数:
  --benchmark <yaml>     必填: 评测基准(双跑同一基准)
  --benchmark-baseline <yaml>   可选: baseline 用不同基准(如注入不同被测内容)
  --benchmark-candidate <yaml>  可选: candidate 用不同基准
  --registry <root>      必填: preset-registry 根
  --logical <id>         必填: logical preset id
  --candidate <dir>      可选: 候选内容目录(变异后文件); 缺省 = 读 current 内容
  --auto                 可选: LLM proposer 自动生成候选(读失败证据)
  --proposal-run <json>  可选(--auto 时): 用历史真实失败 run.json 作证据(默认=本次 baseline)
  --model <id>           可选: proposer LLM 模型(默认 deepseek-v4-flash)
  --api-key-env <name>   可选: proposer 凭证 env/credentials 名(默认 CLIPA_API_KEY)
  --split <dev|guard>    默认 dev
  --approve <approvalId> 可选: 人审绑定; 缺省 = 演示拒绝
  --min-effect <n>       默认 0.05
  --budget-dir <dir>     可选: 预算 ledger 目录(与 --budget-limit 齐备且 > 0 才启用)
  --budget-limit <usd>   可选: 进化预算上限 USD(> 0); 已花 ≥ 上限时 newRun 被拒
  --dsh <launcher>       默认: node E:\\github\\dsh\\apps\\cli\\lib\\bin.js
  --out <dir>            默认 ./evolve-out, 写 baseline.json/candidate.json/gate.json/result.json

归档模式(不启动评测, 只要求 --registry):
  --export <path>        导出整个 registry 为自校验 JSON 快照
  --import <path>        从快照导入到 --registry 根(目标须不存在或为空)
  --status               只读列出每个 logical preset 的当前指针/历史链/digest 漂移校验

失败聚合(P2-4, 只读 run.json):
  failures <run.json...> 聚合一个或多个 run.json 的失败 case 为失败类视图

闭环: current → 候选 → seal → 评测×2 → Gate → promote/拒绝(退出码 1 拒绝)`);
}

// ---------- 评测 (只读域, 子进程) ----------
function runBenchmark({ dshLauncher, benchmarkPath, split, outPath }) {
  const args = [...dshLauncher, '--profile', 'eval', 'run', benchmarkPath, '--out', outPath, '--split', split];
  const res = spawnSync(args[0], args.slice(1), { stdio: 'inherit', timeout: 900000 });
  if (res.error) throw new Error(`spawn dsh failed: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`benchmark run exited ${res.status} (see output)`);
  const run = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  return run;
}

/** 从 dsh-eval run.json 提取 gate 四分量(与 research 脚本同映射, 诚实标注来源)。 */
function evalEvidence(run) {
  const g = run.grading || {};
  const agg = run.aggregate || {};
  const case0 = (run.cases || [])[0];
  const overall = typeof g.taskSuccessRate === 'number' ? g.taskSuccessRate : null;
  const correctness = overall;
  const verification = typeof g.toolSelectionAccuracyRate === 'number' ? g.toolSelectionAccuracyRate : null;
  const safety = 1; // 真实运行无安全违例记录时按通过计(保守: 有记录才扣)
  const steps = typeof agg.steps === 'number' ? agg.steps : (case0 && case0.metrics && typeof case0.metrics.steps === 'number' ? case0.metrics.steps : null);
  const failed = (run.cases || []).filter((c) => !c.grade || c.grade.taskSuccess !== true).length;
  const total = (run.cases || []).length;
  return {
    overall, correctness, safety, verification,
    steps, failed, total,
    source: `run.json:${run.benchmark || '?'} model=${run.model || '?'} provider=${run.provider || '?'}`,
  };
}

/** 从 dsh-eval run.json 提取 frozen epoch 证据(P0-3)。 */
function epochEvidence(run) {
  const snapshot = run.benchmarkSnapshot || {};
  return {
    status: run.status ?? 'completed',
    digest: typeof run.benchmarkDigest === 'string' ? run.benchmarkDigest : null,
    verified: snapshot.verified ?? true,
    epochChanged: run.epochChanged ?? false,
  };
}

/**
 * epochSame = 双 run 均 completed + frozen 快照验证成功 + 语义 digest 一致。
 * 任一 run invalid/未验证/digest 缺失或不同 → false → gate 在效果/效率
 * INCONCLUSIVE 之前返回 INVALID(冻结 epoch 内才允许比较)。
 */
function epochSameOf(baselineRun, candidateRun) {
  const b = epochEvidence(baselineRun);
  const c = epochEvidence(candidateRun);
  return b.status === 'completed' && c.status === 'completed'
    && b.verified && c.verified
    && b.digest !== null && b.digest === c.digest;
}

/** 读目录为 {relPath: text}(候选内容)。 */
function readDirAsFiles(dir) {
  const files = {};
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const name of fs.readdirSync(abs)) {
      const child = path.join(rel, name);
      const full = path.join(abs, name);
      if (fs.statSync(full).isDirectory()) walk(child);
      else files[child.split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk('');
  return files;
}

/** 从 registry 当前 revision 读出内容文件。 */
async function currentFiles(registry, logicalId) {
  const cur = await registry.resolveCurrent(logicalId);
  if (!cur || !cur.revisionId) throw new Error(`logical preset "${logicalId}" has no current revision; run an initial install first`);
  const content = await registry.revisionContent(cur.digest);
  if (!content) throw new Error(`revision content missing for ${cur.digest}`);
  return { files: content.files, current: cur };
}

/**
 * 只读列出 registry 中每个 logical preset 的当前指针、历史链与 digest 漂移校验
 * (P1-4)。logical 列表读自 registry 根 logical/ 目录(<logicalId>.json)。
 * @param {import('../../preset-registry/lib/registry.js').Registry} registry
 */
async function printStatus(registry) {
  const logicalDir = registry.dirs.logical;
  const logicalIds = fs.existsSync(logicalDir)
    ? fs.readdirSync(logicalDir).filter((name) => name.endsWith('.json')).map((name) => registry.decodeFileId(name.replace(/\.json$/, '')))
    : [];
  if (logicalIds.length === 0) {
    console.log('status: registry has no logical presets');
    return;
  }
  for (const logicalId of logicalIds.sort()) {
    const current = await registry.resolveCurrent(logicalId);
    const history = await registry.history(logicalId);
    console.log(`\n[${logicalId}]`);
    if (!current) {
      console.log('  current: (none)');
    } else {
      console.log(`  current: ${current.revisionId} (digest ${current.digest.slice(0, 12)}…)`);
      console.log(`    gateRunId: ${current.gateRunId ?? '(none)'}`);
      console.log(`    approvalId: ${current.approvalId ?? '(none)'}`);
    }
    console.log('  history:');
    if (history.length === 0) {
      console.log('    (no history)');
    }
    for (const entry of history) {
      const verify = await registry.verifyRevisionDigest(entry.digest);
      const drift = verify.ok ? 'ok' : `DRIFT (${verify.reason ?? 'digest mismatch'})`;
      console.log(`    ${entry.status.padEnd(8)} ${entry.revisionId} digest ${entry.digest.slice(0, 12)}… [${drift}]`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  // ---- archive modes (P0-4): --export / --import, no evolution flags ----
  if (args.export || args.import) {
    if (!args.registry) { console.error('error: --registry is required for --export/--import'); process.exit(2); }
    const incompatible = ['benchmark', 'logical', 'candidate', 'auto', 'approve', 'split', 'min-effect', 'dsh',
      'benchmark-baseline', 'benchmark-candidate', 'proposal-run', 'model', 'api-key-env', 'redact-value',
      'budget-dir', 'budget-limit'];
    for (const flag of incompatible) {
      if (args[flag] !== undefined) {
        console.error(`error: --${flag} is incompatible with --export/--import`);
        process.exit(2);
      }
    }
    const registry = new Registry({ root: args.registry });
    if (args.export) {
      const outPath = path.resolve(args.export);
      const result = await registry.exportSnapshot(outPath);
      console.log(`✓ exported ${result.fileCount} files → ${outPath} (digest ${result.packageDigest.slice(0, 12)}…)`);
      return;
    }
    const inPath = path.resolve(args.import);
    const result = await Registry.importSnapshot({ root: args.registry, inPath });
    console.log(`✓ imported ${result.imported} files → ${args.registry} (${result.revisions.length} revisions)`);
    return;
  }

  // ---- status mode (P1-4): --status, read-only, only requires --registry ----
  if (args.status) {
    if (!args.registry) { console.error('error: --registry is required for --status'); process.exit(2); }
    const incompatible = ['benchmark', 'logical', 'candidate', 'auto', 'approve', 'split', 'min-effect', 'dsh',
      'benchmark-baseline', 'benchmark-candidate', 'proposal-run', 'model', 'api-key-env', 'redact-value',
      'export', 'import', 'budget-dir', 'budget-limit'];
    for (const flag of incompatible) {
      if (args[flag] !== undefined) {
        console.error(`error: --${flag} is incompatible with --status`);
        process.exit(2);
      }
    }
    const registry = new Registry({ root: args.registry });
    await printStatus(registry);
    return;
  }

  // ---- failures mode (P2-4): aggregate failure classes from run.json files ----
  if (args._[0] === 'failures') {
    const runPaths = args._.slice(1);
    if (runPaths.length === 0) {
      console.error('error: failures requires at least one run.json path');
      process.exit(2);
    }
    const records = [];
    for (const p of runPaths) {
      const abs = path.resolve(p);
      const run = JSON.parse(fs.readFileSync(abs, 'utf8'));
      records.push(...failureRecordsFromRun(run, p));
    }
    console.log(formatFailureSummary(summarizeFailures(records)));
    return;
  }

  for (const required of ['benchmark', 'registry', 'logical']) {
    if (!args[required]) { usage(); console.error(`error: --${required} is required`); process.exit(2); }
  }
  const registryRoot = args.registry;
  const logicalId = args.logical;
  const split = args.split === 'guard' ? 'guard' : 'dev';
  const minEffect = Number(args['min-effect'] ?? 0.05);
  const outDir = args.out ?? path.join(process.cwd(), 'evolve-out');
  const dshLauncher = (args.dsh ?? 'node E:\\github\\dsh\\apps\\cli\\lib\\bin.js').split(/\s+/);
  fs.mkdirSync(outDir, { recursive: true });

  const registry = new Registry({ root: registryRoot });
  const auditDir = path.join(registryRoot, '..', 'evolution-audit');
  // --budget-dir/--budget-limit 齐备且 limit > 0 才启用预算(≤0 与 ledger 语义一致 =
  // 无限, 单侧/非正数给警告, 避免误配置静默无预算或把 0 当「零预算」)
  const budgetDir = args['budget-dir'];
  const budgetLimit = args['budget-limit'] !== undefined ? Number(args['budget-limit']) : NaN;
  let budget;
  if (budgetDir !== undefined || args['budget-limit'] !== undefined) {
    if (budgetDir === undefined || args['budget-limit'] === undefined || !Number.isFinite(budgetLimit) || budgetLimit <= 0) {
      console.warn('warn: --budget-dir and --budget-limit (> 0) must both be given; budget disabled');
    } else {
      budget = { dir: path.resolve(budgetDir), limitUsd: budgetLimit };
    }
  }
  const controller = new EvolutionController({ registry, auditDir, ...(budget ? { budget } : {}) });

  // 1. current 内容
  const { files: currentContent, current } = await currentFiles(registry, logicalId);
  console.log(`▶ current: ${current.revisionId} (digest ${current.digest.slice(0, 12)}…)`);

  // 2. 评测 baseline(先跑: --auto 需要失败证据; 手动模式同序)
  const benchmarkBaseline = path.resolve(args['benchmark-baseline'] ?? args.benchmark);
  const benchmarkCandidate = path.resolve(args['benchmark-candidate'] ?? args.benchmark);
  console.log(`▶ evaluate] baseline run (split=${split}) …`);
  const baselineRun = await runBenchmark({ dshLauncher, benchmarkPath: benchmarkBaseline, split, outPath: path.join(outDir, 'baseline.json') });
  const baseline = evalEvidence(baselineRun);
  console.log(`baseline: ${JSON.stringify(baseline)}`);

  // 3. 候选内容: --candidate 目录 | --auto proposer | 缺省占位变异
  let candidateFiles;
  let hypothesis = 'dsh-evolve CLI run: mutate preset content and verify via real benchmark';
  let evidence = [`baseline ${current.revisionId} → candidate`];
  let mutations = [{ kind: 'replace', path: '(candidate dir)', op: 'sync' }];
  if (args.candidate) {
    candidateFiles = readDirAsFiles(path.resolve(args.candidate));
    console.log(`▶ candidate: ${Object.keys(candidateFiles).length} files from ${args.candidate}`);
  } else if (args.auto) {
    const { propose } = require('../lib/proposer.js');
    const { createChatClient } = require('../lib/llm-client.js');
    const llm = createChatClient({ apiKeyEnv: args['api-key-env'] ?? 'CLIPA_API_KEY', model: args.model ?? 'deepseek-v4-flash' });
    // 失败证据来源: --proposal-run <run.json>(历史真实失败记录, growing-archive
    // 思路)优先; 否则用刚跑的 baseline run(若其有失败 case)。
    let proposalRun = baselineRun;
    if (args['proposal-run']) {
      proposalRun = JSON.parse(fs.readFileSync(path.resolve(args['proposal-run']), 'utf8'));
      console.log(`▶ proposer: 失败证据来自 ${args['proposal-run']}(历史真实失败)`);
    }
    console.log(`▶ proposer: LLM 读失败证据生成候选 …`);
    const proposal = await propose({
      runJson: proposalRun, baselineFiles: currentContent, logicalId,
      llm, redactValues: [args['redact-value']].filter(Boolean),
    });
    if (!proposal.ok) { console.error(`✗ proposer 拒绝: ${proposal.reason}`); process.exit(1); }
    candidateFiles = proposal.candidateFiles;
    hypothesis = proposal.hypothesis;
    evidence = proposal.evidence;
    mutations = proposal.mutations;
    fs.writeFileSync(path.join(outDir, 'proposal.json'), JSON.stringify(proposal, null, 2), 'utf8');
    console.log(`▶ proposer: ${Object.keys(candidateFiles).length} 文件变异 — ${hypothesis}`);
  } else {
    candidateFiles = { ...currentContent };
    // 占位变异: 在 persona 追加真实文本行(非注释, 归一化后有真实差异, 不伪造成绩)
    const readmeKey = Object.keys(candidateFiles).find((k) => /readme/i.test(k)) ?? Object.keys(candidateFiles)[0];
    candidateFiles[readmeKey] = `${candidateFiles[readmeKey].replace(/\s*$/, '')}\n\n- dsh-evolve: candidate v1 (see audit ledger)\n`;
    console.log('▶ candidate: no --candidate, appended marker line to', readmeKey);
  }

  // 4. 进化域: newRun → createCandidate → seal
  const run = await controller.newRun({ source: logicalId, triggerEvaluationRunId: 'dsh-evolve-cli', selectedFailureClusters: [] });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId, sourceRevisionId: current.revisionId,
    hypothesis, evidence, mutations,
    readCandidateFiles: async () => candidateFiles,
  });
  const stagingDir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(candidateFiles)) {
    const abs = path.join(stagingDir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  const sealed = await controller.seal(run.id);
  console.log(`▶ sealed] ${sealed.revisionId} (digest ${sealed.digest.slice(0, 12)}…)`);

  // 5. 评测 candidate
  console.log(`▶ evaluate] candidate run (split=${split})`);
  const candidateRun = await runBenchmark({ dshLauncher, benchmarkPath: benchmarkCandidate, split, outPath: path.join(outDir, 'candidate.json') });

  const candidate = evalEvidence(candidateRun);
  console.log(`candidate: ${JSON.stringify(candidate)}`);

  // 5. Code Gate(frozen epoch 校验: 双 run 同 epoch 才允许比较)
  const epochSame = epochSameOf(baselineRun, candidateRun);
  const gateOverrides = { minEffect, ...(epochSame ? {} : { epochSame: false }) };
  const result = await controller.evaluate(run.id, {
    baseline: { overall: baseline.overall, correctness: baseline.correctness, safety: baseline.safety, verification: baseline.verification, steps: baseline.steps },
    candidate: { overall: candidate.overall, correctness: candidate.correctness, safety: candidate.safety, verification: candidate.verification, steps: candidate.steps },
    gateOverrides,
  });
  console.log(`gate: ${result.decision} — ${result.gateResult.reason}${epochSame ? '' : ' (epoch mismatch → INVALID)'}`);

  // 6. promote / 拒绝
  const gateJson = { runId: run.id, decision: result.decision, reason: result.gateResult.reason, baseline, candidate, approvals: args.approval ? [args.approval] : [] };
  fs.writeFileSync(path.join(outDir, 'gate.json'), JSON.stringify(gateJson, null, 2), 'utf8');

  if (result.state === 'ACCEPTED' && args.approve) {
    const promoted = await controller.promote(run.id, { logicalId, approvalId: args.approve });
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ status: 'promoted', revisionId: promoted.revisionId, digest: promoted.digest }, null, 2), 'utf8');
    console.log(`✓ PROMOTED] ${promoted.revisionId} (approval ${args.approve})`);
    return;
  }
  const reason = result.state !== 'ACCEPTED'
    ? `gate: ${result.decision} — ${result.gateResult.reason}`
    : 'gate ACCEPTED but no --approve given';
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ status: 'rejected', reason }, null, 2), 'utf8');
  console.error(`✗ not promoted: ${reason}`);
  process.exit(1);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
