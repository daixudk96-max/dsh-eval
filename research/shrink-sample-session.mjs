// shrink-sample.mjs — 缩小评测样本: 解压多帧 zstd 容器 → 截取前 2 个完整 turn → 重压
// 复用 dsh-eval 的 decodeZstdSession(import.js 导出)处理多帧容器。
// 注意: 源码 lib/import.js 的依赖链(@deepseek-ai/dsh-llm)在 workspace 无 node_modules,
// 改用 eval profile bundle 内打包版 dsh-eval(依赖齐全)。
import { readFileSync, writeFileSync } from 'node:fs';
import { zstdCompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const { decodeZstdSession } = await import(
  pathToFileURL('C:/Users/daixu/.dsh/profiles/eval/node_modules/dsh-eval/lib/import.js').href
);

const SRC = 'eval/benchmarks/evaluate-preset-p2/sample-session.jsonl.zstd';
const OUT = 'eval/benchmarks/evaluate-preset-p2/sample-session-small.jsonl.zstd';
const TURNS = 2;

const json = decodeZstdSession(readFileSync(SRC));
const lines = json.split('\n').filter(Boolean);
console.log('full session:', json.length, 'chars,', lines.length, 'lines');

// 事件类型直方图(截取前后对比用)
const hist = (arr) => {
  const h = {};
  for (const l of arr) { try { const o = JSON.parse(l); h[o.type] = (h[o.type] || 0) + 1; } catch {} }
  return h;
};
console.log('full types:', JSON.stringify(hist(lines)));

// 截取: 保留到第 TURNS 个 turn/end 之后(含), 至少保留开头元数据
let keep = 0;
let turnsSeen = 0;
for (let i = 0; i < lines.length; i++) {
  keep = i + 1;
  let o;
  try { o = JSON.parse(lines[i]); } catch { continue; }
  if (o.type === 'turn/end') {
    turnsSeen++;
    if (turnsSeen >= TURNS) break;
  }
}
const cut = lines.slice(0, keep);
console.log('cut at line', keep, '→', cut.length, 'lines');
console.log('cut types:', JSON.stringify(hist(cut)));

// 重压(zstd 单帧容器; dsh 读取时按帧扫描, 单帧即可)
const outBuf = zstdCompressSync(Buffer.from(cut.join('\n') + '\n', 'utf8'));
writeFileSync(OUT, outBuf);
console.log('written:', OUT, outBuf.length, 'bytes (was', readFileSync(SRC).length, ')');
