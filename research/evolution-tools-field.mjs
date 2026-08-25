// evolution-tools-field.mjs — 工具面实战驱动脚本
// 用 evolution-tools.js 的 execute 函数链驱动 evaluate preset 真实进化。
// 分步执行: propose → (mutate) → candidate → run; 每步打印 execute 返回 JSON。
// 用法: node research/evolution-tools-field.mjs --step <propose|mutate|candidate|run> --<k> <v>...
//   --evidence <run.json> --baseline-dir <dir> --out-dir <dir>   (propose)
//   --dir <dir> --file <f> --from <s> --to <s>                    (mutate)
//   --root <registry> --logical <id> --source <revId>             (candidate)
//     --proposal <proposal.json> --candidate-dir <dir>
//   --benchmark <yaml> --benchmark-baseline <yaml> --benchmark-candidate <yaml>  (run)
//     --registry-root <root> --logical <id>
//     --split <dev|guard> --min-effect <n> --out <dir> --candidate-dir <dir>
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const toolsPath = path.resolve('packages/system-presets/plugins/evolution-tools.js');
const tools = await import(pathToFileURL(toolsPath).href);

const arg = (name) => {
  // 支持驼峰(脚本内部)与 kebab-case(命令行)两种拼写
  for (const candidate of [name, name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())]) {
    const i = process.argv.indexOf('--' + candidate);
    if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return undefined;
};
const step = arg('step') || 'propose';

async function main() {
  if (step === 'propose') {
    const res = await tools.executePropose({
      evidenceRun: arg('evidenceRun'),
      baselineDir: arg('baselineDir'),
      outDir: arg('outDir'),
      logicalId: arg('logicalId') || 'evaluate',
    }, { repoRoot: path.resolve('.') });
    console.log(res);
  } else if (step === 'mutate') {
    const res = await tools.executeMutate({
      dir: arg('dir'),
      file: arg('file'),
      from: arg('from'),
      to: arg('to'),
    });
    console.log(res);
  } else if (step === 'candidate') {
    // 从 proposal.json 读 hypothesis/evidence/mutations + candidateDir 文件
    const proposal = JSON.parse(fs.readFileSync(arg('proposal'), 'utf8'));
    const candidateDir = arg('candidateDir');
    const files = {};
    if (candidateDir && fs.existsSync(candidateDir)) {
      // 目录优先:候选 = 变异文件 + baseline 未动文件(完整 preset 内容集)
      const walk = (dir, base) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name);
          const rel = path.join(base, e.name);
          if (e.isDirectory()) walk(abs, rel);
          else files[rel.split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8');
        }
      };
      walk(candidateDir, '');
    } else if (proposal.candidateFiles) {
      for (const [rel, content] of Object.entries(proposal.candidateFiles)) files[rel] = content;
    }
    const res = await tools.executeCandidate({
      root: arg('root'),
      logicalId: arg('logical') || arg('logicalId'),
      sourceRevisionId: arg('source') || undefined,
      hypothesis: proposal.hypothesis,
      evidence: proposal.evidence || [],
      mutations: proposal.mutations || [],
      files,
    });
    console.log(res);
  } else if (step === 'run') {
    const res = await tools.executeRun({
      benchmark: arg('benchmark'),
      benchmarkBaseline: arg('benchmarkBaseline'),
      benchmarkCandidate: arg('benchmarkCandidate'),
      registryRoot: arg('root'),
      logicalId: arg('logical') || arg('logicalId'),
      split: arg('split') || 'dev',
      minEffect: arg('minEffect') ? Number(arg('minEffect')) : 0.05,
      out: arg('out'),
      candidate: arg('candidateDir') || undefined,
      timeoutMs: arg('timeoutMs') ? Number(arg('timeoutMs')) : undefined,
    });
    console.log(res);
  } else {
    console.error('unknown step: ' + step);
    process.exit(2);
  }
}

// helper
function pathToFileURL(p) {
  return new URL('file://' + p.replace(/\\/g, '/'));
}

await main();
