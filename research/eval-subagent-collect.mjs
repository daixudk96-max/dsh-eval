'use strict';
// eval-subagent-collect.mjs — 收集 subagent 评测产物并统计证据
// 用法: node research/eval-subagent-collect.mjs --dir <workspace> [--agent <subagentId>]
// 输出 JSON: { steps, toolCalls, taskSuccess, reportOk, verdict, evidence }
// 步骤数来源(诚实标注): subagent 自报工具调用数(若提供 --agent 且能定位会话日志,
// 则用会话日志 tool/execute 事件数交叉核验)。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const dir = args[args.indexOf('--dir') + 1] || (() => { console.error('--dir required'); process.exit(2); })();
const agentId = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : null;

if (!fs.existsSync(path.join(dir, 'REPORT.md'))) {
  console.log(JSON.stringify({ verdict: 'no-report', reason: 'REPORT.md missing' }, null, 2));
  process.exit(0);
}

// 1) check.js 判定(与 benchmark 一致)
const check = spawnSync('node', ['check.js'], { cwd: dir, encoding: 'utf8' });
const checkPass = check.stdout.includes('CHECK_PASS');
const checkReason = check.stdout.includes('CHECK_FAIL') ? check.stdout.trim() : '';

// 2) 指标: 从 eval-report.json(import 产物)读被评测会话指标
let reportMetrics = null;
for (const f of ['eval-report.json', 'report.json', 'run.json']) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) {
    try { reportMetrics = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch { /* ignore */ }
  }
}
const agg = reportMetrics?.aggregate || {};
const metrics = reportMetrics?.cases?.[0]?.metrics || {};

// 3) 步骤数: 自报文件(子代理会写 steps-report.json 到工作区)
let steps = null, toolCalls = null;
try {
  const sp = path.join(dir, 'steps-report.json');
  if (fs.existsSync(sp)) {
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    steps = typeof s.steps === 'number' ? s.steps : null;
    toolCalls = typeof s.toolCalls === 'number' ? s.toolCalls : null;
  }
} catch { /* ignore */ }

// 4) 会话日志交叉验证(agentId 提供时)
let traceSteps = null, traceToolCalls = null;
if (agentId) {
  try {
    const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || 'C:\\Users\\daixu', '.dsh');
    const sessionsRoot = path.join(home, 'sessions');
    // 递归找含 agentId 的 session.jsonl 或 .zstd
    const find = (dir, depth) => {
      if (depth > 4) return null;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { const r = find(path.join(dir, e.name), depth + 1); if (r) return r; }
        else if (e.name === 'session.jsonl' || e.name.endsWith('.jsonl')) {
          const p = path.join(dir, e.name);
          try {
            const head = fs.readFileSync(p, 'utf8').slice(0, 65536);
            if (head.includes(agentId)) return p;
          } catch { /* ignore */ }
        }
      }
      return null;
    };
    const p = find(sessionsRoot, 0);
    if (p) {
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      traceToolCalls = lines.filter((l) => { try { return JSON.parse(l).type === 'tool/execute'; } catch { return false; } }).length;
      traceSteps = lines.filter((l) => { try { const o = JSON.parse(l); return o.type === 'step/end'; } catch { return false; } }).length;
    }
  } catch { /* ignore */ }
}

console.log(JSON.stringify({
  verdict: checkPass ? 'taskSuccess' : 'taskFailed',
  checkReason,
  checkPass,
  steps, toolCalls,
  traceSteps, traceToolCalls,
  sessionMetrics: {
    steps: agg.steps ?? metrics.steps ?? null,
    toolCalls: agg.toolCalls ?? metrics.toolCalls ?? null,
    toolSuccess: agg.toolSuccessRate ?? metrics.toolSuccessRate ?? null,
    totalTokens: agg.totalTokens ?? metrics.totalTokens ?? null,
  },
  reportFiles: fs.readdirSync(dir).filter((f) => /REPORT|report|run\.json|steps-report/i.test(f)),
}, null, 2));
