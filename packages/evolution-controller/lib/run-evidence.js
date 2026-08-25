'use strict';

/**
 * run-evidence.js — 评测 run 有效性检测(引擎故障识别)。
 * 实战暴露(R5): 上游流截断/订阅失效的 run 只有 1-2 步、0 分, 但效率判定
 * 会把 1 步 vs 2 步当成提升 → 虚假 PASS。故障 run 的数字不可比, gate 必须
 * 收到 evidenceOk=false → INVALID。
 * 判定依据(纯文件证据, 无 LLM): ① case.status==='error' 无 trace(启动失败)
 * ② trace 尾部 turn/end reason.kind==='error'(上游错误/订阅失效/流截断)。
 */
const fs = require('node:fs');

const TRACE_TAIL_BYTES = 64 * 1024;

/** 读 trace 尾部找最后的 turn/end; 返回 {kind, message} | null(文件缺失/解析失败 → null)。 */
function traceEndReason(tracePath) {
  try {
    const size = fs.statSync(tracePath).size;
    const fd = fs.openSync(tracePath, 'r');
    const start = Math.max(0, size - TRACE_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (o.type !== 'turn/end' || !o.data || !o.data.reason) continue;
      const r = o.data.reason;
      if (r.kind === 'error') {
        const e = r.error || {};
        const msg = e.message || e.code || 'unknown';
        const full = e.code ? `${msg} (${e.code})` : msg;
        return { error: full.slice(0, 200) };
      }
      return null; // 最后一个 turn/end 正常结束
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * run 有效性: 任一 case 无 trace 报错, 或 trace 尾部引擎错误 → 返回故障消息;
 * 全部正常 → null。
 * @param {object} run dsh-eval run.json
 * @returns {string|null}
 */
function runEngineFault(run) {
  for (const c of (run.cases || [])) {
    if (c.status === 'error') return c.error ? `case ${c.caseId} error: ${c.error}` : `case ${c.caseId} error`;
    const tp = c.tracePath || (c.tracePaths && c.tracePaths[0]);
    if (tp) {
      const reason = traceEndReason(tp);
      if (reason) return `case ${c.caseId} trace fault: ${reason.error}`;
    }
  }
  return null;
}

module.exports = { runEngineFault, traceEndReason };
