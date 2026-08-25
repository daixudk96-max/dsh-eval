// prepare-field-round.mjs — 组装 2026-08-25 实战闭环的 baseline/candidate workspaces + benchmark yamls
// 运行: node research/prepare-field-round.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Registry } from '../packages/preset-registry/lib/registry.js';

const REG = 'C:/Users/daixu/.dsh/preset-registry';
const BASE = 'eval/benchmarks';

const yamlFor = (ws) => `name: evaluate-field
# 实战: system-evolver 驱动真实进化 (2026-08-25 field round)
# 注意: baseline/candidate 两个 yaml 必须同名同 case(epoch 一致);
# 被测内容差异经 workspace/command 注入, 不在 benchmarkDigest 内。
provider: clipa
model: deepseek-v4-flash
reasoningEffort: max
profile: headless
command: [node, E:\\github\\dsh-eval\\eval\\benchmarks\\${ws}\\wrapper.cjs, --preset-src, E:\\github\\dsh-eval\\eval\\benchmarks\\${ws}, --preset-name, evaluate-field, --provider, clipa, --model, deepseek-v4-flash, --reasoning-effort, max]
trials: 1
timeoutMs: 600000
seed: 42
cases:
  - id: eval-real-session
    prompt: |
      Evaluate the DSH session log at ./sample-session.jsonl.zstd using the eval profile:
      1. Import the session: \`node E:\\github\\dsh\\apps\\cli\\lib\\bin.js --profile eval import dsh ./sample-session.jsonl.zstd --out eval-report.json --case-id sample-session\`
      2. Render the report: \`node E:\\github\\dsh\\apps\\cli\\lib\\bin.js --profile eval report eval-report.json\`
      3. Write REPORT.md with the markdown metrics table (steps, tool calls, tool success, tokens, latency) and a Chinese conclusion.
      IMPORTANT: REPORT.md MUST end with a 'Failure clusters' section listing 2-5 actionable
      failure groups with evidence references (failed tool call ids, invalid calls, token
      anomalies), because this section feeds the evolution loop.
      Do not modify check.js.
    workspace: E:\\github\\dsh-eval\\eval\\benchmarks\\${ws}
    expected:
      tool: read
      check: node check.js
`;

async function main() {
  const reg = new Registry({ root: REG });
  const cur = await reg.resolveCurrent('evaluate');
  const c = await reg.revisionContent(cur.digest);
  console.log(`current: ${cur.revisionId} | files: ${Object.keys(c.files).join(', ')}`);

  const mk = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
  const srcWorkspace = path.join(BASE, 'evaluate-preset-p2');
  const bl = mk(path.join(BASE, 'evaluate-field-baseline'));
  const cd = mk(path.join(BASE, 'evaluate-field-candidate'));

  // 运行素材: sample-session + wrapper + check
  for (const d of [bl, cd]) {
    for (const f of ['sample-session.jsonl.zstd', 'wrapper.cjs', 'check.js']) {
      fs.copyFileSync(path.join(srcWorkspace, f), path.join(d, f));
    }
  }
  // current 三文件 → 两 workspace
  for (const [name, text] of Object.entries(c.files)) {
    fs.writeFileSync(path.join(bl, name), text, 'utf8');
    fs.writeFileSync(path.join(cd, name), text, 'utf8');
  }
  // 变异 agent.cordis.yml 覆盖 candidate workspace
  const candDir = 'eval/presets/candidates/evolve-field-2026-08-25';
  const mutated = fs.readFileSync(path.join(candDir, 'agent.cordis.yml'), 'utf8');
  fs.writeFileSync(path.join(cd, 'agent.cordis.yml'), mutated, 'utf8');
  // proposal.json 移出候选目录(避免污染 revision 内容集)
  const proposalPath = path.join(candDir, 'proposal.json');
  if (fs.existsSync(proposalPath)) {
    fs.renameSync(proposalPath, 'eval/presets/candidates/evolve-field-2026-08-25.proposal.json');
  }
  // 候选目录补全三文件(完整预设内容)
  for (const [name, text] of Object.entries(c.files)) {
    if (name !== 'agent.cordis.yml') fs.writeFileSync(path.join(candDir, name), text, 'utf8');
  }
  // benchmark yamls
  fs.writeFileSync(path.join(BASE, 'evaluate-field-baseline-benchmark.yaml'), yamlFor('evaluate-field-baseline'), 'utf8');
  fs.writeFileSync(path.join(BASE, 'evaluate-field-candidate-benchmark.yaml'), yamlFor('evaluate-field-candidate'), 'utf8');

  console.log('baseline workspace :', fs.readdirSync(bl).join(', '));
  console.log('candidate workspace:', fs.readdirSync(cd).join(', '));
  console.log('candidate dir      :', fs.readdirSync(candDir).join(', '));
  console.log('yamls written OK');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
