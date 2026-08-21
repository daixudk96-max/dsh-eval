import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { importClaudeLog, importCodexLog, importDshLog, importTraceFile } from '../src/import.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-import-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const CODEX_LOG = [
  '{"timestamp":"2026-08-14T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the bug"}]}}',
  '{"timestamp":"2026-08-14T00:00:01Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Let me look"}]}}',
  '{"timestamp":"2026-08-14T00:00:02Z","type":"response_item","payload":{"type":"function_call","call_id":"call_1","name":"bash","arguments":"{\\"command\\":\\"pwd\\"}"}}',
  '{"timestamp":"2026-08-14T00:00:03Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"/repo"}}',
  '{"timestamp":"2026-08-14T00:00:04Z","type":"response_item","payload":{"type":"message","role":"assistant","content":{"type":"output_text","text":"Fixed"}}}',
  '{"timestamp":"2026-08-14T00:00:05Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Thanks"}]}}',
  '{"timestamp":"2026-08-14T00:00:06Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Welcome"}]}}',
  '{"type":"event_msg","payload":{"level":"info","message":"skip me"}}',
  'this line is not json',
  '',
].join('\n')

const CLAUDE_LOG = [
  '{"type":"user","message":{"role":"user","content":"Fix the bug"}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Checking"},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"pwd"}}]}}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"/repo","is_error":false}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Fixed"}]}}',
  '{"type":"user","message":{"role":"user","content":"Thanks"}}',
  '{"type":"summary","summary":"ignored"}',
  'this line is not json',
  '',
].join('\n')

const CODEX_EDGE_LOG = [
  '42',
  '"bare string"',
  '{"timestamp":"2026-08-14T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":"x"}}',
  '{"timestamp":"2026-08-14T00:00:01Z","type":"response_item","payload":{"type":"message","role":"assistant","content":["plain string",{"type":"output_text"},{"type":"output_text","text":"hi"}]}}',
  '{"timestamp":"2026-08-14T00:00:02Z","type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"think"}]}}',
  '{"timestamp":"2026-08-14T00:00:03Z","type":"response_item","payload":{"type":"function_call"}}',
  '{"timestamp":"2026-08-14T00:00:04Z","type":"response_item","payload":{"type":"function_call_output","content":"out"}}',
  '',
].join('\n')

const CLAUDE_EDGE_LOG = [
  '42',
  '{"type":"user","message":{"role":"user","content":"hi"}}',
  '{"type":"assistant","message":{"role":"assistant","content":"plain string"}}',
  '{"type":"assistant","message":{"role":"assistant","content":{"type":"text","text":"obj"}}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},"raw string",{"type":"tool_use"},{"type":"text"}]}}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}',
  '',
].join('\n')

// A minimal native DSH session log in the persisted JSONL vocabulary: a
// session header, one turn with a user message, a request header carrying the
// configured model, one tool call/result pair, and turn closers. Seqs must be
// contiguous from zero, exactly as the persistence backend writes them.
const DSH_LOG = [
  '{"type":"session","version":0,"id":"dsh-import-test","createdAt":1700000000000}',
  '{"type":"turn/start","seq":0,"time":1700000000001,"data":{"turn":1}}',
  '{"type":"user/message","seq":1,"time":1700000000002,"data":{"id":"u1","role":"user","content":[{"type":"text","text":"Fix the bug"}],"source":{"kind":"user"}}}',
  '{"type":"step/start","seq":2,"time":1700000000003,"data":{"turn":1,"step":0}}',
  '{"type":"request/header","seq":3,"time":1700000000004,"data":{"config":{"provider":"clipa","model":"deepseek-v4-flash"}}}',
  '{"type":"assistant/message","seq":4,"time":1700000000005,"data":{"turn":1,"step":0,"message":{"id":"a1","role":"assistant","content":[{"type":"text","text":"Let me look"}],"source":{"kind":"model"}}}}',
  '{"type":"tool/call","seq":5,"time":1700000000006,"data":{"turn":1,"step":0,"callId":"c1","name":"read","arguments":"{\\"path\\":\\"a.js\\"}"}}',
  '{"type":"tool/result","seq":6,"time":1700000000007,"data":{"turn":1,"step":0,"message":{"id":"t1","role":"user","content":[{"type":"tool-result","text":"contents","isError":false}],"source":{"kind":"tool","callId":"c1"}}}}',
  '{"type":"step/end","seq":7,"time":1700000000008,"data":{"turn":1,"step":0}}',
  '{"type":"turn/end","seq":8,"time":1700000000009,"data":{"turn":1,"reason":{"kind":"completed"}}}',
  '',
].join('\n')

