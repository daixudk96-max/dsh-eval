'use strict';
// run-evidence.test.js — 评测 run 有效性检测(引擎故障识别)
// 运行: node test/run-evidence.test.js(单进程, 避开沙箱 spawn EPERM)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runEngineFault, traceEndReason } = require('../lib/run-evidence.js');

function writeTrace(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evidence-'));
  const p = path.join(dir, 'session.jsonl');
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  return p;
}

const OK_LINES = [
  JSON.stringify({ type: 'turn/start', data: {} }),
  JSON.stringify({ type: 'turn/end', data: { reason: { kind: 'finished' } } }),
];

const FAULT_LINES = [
  JSON.stringify({ type: 'turn/start', data: {} }),
  JSON.stringify({ type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'Error Code internal_server_error: upstream stream closed before [DONE]', code: 'PI_AI_ERROR' } } } }),
];

function runFor(tracePath, extra = {}) {
  return {
    benchmark: 't', model: 'm', provider: 'p', createdAt: 1, trials: 1,
    cases: [{ caseId: 'c1', trial: 1, status: 'completed', tracePath, metrics: { steps: 1 }, grade: { taskSuccess: false }, ...extra }],
  };
}

test('trace 正常结束 → traceEndReason null', () => {
  const p = writeTrace(OK_LINES);
  assert.equal(traceEndReason(p), null);
});

test('trace 尾部 turn/end error → 返回错误消息(上游流截断场景)', () => {
  const p = writeTrace(FAULT_LINES);
  const r = traceEndReason(p);
  assert.ok(r && r.error.includes('PI_AI_ERROR'), JSON.stringify(r));
});

test('trace 缺失 → traceEndReason null(不抛)', () => {
  assert.equal(traceEndReason(path.join(os.tmpdir(), 'nope-' + Date.now() + '.jsonl')), null);
});

test('runEngineFault: 故障 trace → 返回 case 级故障消息', () => {
  const p = writeTrace(FAULT_LINES);
  const msg = runEngineFault(runFor(p));
  assert.ok(msg && msg.includes('c1') && msg.includes('PI_AI_ERROR'), msg);
});

test('runEngineFault: 正常 trace → null', () => {
  const p = writeTrace(OK_LINES);
  assert.equal(runEngineFault(runFor(p)), null);
});

test('runEngineFault: 正常结束 + 后续行非 turn/end → 仍 null', () => {
  const p = writeTrace([...OK_LINES, JSON.stringify({ type: 'tool/execute', data: {} })]);
  assert.equal(runEngineFault(runFor(p)), null);
});

test('runEngineFault: 多 case 任一故障 → 报告第一个故障', () => {
  const okP = writeTrace(OK_LINES);
  const badP = writeTrace(FAULT_LINES);
  const run = { cases: [
    { caseId: 'ok', status: 'completed', tracePath: okP },
    { caseId: 'bad', status: 'completed', tracePath: badP },
  ] };
  const msg = runEngineFault(run);
  assert.ok(msg && msg.includes('bad') && msg.includes('PI_AI_ERROR'), msg);
});

test('runEngineFault: case.status error 无 trace → 报告启动失败', () => {
  const run = { cases: [{ caseId: 'x', status: 'error', error: 'no session log found; dsh exited with code 1' }] };
  const msg = runEngineFault(run);
  assert.ok(msg && msg.includes('no session log'), msg);
});

test('runEngineFault: 无 case → null', () => {
  assert.equal(runEngineFault({ cases: [] }), null);
});

test('runEngineFault: 空 run → null', () => {
  assert.equal(runEngineFault({}), null);
});
