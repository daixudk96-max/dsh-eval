'use strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const name = 'system-evolution-tools';
export const inject = ['tools'];

/** Locate the dsh-eval repo root directory. */
function findRepoRoot() {
  if (process.env.DSH_EVAL_REPO && fs.existsSync(process.env.DSH_EVAL_REPO)) {
    return process.env.DSH_EVAL_REPO;
  }
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    let cur = currentDir;
    for (let i = 0; i < 5; i += 1) {
      if (fs.existsSync(path.join(cur, 'packages', 'evolution-controller'))) {
        return cur;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  } catch {
    /* ignore */
  }
  if (fs.existsSync('E:\\github\\dsh-eval')) return 'E:\\github\\dsh-eval';
  return process.cwd();
}

function getProposerModule(repoRoot) {
  const p = path.join(repoRoot, 'packages', 'evolution-controller', 'lib', 'proposer.js');
  return require(p);
}

function getLlmClientModule(repoRoot) {
  const p = path.join(repoRoot, 'packages', 'evolution-controller', 'lib', 'llm-client.js');
  return require(p);
}

function getRegistryModule(repoRoot) {
  const p = path.join(repoRoot, 'packages', 'preset-registry', 'lib', 'registry.js');
  return require(p);
}

function getDshEvolveBin(repoRoot) {
  return path.join(repoRoot, 'packages', 'evolution-controller', 'bin', 'dsh-evolve.js');
}

/** 1. evolution.propose */
export async function executePropose(args, options = {}) {
  try {
    const { evidenceRun, baselineDir, outDir, logicalId, model, apiKeyEnv, apiKey } = args || {};
    if (!evidenceRun) throw new Error('evidenceRun is required');
    if (!baselineDir) throw new Error('baselineDir is required');
    if (!outDir) throw new Error('outDir is required');

    const repoRoot = options.repoRoot || findRepoRoot();
    const { propose } = getProposerModule(repoRoot);
    const { createChatClient } = getLlmClientModule(repoRoot);

    const runJsonPath = path.resolve(evidenceRun);
    if (!fs.existsSync(runJsonPath)) throw new Error(`evidenceRun not found: ${runJsonPath}`);
    const runJson = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));

    const baselineAbs = path.resolve(baselineDir);
    if (!fs.existsSync(baselineAbs)) throw new Error(`baselineDir not found: ${baselineAbs}`);

    const baselineFiles = {};
    function walkDir(rel) {
      const abs = rel === '' ? baselineAbs : path.join(baselineAbs, rel);
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      for (const entry of entries) {
        const childRel = rel === '' ? entry.name : path.join(rel, entry.name);
        if (entry.isDirectory()) {
          walkDir(childRel);
        } else if (entry.isFile()) {
          baselineFiles[childRel.split(path.sep).join('/')] = fs.readFileSync(path.join(abs, entry.name), 'utf8');
        }
      }
    }
    walkDir('');

    const lid = logicalId || path.basename(baselineAbs) || 'evaluate';
    let llm;
    if (options.llm) {
      llm = options.llm;
    } else {
      llm = createChatClient({
        model: model || 'deepseek-v4-flash',
        apiKeyEnv: apiKeyEnv || 'CLIPA_API_KEY',
        ...(apiKey ? { apiKey } : {}),
      });
    }

    const proposal = await propose({
      runJson,
      baselineFiles,
      logicalId: lid,
      llm,
      redactValues: [],
    });

    if (!proposal.ok) {
      return JSON.stringify({ ok: false, error: proposal.reason });
    }

    const outAbs = path.resolve(outDir);
    fs.mkdirSync(outAbs, { recursive: true });
    fs.writeFileSync(path.join(outAbs, 'proposal.json'), JSON.stringify(proposal, null, 2), 'utf8');

    const candidateDir = path.join(outAbs, 'candidate');
    fs.mkdirSync(candidateDir, { recursive: true });
    for (const [name, content] of Object.entries(proposal.candidateFiles || {})) {
      const filePath = path.join(candidateDir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    }

    return JSON.stringify({
      ok: true,
      candidateDir,
      hypothesis: proposal.hypothesis,
      mutations: proposal.mutations,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/** 2. evolution.mutate */
export async function executeMutate(args) {
  try {
    const { dir, file, op = 'replace', from, to } = args || {};
    if (!dir) throw new Error('dir is required');
    if (!file) throw new Error('file is required');
    if (from === undefined) throw new Error('from is required');
    if (to === undefined) throw new Error('to is required');

    const targetPath = path.resolve(dir, file);
    if (!fs.existsSync(targetPath)) throw new Error(`file not found: ${targetPath}`);
    const content = fs.readFileSync(targetPath, 'utf8');

    if (!content.includes(from)) {
      throw new Error(`target substring 'from' not found in ${file}`);
    }

    const newContent = content.replace(from, to);
    fs.writeFileSync(targetPath, newContent, 'utf8');

    return JSON.stringify({ ok: true, file, changed: true });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/** 3. evolution.candidate */
export async function executeCandidate(args, options = {}) {
  try {
    const { root, logicalId, sourceRevisionId, hypothesis, evidence, mutations, files } = args || {};
    if (!root) throw new Error('root is required');
    if (!logicalId) throw new Error('logicalId is required');

    const repoRoot = options.repoRoot || findRepoRoot();
    const { Registry } = getRegistryModule(repoRoot);
    const registry = new Registry({ root: path.resolve(root) });

    let srcRev = sourceRevisionId;
    if (!srcRev) {
      const cur = await registry.resolveCurrent(logicalId);
      srcRev = cur?.revisionId || 'initial';
    }

    const candidateId = await registry.createCandidate(logicalId, {
      sourceRevisionId: srcRev,
      evolutionRunId: 'evolution-tools',
    });

    if (Array.isArray(mutations)) {
      for (const m of mutations) {
        await registry.patchCandidate(candidateId, m);
      }
    } else if (hypothesis) {
      await registry.patchCandidate(candidateId, {
        kind: 'proposal',
        hypothesis,
        evidence: evidence || [],
      });
    }

    if (files && typeof files === 'object') {
      const stagingDir = path.join(registry.dirs.staging, candidateId);
      for (const [relPath, content] of Object.entries(files)) {
        const abs = path.join(stagingDir, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(content), 'utf8');
      }
    }

    return JSON.stringify({ ok: true, candidateId });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/** 4. evolution.run */
export async function executeRun(args, options = {}) {
  try {
    const { benchmark, registryRoot, logicalId, split = 'dev', minEffect = 0.05, out, candidate } = args || {};
    if (!benchmark) throw new Error('benchmark is required');
    if (!registryRoot) throw new Error('registryRoot is required');
    if (!logicalId) throw new Error('logicalId is required');

    const repoRoot = options.repoRoot || findRepoRoot();
    const dshEvolveBin = getDshEvolveBin(repoRoot);

    const outDir = out ? path.resolve(out) : path.join(os.tmpdir(), `dsh-evolve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(outDir, { recursive: true });

    const cmdArgs = [
      dshEvolveBin,
      '--benchmark', path.resolve(benchmark),
      '--registry', path.resolve(registryRoot),
      '--logical', logicalId,
      '--split', split,
      '--min-effect', String(minEffect),
      '--out', outDir,
    ];
    if (candidate) {
      cmdArgs.push('--candidate', path.resolve(candidate));
    }
    // NOTE: --approve intentionally NOT exposed here. Promotion requires a
    // human-bound approvalId supplied out-of-band via the CLI; the tool plane
    // must never let the agent mint its own approval.

    const runExecFile = options.execFile || ((file, argv, opts) => new Promise((resolve) => {
      execFile(file, argv, opts, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr });
      });
    }));

    await runExecFile(process.execPath, cmdArgs, { timeout: 600000 });

    const gatePath = path.join(outDir, 'gate.json');
    if (fs.existsSync(gatePath)) {
      const gateJson = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
      return JSON.stringify({
        ok: true,
        decision: gateJson.decision,
        reason: gateJson.reason,
        baseline: gateJson.baseline,
        candidate: gateJson.candidate,
        gain: gateJson.gain,
        efficiencyGain: gateJson.efficiencyGain,
      });
    }

    const resultPath = path.join(outDir, 'result.json');
    if (fs.existsSync(resultPath)) {
      const resultJson = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      return JSON.stringify({
        ok: true,
        status: resultJson.status,
        reason: resultJson.reason,
        revisionId: resultJson.revisionId,
        digest: resultJson.digest,
      });
    }

    return JSON.stringify({ ok: false, error: 'dsh-evolve finished without gate.json or result.json' });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.tools.register({
    name: 'evolution.propose',
    description: 'Generate an evolution proposal from evaluation failures (RCA -> Proposal)',
    parameters: {
      type: 'object',
      properties: {
        evidenceRun: { type: 'string', description: 'Path to failed run.json' },
        baselineDir: { type: 'string', description: 'Directory containing baseline preset files' },
        outDir: { type: 'string', description: 'Output directory for proposal' },
        logicalId: { type: 'string', description: 'Logical preset ID (optional)' },
        model: { type: 'string', description: 'LLM model (optional)' },
        apiKeyEnv: { type: 'string', description: 'API key env var (optional)' },
      },
      required: ['evidenceRun', 'baselineDir', 'outDir'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executePropose(args, config),
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'evolution.mutate',
    description: 'Apply entry-level mutation to preset files (replace string content)',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory containing the file' },
        file: { type: 'string', description: 'Relative path of the target file' },
        op: { type: 'string', description: "Mutation operation (default: 'replace')" },
        from: { type: 'string', description: 'Exact string to be replaced' },
        to: { type: 'string', description: 'Replacement string' },
      },
      required: ['dir', 'file', 'from', 'to'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executeMutate(args),
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'evolution.candidate',
    description: 'Create or inspect a Candidate in preset registry staging area',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Preset registry root directory' },
        logicalId: { type: 'string', description: 'Logical preset ID' },
        sourceRevisionId: { type: 'string', description: 'Source revision ID (optional)' },
        hypothesis: { type: 'string', description: 'Proposal hypothesis (optional)' },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence lines (optional)' },
        mutations: { type: 'array', description: 'Mutations list (optional)' },
        files: { type: 'object', description: 'File contents map { relPath: content } (optional)' },
      },
      required: ['root', 'logicalId'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executeCandidate(args, config),
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'evolution.run',
    description: 'Submit Candidate for benchmark evaluation and code gate check',
    parameters: {
      type: 'object',
      properties: {
        benchmark: { type: 'string', description: 'Benchmark YAML path' },
        registryRoot: { type: 'string', description: 'Preset registry root' },
        logicalId: { type: 'string', description: 'Logical preset ID' },
        split: { type: 'string', description: "Split name ('dev'|'guard', default: 'dev')" },
        minEffect: { type: 'number', description: 'Minimum effect gain threshold (default: 0.05)' },
        out: { type: 'string', description: 'Output directory for evaluation results' },
        candidate: { type: 'string', description: 'Candidate directory (optional)' },
      },
      required: ['benchmark', 'registryRoot', 'logicalId'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executeRun(args, config),
  }));
}
