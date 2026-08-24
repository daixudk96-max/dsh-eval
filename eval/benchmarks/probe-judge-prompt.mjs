// probe-judge-prompt.mjs — 验证强化后的 judge prompt 是否让 deepseek-v4-flash 返回严格 JSON
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let key
const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/)
  if (m && m[1] === 'CLIPA_API_KEY' && m[2]) key = m[2]
}

const system = [
  'You are an impartial evaluation judge for agent task completion.',
  'Score the agent final answer from 0 to 10 against the task,',
  'and set hallucination to true only when the final answer asserts facts',
  'not supported by the task or the trace.',
  'Return STRICT JSON with exactly these fields:',
  '{"finalAnswerScore": <integer 0..10>, "hallucination": <true|false>, "rationale": "<one short sentence>"}',
  'Respond with ONLY that JSON object. No markdown fences. No commentary. No other fields.',
].join('\n')

const res = await fetch('http://127.0.0.1:8317/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'deepseek-v4-flash',
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Task id: fix-multiply\nTask: Fix the bug...\nTrace summary:\nfinal answer: Fixed multiply.js so multiply(a,b) returns a*b; tests PASS; ANSWER.md written.\ntools called: read, pwsh\ninvalid tool calls: 0\nllm retries: 0' },
    ],
  }),
  signal: AbortSignal.timeout(60000),
})
const body = await res.json()
console.log('reply:', JSON.stringify(body.choices[0].message.content))
