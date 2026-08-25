import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildJudgePrompt,
  createHttpJudgeChat,
  judgeTrial,
  llmJudgeChat,
  parseJudgeVerdict,
  resolveJudgeApiKey,
  summarizeTrace,
} from '../src/judge.ts'
import { parseSessionLog } from '../src/trace.ts'
import type { BenchmarkCase, BenchmarkJudge, EvalTrace } from '../src/types.ts'

const TRACE_TEXT = [
  '{"type":"session","version":0,"id":"s","createdAt":1,"delegationDepth":0}',
  '{"seq":0,"type":"user/message","time":1,"data":{"id":"u","role":"user","content":[{"type":"text","text":"task"}]}}',
  '{"seq":1,"type":"assistant/message","time":2,"data":{"turn":0,"step":0,"message":{"id":"a","role":"assistant","content":[{"type":"text","text":"final answer here"}],"source":{"kind":"model"}}}}',
  '{"seq":2,"type":"tool/call","time":3,"data":{"turn":0,"step":0,"callId":"c1","name":"bash","arguments":"{}"}}',
  '{"seq":3,"type":"tool/result","time":4,"data":{"turn":0,"step":0,"message":{"id":"r","role":"user","content":[{"type":"tool-result","text":"x","isError":false}],"source":{"kind":"tool","callId":"c1"}}}}',
  '',
].join('\n')

function trace(): EvalTrace {
  return parseSessionLog(TRACE_TEXT)
}

function emptyTrace(): EvalTrace {
  return parseSessionLog([
    '{"type":"session","version":0,"id":"s","createdAt":1,"delegationDepth":0}',
    '{"seq":0,"type":"user/message","time":1,"data":{"id":"u","role":"user","content":[{"type":"text","text":"task"}]}}',
    '{"seq":1,"type":"turn/end","time":2,"data":{"turn":0,"reason":{"kind":"completed"}}}',
    '',
  ].join('\n'))
}

function failureTrace(): EvalTrace {
  return parseSessionLog([
    '{"type":"session","version":0,"id":"s","createdAt":1,"delegationDepth":0}',
    '{"seq":0,"type":"tool/call","time":1,"data":{"turn":0,"step":0,"callId":"c1","name":"web_search","arguments":"{}"}}',
    '{"seq":1,"type":"tool/result","time":2,"data":{"turn":0,"step":0,"message":{"id":"r","role":"user","content":[{"type":"tool-result","text":"x","isError":true}],"source":{"kind":"tool","callId":"c1"}},"error":{"code":"INTERNAL"}}}',
    '{"seq":2,"type":"llm/retry","time":3,"data":{"retryId":"r1","turn":0,"step":0,"retry":1,"provider":"deepseek","failure":{"code":"RATE_LIMITED"}}}',
    '',
  ].join('\n'))
}

function duplicateToolsTrace(): EvalTrace {
  return parseSessionLog([
    '{"type":"session","version":0,"id":"s","createdAt":1,"delegationDepth":0}',
    '{"seq":0,"type":"tool/call","time":1,"data":{"turn":0,"step":0,"callId":"c1","name":"bash","arguments":"{}"}}',
    '{"seq":1,"type":"tool/call","time":2,"data":{"turn":0,"step":0,"callId":"c2","name":"bash","arguments":"{}"}}',
    '',
  ].join('\n'))
}

function caseValue(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  return { id: 'case-1', prompt: 'Solve the task.', ...overrides }
}

function judge(overrides: Partial<BenchmarkJudge> = {}): BenchmarkJudge {
  return { provider: 'deepseek', model: 'judge-m', maxScore: 10, ...overrides }
}

