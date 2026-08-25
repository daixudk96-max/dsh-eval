'use strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const name = 'system-evaluation-tools';
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

function getDshLauncher(config = {}) {
  if (config.dshLauncher) return config.dshLauncher;
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  return 'node E:\\github\\dsh\\apps\\cli\\lib\\bin.js';
}

function getDshEvolveBin(repoRoot) {
  return path.join(repoRoot, 'packages', 'evolution-controller', 'bin', 'dsh-evolve.js');
}

/** 1. evaluation.run */
export async function executeEvaluationRun(args, options = {}) {
  try {
    const { benchmark, out, split = 'dev' } = args || {};
    if (!benchmark) throw new Error('benchmark is required');

    const outPath = out ? path.resolve(out) : path.join(os.tmpdir(), `eval-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const launcher = getDshLauncher(options);
    const launcherTokens = launcher.split(/\s+/);
    const cmd = launcherTokens[0];
    const cmdArgs = [
      ...launcherTokens.slice(1),
      '--profile', 'eval',
      'run', path.resolve(benchmark),
      '--out', outPath,
      '--split', split,
    ];

    const runExecFile = options.execFile || ((file, argv, opts) => new Promise((resolve) => {
      execFile(file, argv, opts, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr });
      });
    }));

    const { err, stderr } = await runExecFile(cmd, cmdArgs, { timeout: 600000 });
    if (err && !fs.existsSync(outPath)) {
      throw new Error(`benchmark run failed: ${stderr || err.message}`);
    }

    if (!fs.existsSync(outPath)) {
      throw new Error('benchmark run completed but out file was not created');
    }

    const run = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const totalCases = Array.isArray(run.cases) ? run.cases.length : 0;
    const failedCases = (run.cases || []).filter((c) => !c.grade || c.grade.taskSuccess !== true).length;
    const passedCases = totalCases - failedCases;

    return JSON.stringify({
      ok: true,
      status: run.status ?? 'completed',
      taskSuccessRate: run.grading?.taskSuccessRate ?? null,
      toolAccuracy: run.grading?.toolSelectionAccuracyRate ?? null,
      steps: run.aggregate?.steps ?? (run.cases?.[0]?.metrics?.steps ?? null),
      totalCases,
      passedCases,
      failedCases,
      out: outPath,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/** 2. evaluation.status */
export async function executeEvaluationStatus(args) {
  try {
    const { runJson } = args || {};
    if (!runJson) throw new Error('runJson is required');

    const absPath = path.resolve(runJson);
    if (!fs.existsSync(absPath)) throw new Error(`runJson not found: ${absPath}`);

    const run = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const totalCases = Array.isArray(run.cases) ? run.cases.length : 0;
    const failedCases = (run.cases || []).filter((c) => !c.grade || c.grade.taskSuccess !== true).length;
    const passedCases = totalCases - failedCases;

    return JSON.stringify({
      ok: true,
      status: run.status ?? 'unknown',
      taskSuccessRate: run.grading?.taskSuccessRate ?? null,
      steps: run.aggregate?.steps ?? (run.cases?.[0]?.metrics?.steps ?? null),
      totalCases,
      passedCases,
      failedCases,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/** 3. evaluation.report */
export async function executeEvaluationReport(args, options = {}) {
  try {
    const { runJson } = args || {};
    if (!runJson) throw new Error('runJson is required');

    const absPath = path.resolve(runJson);
    if (!fs.existsSync(absPath)) throw new Error(`runJson not found: ${absPath}`);

    const launcher = getDshLauncher(options);
    const launcherTokens = launcher.split(/\s+/);
    const cmd = launcherTokens[0];
    const cmdArgs = [
      ...launcherTokens.slice(1),
      '--profile', 'eval',
      'report', absPath,
    ];

    const runExecFile = options.execFile || ((file, argv, opts) => new Promise((resolve) => {
      execFile(file, argv, opts, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr });
      });
    }));

    const { err, stdout, stderr } = await runExecFile(cmd, cmdArgs, { timeout: 120000 });
    if (err && !stdout) {
      throw new Error(`evaluation report failed: ${stderr || err.message}`);
    }

    return JSON.stringify({
      ok: true,
      report: (stdout || '').trim(),
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/** 4. evaluation.failures */
export async function executeEvaluationFailures(args, options = {}) {
  try {
    const { runJsons } = args || {};
    let paths = [];
    if (Array.isArray(runJsons)) {
      paths = runJsons;
    } else if (typeof runJsons === 'string') {
      paths = runJsons.split(/\s+/).filter(Boolean);
    }
    if (paths.length === 0) throw new Error('runJsons must contain at least one run.json path');

    const repoRoot = options.repoRoot || findRepoRoot();
    const dshEvolveBin = getDshEvolveBin(repoRoot);

    const cmdArgs = [
      dshEvolveBin,
      'failures',
      ...paths.map((p) => path.resolve(p)),
    ];

    const runExecFile = options.execFile || ((file, argv, opts) => new Promise((resolve) => {
      execFile(file, argv, opts, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr });
      });
    }));

    const { err, stdout, stderr } = await runExecFile(process.execPath, cmdArgs, { timeout: 120000 });
    if (err && !stdout) {
      throw new Error(`evaluation failures failed: ${stderr || err.message}`);
    }

    return JSON.stringify({
      ok: true,
      summary: (stdout || '').trim(),
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.tools.register({
    name: 'evaluation.run',
    description: 'Trigger a benchmark evaluation run and return a summary report',
    parameters: {
      type: 'object',
      properties: {
        benchmark: { type: 'string', description: 'Path to benchmark YAML' },
        out: { type: 'string', description: 'Destination path for run.json (optional)' },
        split: { type: 'string', description: "Split name ('dev'|'guard', default: 'dev')" },
      },
      required: ['benchmark'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executeEvaluationRun(args, config),
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'evaluation.status',
    description: 'Read and inspect status and summary metrics from an evaluation run.json',
    parameters: {
      type: 'object',
      properties: {
        runJson: { type: 'string', description: 'Path to run.json file' },
      },
      required: ['runJson'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executeEvaluationStatus(args),
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'evaluation.report',
    description: 'Generate markdown evaluation report for a completed run.json',
    parameters: {
      type: 'object',
      properties: {
        runJson: { type: 'string', description: 'Path to run.json file' },
      },
      required: ['runJson'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executeEvaluationReport(args, config),
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'evaluation.failures',
    description: 'Aggregate and categorize failed cases across one or more run.json files',
    parameters: {
      type: 'object',
      properties: {
        runJsons: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of run.json paths',
        },
      },
      required: ['runJsons'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: (args) => executeEvaluationFailures(args, config),
  }));
}
