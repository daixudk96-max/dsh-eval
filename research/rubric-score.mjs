// rubric-score.mjs — 独立 LLM judge: 按 rubric 对 REPORT.md 打分
// 背景: dsh-eval runner 的 judge 需要 host llm 服务(eval profile 无),
//       真实评测 run json 里 judge verdict 为 null。本脚本直接调 clipa
//       (本地 8317) 的 deepseek-v4-flash, 按 evaluate-preset-rubric-benchmark
//       的 rubricText 对最终交付物 REPORT.md 打分 (0-10), 归一化到 0-100。
// 输入: --run <run.json> --workspace <trial workspace 目录>
// 输出: 同目录下 <run 名>.judge.json {score0_100, raw, rationale}
// 运行: node research/rubric-score.mjs --run eval/benchmarks/run-rubric-baseline.json --workspace <tempRoot>/eval-real-session-1/workspace
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const RUBRIC = `Score the agent's REPORT.md deliverable on a 0-10 scale per dimension:
(1) completeness: metrics table with steps, tool calls, tool success rate,
    tokens present and internally consistent;
(2) accuracy: numbers match the imported report JSON, no invented metrics;
(3) analysis: a Chinese conclusion that identifies failures or risks,
    not just a restatement of the table.
Report each dimension separately in the rationale.`;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function judgeReport(reportMd, apiKey) {
  const body = {
    model: 'deepseek-v4-flash',
    temperature: 0,
    messages: [
      { role: 'system', content: `You are an impartial evaluation judge. Score the agent's REPORT.md from 0 to 10 against this rubric:\n\n${RUBRIC}\n\nReturn STRICT JSON with exactly: {"finalAnswerScore": <integer 0..10>, "rationale": "<one short sentence>"}` },
      { role: 'user', content: `REPORT.md:\n\n${reportMd.slice(0, 20000)}` },
    ],
  };
  const res = await fetch('http://127.0.0.1:8317/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`clipa judge http ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  const cleaned = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u, '$1');
  const verdict = JSON.parse(cleaned);
  const score = Number(verdict.finalAnswerScore);
  if (!Number.isFinite(score)) throw new Error(`judge returned unusable score: ${text.slice(0, 200)}`);
  return { score, rationale: verdict.rationale ?? '' };
}

async function main() {
  const runFile = arg('--run');
  const workspace = arg('--workspace');
  if (!runFile || !workspace) throw new Error('usage: --run <run.json> --workspace <trial workspace>');
  const credsText = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
  const creds = {};
  for (const line of credsText.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
    if (m) creds[m[1]] = m[2];
  }
  const apiKey = creds['CLIPA_API_KEY'];
  if (!apiKey) throw new Error('CLIPA_API_KEY not found in ~/.dsh/.credentials.yaml');
  const reportPath = path.join(workspace, 'REPORT.md');
  const reportMd = fs.readFileSync(reportPath, 'utf8');
  const { score, rationale } = await judgeReport(reportMd, apiKey);
  const outPath = path.join(REPO, 'eval', 'benchmarks', `${path.basename(runFile, '.json')}.rubric.json`);
  fs.writeFileSync(outPath, JSON.stringify({ run: runFile, score, score0_100: score * 10, maxScore: 10, rationale, at: new Date().toISOString() }, null, 2));
  console.log(`✓ ${path.basename(runFile)}: judge score ${score}/10 (${score * 10}/100) — ${rationale}`);
  console.log(`  → ${outPath}`);
}

main().catch((e) => { console.error('rubric-score failed:', e); process.exitCode = 1; });