describe('dsh-eval judge', () => {
  it('summarizes the trace for the judge', () => {
    const summary = summarizeTrace(trace())
    expect(summary).toContain('final answer: final answer here')
    expect(summary).toContain('tools called: bash')
    expect(summary).toContain('invalid tool calls: 0')
  })

  it('summarizes a trace without an answer or tools', () => {
    const summary = summarizeTrace(emptyTrace())
    expect(summary).toContain('final answer: (none)')
    expect(summary).toContain('tools called: (none)')
  })

  it('counts invalid tool calls and retries', () => {
    const summary = summarizeTrace(failureTrace())
    expect(summary).toContain('invalid tool calls: 1')
    expect(summary).toContain('llm retries: 1')
  })

  it('deduplicates tool names and skips non-text answer blocks', () => {
    const deduped = summarizeTrace(duplicateToolsTrace())
    expect(deduped).toContain('tools called: bash')
    const withReasoning = parseSessionLog([
      '{"type":"session","version":0,"id":"s","createdAt":1,"delegationDepth":0}',
      '{"seq":0,"type":"assistant/message","time":2,"data":{"turn":0,"step":0,"message":{"id":"a","role":"assistant","content":[{"type":"reasoning","text":"think"},{"type":"text","text":"answer"}],"source":{"kind":"model"}}}}',
      '',
    ].join('\n'))
    expect(summarizeTrace(withReasoning)).toContain('final answer: answer')
  })

  it('builds a prompt with the rubric, task, and trace', () => {
    const built = buildJudgePrompt(caseValue(), trace(), judge({ rubric: 'Prefer concise answers.' }))
    expect(built.system).toContain('Prefer concise answers.')
    expect(built.system).toContain('0..10')
    expect(built.prompt).toContain('Task id: case-1')
    expect(built.prompt).toContain('Solve the task.')
    expect(built.prompt).toContain('final answer here')
  })

  it.each([
    { name: 'clean JSON', text: '{"finalAnswerScore": 7, "hallucination": false, "rationale": "solid"}', score: 7, hallucination: false },
    { name: 'fenced JSON', text: '```json\n{"finalAnswerScore": 9, "hallucination": true, "rationale": "no source"}\n```', score: 9, hallucination: true },
  ])('parses a $name verdict', ({ text, score, hallucination }) => {
    expect(parseJudgeVerdict(text, 10)).toEqual({
      finalAnswerScore: score,
      hallucination,
      rationale: hallucination ? 'no source' : 'solid',
    })
  })

  it('turns unusable judge output into null fields', () => {
    expect(parseJudgeVerdict('not json at all', 10)).toEqual({ finalAnswerScore: null, hallucination: null })
    expect(parseJudgeVerdict('"just a string"', 10)).toEqual({ finalAnswerScore: null, hallucination: null })
    expect(parseJudgeVerdict('[1, 2]', 10)).toEqual({ finalAnswerScore: null, hallucination: null })
    expect(parseJudgeVerdict('{"finalAnswerScore": 15, "hallucination": false}', 10))
      .toEqual({ finalAnswerScore: null, hallucination: false })
    expect(parseJudgeVerdict('{"finalAnswerScore": 5, "hallucination": "maybe"}', 10))
      .toEqual({ finalAnswerScore: 5, hallucination: null })
  })

  it('judges through the injected chat seam', async () => {
    const requests: Array<{ provider: string; model: string; system: string; prompt: string }> = []
    const chat = async (request: { provider: string; model: string; system: string; prompt: string }) => {
      requests.push(request)
      return JSON.stringify({ finalAnswerScore: 6, hallucination: false, rationale: 'ok' })
    }
    const verdict = await judgeTrial(caseValue(), trace(), judge(), chat)
    expect(verdict).toEqual({ finalAnswerScore: 6, hallucination: false, rationale: 'ok' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ provider: 'deepseek', model: 'judge-m' })
  })

  it('assembles a reply from the llm stream seam', async () => {
    async function* chunks(): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: '{"finalAnswerScore":' }
      yield { type: 'text-delta', index: 0, text: ' 7, "hallucination": false}' }
    }
    const stream = (_options: GenerateOptions): AsyncIterable<StreamChunk> => chunks()
    const reply = await llmJudgeChat(stream)({
      provider: 'deepseek',
      model: 'judge-m',
      system: 'judge',
      prompt: 'task',
    })
    expect(parseJudgeVerdict(reply, 10)).toEqual({ finalAnswerScore: 7, hallucination: false })
  })

  it('ignores non-text blocks when assembling the reply', async () => {
    async function* mixed(): AsyncIterable<StreamChunk> {
      yield { type: 'reasoning-delta', index: 0, text: 'thinking' }
      yield { type: 'text-delta', index: 1, text: '{"finalAnswerScore": 5, "hallucination": false}' }
    }
    const stream = (_options: GenerateOptions): AsyncIterable<StreamChunk> => mixed()
    const reply = await llmJudgeChat(stream)({
      provider: 'deepseek',
      model: 'judge-m',
      system: 'judge',
      prompt: 'task',
    })
    expect(parseJudgeVerdict(reply, 10)).toEqual({ finalAnswerScore: 5, hallucination: false })
  })

  it('calls the OpenAI-compatible endpoint through the http seam', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"finalAnswerScore": 8, "hallucination": false}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const chat = createHttpJudgeChat(
      { baseUrl: 'http://127.0.0.1:8317/v1/', apiKey: 'k', model: 'judge-m' },
      fakeFetch as typeof fetch,
    )
    const reply = await chat({ provider: 'clipa', model: 'judge-m', system: 'judge', prompt: 'task' })
    expect(parseJudgeVerdict(reply, 10)).toEqual({ finalAnswerScore: 8, hallucination: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://127.0.0.1:8317/v1/chat/completions')
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      model: string
      temperature: number
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe('judge-m')
    expect(body.temperature).toBe(0)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'judge' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'task' })
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k')
  })

  it('fails loudly on a non-2xx judge http response', async () => {
    const fakeFetch = async () => new Response('rate limited', { status: 429 })
    const chat = createHttpJudgeChat(
      { baseUrl: 'http://x/v1', apiKey: '', model: 'm' },
      fakeFetch as typeof fetch,
    )
    await expect(chat({ provider: 'p', model: 'm', system: 's', prompt: 't' })).rejects.toThrow('judge http 429')
  })

  it('fails loudly when the completion carries no text content', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })
    const chat = createHttpJudgeChat(
      { baseUrl: 'http://x/v1', apiKey: '', model: 'm' },
      fakeFetch as typeof fetch,
    )
    await expect(chat({ provider: 'p', model: 'm', system: 's', prompt: 't' })).rejects.toThrow('no text content')
  })

  it('resolves the judge api key from the environment first', () => {
    const home = mkdtempSync(join(tmpdir(), 'judge-key-'))
    process.env.DSH_EVAL_TEST_KEY = 'from-env'
    try {
      expect(resolveJudgeApiKey('DSH_EVAL_TEST_KEY', home)).toBe('from-env')
    } finally {
      delete process.env.DSH_EVAL_TEST_KEY
    }
  })

  it('falls back to the credentials file', () => {
    const home = mkdtempSync(join(tmpdir(), 'judge-key-'))
    mkdirSync(join(home, '.dsh'), { recursive: true })
    writeFileSync(join(home, '.dsh', '.credentials.yaml'), 'CLIPA_API_KEY: dai123456\nOTHER: x\n')
    expect(resolveJudgeApiKey('CLIPA_API_KEY', home)).toBe('dai123456')
  })

  it('returns undefined when no source yields the key', () => {
    const home = mkdtempSync(join(tmpdir(), 'judge-key-'))
    expect(resolveJudgeApiKey('DSH_EVAL_MISSING_KEY', home)).toBeUndefined()
  })

  it('builds a criteria-based prompt with pass/fail and no numeric scoring', () => {
    const built = buildJudgePrompt(caseValue(), trace(), judge({
      criteria: [
        { label: '结论点名失败风险', weight: 3 },
        { label: '指标表完整', weight: 3 },
      ],
    }))
    expect(built.system).toContain('- 结论点名失败风险')
    expect(built.system).toContain('- 指标表完整')
    expect(built.system).toContain('PASS (true) or FAIL (false)')
    expect(built.system).not.toContain("Score the agent's final answer from 0 to")
    expect(built.system).not.toContain('finalAnswerScore')
    expect(built.system).toContain('"criteria": [{"label": "<exact criterion label>", "pass": <true|false>, "why": "<one short sentence>"}]')
  })

  it('builds the legacy numeric prompt when no criteria are configured', () => {
    const built = buildJudgePrompt(caseValue(), trace(), judge())
    expect(built.system).toContain('Score the agent\'s final answer from 0 to 10')
    expect(built.system).toContain('"finalAnswerScore"')
  })

  it('scores a criteria verdict by configured weights, not model numbers', () => {
    const text = JSON.stringify({
      hallucination: false,
      criteria: [
        { label: '结论点名失败风险', pass: true, why: 'named the timeout' },
        { label: '指标表完整', pass: false, why: 'missing latency row' },
        { label: '中文总结通顺', pass: true, why: 'clear' },
        { label: '无幻觉', pass: false, why: 'invented a token figure' },
      ],
      rationale: 'mostly solid',
    })
    const verdict = parseJudgeVerdict(text, 10, [
      { label: '结论点名失败风险', weight: 3 },
      { label: '指标表完整', weight: 3 },
      { label: '中文总结通顺', weight: 2 },
      { label: '无幻觉', weight: 2 },
    ])
    expect(verdict.finalAnswerScore).toBe(5) // (3+2) / 10 * 10
    expect(verdict.hallucination).toBe(false)
    expect(verdict.criteria).toHaveLength(4)
    expect(verdict.criteria![0]).toMatchObject({ label: '结论点名失败风险', pass: true })
  })

  it('accepts 1/0 and "true"/"false" pass values', () => {
    const text = JSON.stringify({
      hallucination: false,
      criteria: [
        { label: 'A', pass: 1 },
        { label: 'B', pass: 0 },
        { label: 'C', pass: 'true' },
        { label: 'D', pass: 'false' },
      ],
    })
    const verdict = parseJudgeVerdict(text, 10, [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }])
    expect(verdict.finalAnswerScore).toBe(5) // 2 of 4 pass
  })

  it('counts omitted criteria as FAIL so dropping them cannot inflate', () => {
    const text = JSON.stringify({
      hallucination: false,
      criteria: [{ label: 'A', pass: true }],
    })
    const verdict = parseJudgeVerdict(text, 10, [{ label: 'A', weight: 3 }, { label: 'B', weight: 3 }])
    expect(verdict.finalAnswerScore).toBe(5) // 3 / 6 * 10, B counts as FAIL
    expect(verdict.criteria).toHaveLength(1)
  })

  it('accepts a legacy numeric verdict when criteria are configured but the model omits them', () => {
    const verdict = parseJudgeVerdict('{"finalAnswerScore": 8, "hallucination": false, "rationale": "ok"}', 10, [
      { label: 'A' },
      { label: 'B' },
    ])
    expect(verdict).toEqual({ finalAnswerScore: 8, hallucination: false, rationale: 'ok' })
  })

  it('judges through the chat seam with criteria', async () => {
    const chat = async () => JSON.stringify({
      hallucination: false,
      criteria: [{ label: 'A', pass: true, why: 'yes' }],
    })
    const verdict = await judgeTrial(caseValue(), trace(), judge({ criteria: [{ label: 'A' }] }), chat)
    expect(verdict.finalAnswerScore).toBe(10)
    expect(verdict.criteria).toEqual([{ label: 'A', pass: true, why: 'yes' }])
  })
})
