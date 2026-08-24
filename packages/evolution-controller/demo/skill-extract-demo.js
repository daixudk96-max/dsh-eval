#!/usr/bin/env node
'use strict';

/**
 * P3-1 real demo: decode the real eval sample session
 * (eval/benchmarks/evaluate-preset/sample-session.jsonl.zstd) into an
 * EvalTrace, run the P3-1 extractor (skill-extract.js), render a SKILL.md,
 * and write it to a temp directory. No LLM — pure decode + extract + render.
 *
 * The .zstd container is decoded through the packaged dsh-eval import lib
 * (built artifact; importing the repo's src/lib would pull in a TS build and
 * an undeclared @deepseek-ai/dsh-llm dependency).
 *
 * Run: node packages/evolution-controller/demo/skill-extract-demo.js
 */
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { extractWorkflow, generateSkill, generateSkillFilename, generateSkillName } = require('../lib/skill-extract');

const SAMPLE = path.join(__dirname, '..', '..', '..', 'eval', 'benchmarks', 'evaluate-preset', 'sample-session.jsonl.zstd');
const IMPORT_LIB = 'C:/Users/daixu/.dsh/profiles/eval/node_modules/dsh-eval/lib/import.js';

function line(text, width = 74, char = '─') {
  const pad = Math.max(0, width - text.length);
  return `${char.repeat(Math.ceil(pad / 2))} ${text} ${char.repeat(Math.floor(pad / 2))}`;
}

async function main() {
  const lib = await import(pathToFileURL(IMPORT_LIB).href);
  const { decodeZstdSession, importDshLog } = lib;

  const buffer = await fsp.readFile(SAMPLE);
  const text = decodeZstdSession(buffer);
  const trace = importDshLog(text);
  console.log(line('P3-1 skill extract — real session demo'));
  console.log(`session:  ${trace.sessionId}`);
  console.log(`events:   ${trace.events.length} (${trace.createdAt ? new Date(trace.createdAt).toISOString() : ''})`);

  const workflow = extractWorkflow(trace);
  console.log(`turns:    ${workflow.turnCount}  completed: ${workflow.success}`);
  console.log(`tools:    ${workflow.toolsUsed.join(', ') || '(none)'}`);
  console.log(`steps:    ${workflow.steps.length} (deduped from ${workflow.toolsUsed.length} distinct tools)`);
  console.log(line(''), '');

  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'skill-extract-demo-'));
  const name = generateSkillName(workflow.taskDescription) || 'extracted-skill';
  const filename = generateSkillFilename(name);
  const outPath = path.join(outDir, filename);
  const md = generateSkill(workflow, {
    name,
    description: `Extracted from real session ${trace.sessionId} — ${workflow.steps.length} tool step(s)`,
    generatedFrom: trace.sessionId,
    generatedAt: new Date().toISOString(),
  });
  await fsp.writeFile(outPath, md, 'utf8');
  console.log(`✓ wrote ${outPath}`);
  console.log(line('first lines'), '');
  console.log(md.split('\n').slice(0, 16).join('\n'));
  console.log('', line('done'));
  // keep the temp dir around for inspection; report its path above
}

main().catch((err) => { console.error(err); process.exit(1); });