describe('dsh-eval cross-harness import', () => {
  it('imports a Codex session log with turns, tools, and latency', () => {
    const trace = importCodexLog(CODEX_LOG, 'session.jsonl')
    const metrics = trace.events.reduce(
      (acc, event) => {
        if (event.type === 'tool/call') acc.calls += 1
        if (event.type === 'tool/result') acc.results += 1
        return acc
      },
      { calls: 0, results: 0 },
    )
    expect(String(trace.sessionId)).toBe('session.jsonl')
    expect(trace.events.filter(event => event.type === 'step/end')).toHaveLength(2)
    expect(trace.events.filter(event => event.type === 'user/message')).toHaveLength(2)
    expect(metrics.calls).toBe(1)
    expect(metrics.results).toBe(1)
  })

  it('imports a Claude Code session log with tool_use/tool_result pairing', () => {
    const trace = importClaudeLog(CLAUDE_LOG, 'claude.jsonl')
    const calls = trace.events.filter(event => event.type === 'tool/call')
    const results = trace.events.filter(event => event.type === 'tool/result')
    expect(String(trace.sessionId)).toBe('claude.jsonl')
    expect(calls).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(calls[0]?.data.name).toBe('Bash')
    expect(trace.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
  })

  it('builds a one-trial run with folded metrics from a file', async () => {
    const dir = tempDir()
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, CODEX_LOG)
    const run = await importTraceFile('codex', path, 'case-imported')
    expect(run.benchmark).toBe('import:codex')
    expect(run.cases).toHaveLength(1)
    expect(run.cases[0]?.status).toBe('completed')
    expect(run.cases[0]?.metrics?.toolSuccessRate).toBe(1)
    expect(run.aggregate?.steps).toBe(2)
    expect(run.aggregate?.latencyMs).toBeGreaterThan(0)
  })

  it('handles malformed and partial Codex records', () => {
    const trace = importCodexLog(CODEX_EDGE_LOG, 'session.jsonl')
    expect(trace.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(trace.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    const calls = trace.events.filter(event => event.type === 'tool/call')
    const results = trace.events.filter(event => event.type === 'tool/result')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.data.name).toBe('tool')
    expect(results).toHaveLength(1)
    expect(String(results[0]?.data.message.source.callId)).toBe('codex-call-2')
  })

  it('handles malformed and partial Claude records', () => {
    const trace = importClaudeLog(CLAUDE_EDGE_LOG, 'claude.jsonl')
    expect(trace.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(trace.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(trace.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
  })

  it('falls back to a stable synthetic session id', () => {
    const trace = importCodexLog('{"type":"response_item","payload":{"type":"message","role":"user","content":"x"}}', '---')
    expect(String(trace.sessionId)).toBe('imported')
  })

  it('imports a Claude Code log through the file importer', async () => {
    const dir = tempDir()
    const path = join(dir, 'claude.jsonl')
    writeFileSync(path, CLAUDE_LOG)
    const run = await importTraceFile('claude-code', path, 'case-claude')
    expect(run.benchmark).toBe('import:claude-code')
    expect(run.cases[0]?.metrics?.toolSuccessRate).toBe(1)
  })

  it('imports a native DSH plain session log with real events', () => {
    const trace = importDshLog(DSH_LOG)
    expect(String(trace.sessionId)).toBe('dsh-import-test')
    expect(trace.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(trace.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(trace.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(trace.events.filter(event => event.type === 'step/end')).toHaveLength(1)
  })

  it('imports a native DSH .zstd container with detected model and metrics', async () => {
    const dir = tempDir()
    const path = join(dir, 'session.jsonl.zstd')
    writeFileSync(path, zstdCompressSync(DSH_LOG))
    const run = await importTraceFile('dsh', path, 'case-dsh')
    expect(run.benchmark).toBe('import:dsh')
    expect(run.model).toBe('deepseek-v4-flash')
    expect(run.cases).toHaveLength(1)
    expect(run.cases[0]?.status).toBe('completed')
    expect(run.cases[0]?.metrics?.toolSuccessRate).toBe(1)
    expect(run.cases[0]?.metrics?.steps).toBe(1)
  })

  it('detects the model nested under a request envelope header', async () => {
    const dir = tempDir()
    const path = join(dir, 'session-enveloped.jsonl')
    writeFileSync(path, DSH_LOG.replace(
      '{"type":"request/header","seq":3,"time":1700000000004,"data":{"config":{"provider":"clipa","model":"deepseek-v4-flash"}}}',
      '{"type":"request/header","seq":3,"time":1700000000004,"data":{"header":{"config":{"provider":"opencode","model":"deepseek-v4-flash"}}}}',
    ))
    const run = await importTraceFile('dsh', path, 'case-env')
    expect(run.model).toBe('deepseek-v4-flash')
  })

  it('rejects a corrupt .zstd container', async () => {
    const dir = tempDir()
    const path = join(dir, 'bad.jsonl.zstd')
    writeFileSync(path, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xff, 0xff, 0xff]))
    await expect(importTraceFile('dsh', path, 'case-bad')).rejects.toThrow(/Zstandard|reserved|corrupt/)
  })

  it('expands packed chunk rows in a native DSH log', () => {
    const chunkRow = '{"type":"tool-call-chunks","seq0":9,"time0":1700000000010,"data":{"turn":1,"step":1,"index":0,"id":"c2","name":"bash","args":["{\\"command\\":\\"pwd\\"}"],"dt":[]}}'
    const trace = importDshLog(DSH_LOG + chunkRow + '\n')
    const chunks = trace.events.filter(event => event.type === 'assistant/chunk')
    expect(chunks).toHaveLength(1)
    expect(String((chunks[0]?.data as { chunk?: { type?: unknown } }).chunk?.type)).toBe('tool-call-delta')
  })
})
