// probe-judge-bit.mjs
// 验证 bit-vector judge: 裁判模型按标准逐条输出 pass/fail(不输出数字),
// 分数由代码加权计算。直连 ollama 云(deepseek-v4-flash:0731)。
// 运行: node research/probe-judge-bit.mjs
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API_KEY_ENV = 'OLLAMA_API_KEY'
const BASE_URL = 'https://ollama.com/v1'
const MODEL = 'deepseek-v4-flash:0731'

function resolveKey() {
  if (process.env[API_KEY_ENV]) return process.env[API_KEY_ENV]
  try {
    const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/)
      if (m && m[1] === API_KEY_ENV && m[2] !== '') return m[2]
    }
  } catch {}
  return undefined
}

// 与 packages/dsh-eval/src/judge.ts buildJudgePrompt(criteria 分支)一致
const CRITERIA = [
  { label: '结论点名了失败/风险, 不是只复述表格', weight: 3 },
  { label: '指标表完整(steps/tool/tokens/latency)', weight: 3 },
  { label: '中文总结通顺、与表格数字一致', weight: 2 },
  { label: '无幻觉(不编造数字/事实)', weight: 2 },
]

function systemPrompt() {
  return [
    'You are an impartial evaluation judge for agent task completion.',
    'Judge the agent by the criteria below. For EACH criterion answer only',
    'PASS (true) or FAIL (false), strictly from the task and the trace evidence.',
    'Do NOT emit a numeric score: the final score is computed elsewhere from',
    'your pass/fail answers.',
    ...CRITERIA.map(c => `- ${c.label}`),
    'Return STRICT JSON with exactly these fields:',
    '{"hallucination": <true|false>, "criteria": [{"label": "<exact criterion label>", "pass": <true|false>, "why": "<one short sentence>"}], "rationale": "<one short sentence>"}',
    'Every criterion label must appear exactly once in "criteria".',
    'Respond with ONLY that JSON object. No markdown fences. No commentary. No other fields.',
  ].join('\n')
}

const userPrompt = [
  'Task id: eval-real-session',
  'Task: import the given DSH session log and write REPORT.md with a metrics table and a Chinese summary naming failures.',
  'Trace summary:',
  'final answer: REPORT.md written: metrics table (steps 15, tool calls 20, tool success 19, invalid 1, tokens 643867, latency 1555860ms) + Chinese summary noting one failed tool call (read E:\\github\\dsh-eval\\docs\\final-report.md → FS_NOT_FOUND)',
  'tools called: pwsh, read, node',
  'invalid tool calls: 1',
  'llm retries: 0',
].join('\n')

async function main() {
  const key = resolveKey()
  if (!key) { console.error('no OLLAMA_API_KEY'); process.exit(1) }
  console.log('→ 调用', MODEL, '(bit-vector judge prompt)')
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) { console.error('http', res.status, (await res.text()).slice(0, 300)); process.exit(1) }
  const payload = await res.json()
  const text = payload.choices?.[0]?.message?.content
  console.log('--- 模型原始输出 ---')
  console.log(text)
  console.log('---------------------')
  // 与 parseJudgeVerdict 一致: 解析 criteria + 加权算分
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u, '$1')
  let value
  try { value = JSON.parse(cleaned) } catch (e) { console.error('JSON parse failed:', e.message); process.exit(1) }
  const byLabel = new Map()
  for (const c of value.criteria ?? []) byLabel.set(c.label, c.pass === true || c.pass === 1 || c.pass === '1' || c.pass === 'true')
  let total = 0, got = 0
  for (const c of CRITERIA) { const w = c.weight ?? 1; total += w; if (byLabel.get(c.label) === true) got += w }
  const score = Math.round((got / total) * 10 * 100) / 100
  console.log(`→ 判定: ${value.criteria?.length ?? 0}/${CRITERIA.length} 条返回, hallucination=${value.hallucination}`)
  console.log(`→ 加权分数(finalAnswerScore) = ${score} / 10  (${got}/${total} 权重)` )
  console.log('→ 逐条:', JSON.stringify(value.criteria ?? []))
}

main().catch(e => { console.error('probe failed:', e.message); process.exit(1) })