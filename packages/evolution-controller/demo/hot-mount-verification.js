#!/usr/bin/env node
'use strict';

/**
 * P3-4 hot-mount verification: prove that a SKILL.md produced by the P3-1
 * extractor becomes a live, readable skill when dropped under an ISOLATED
 * DSH_HOME, using the harness's own `@deepseek-ai/dsh-skill-filesystem`
 * provider (unchanged code, imported from the dsh checkout). This is the
 * native hot-mount path: `$DSH_HOME/skills/<name>/SKILL.md` is discovered
 * (one level deep) and rendered invocable through the `skill` tool — no
 * composition change, no plugin row, no restart.
 *
 * Steps:
 *   1. build an isolated DSH_HOME in a temp dir;
 *   2. render a SKILL.md through the real P3-1 generator and place it under
 *      `<home>/skills/<kebab-name>/SKILL.md`;
 *   3. instantiate the real FileSystemSkillProvider pointed at that home;
 *   4. list() → the skill is a candidate; get() → name/description/content
 *      load; prove hot discovery by dropping a second skill and re-listing.
 *
 * This demo only reads the provider; it does NOT integrate anything into any
 * live harness composition. Conclusion is recorded in
 * research/hot-mount-verification.md.
 *
 * Run: node packages/evolution-controller/demo/hot-mount-verification.js
 */
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { extractWorkflow, generateSkill, generateSkillName, generateSkillFilename } = require('../lib/skill-extract');

const SKILL_FS_LIB = path.join('E:/github/dsh', 'packages', 'skill', 'skill-filesystem', 'lib', 'index.js');

/** Minimal duck-typed ctx (get() returns no fs => node-fs fallback path). */
function stubCtx() {
  return {
    get() { return undefined; },
    logger: { warn: (...a) => console.warn('  [provider]', ...a), info() {}, error() {}, debug() {} },
  };
}

function line(text, width = 72, char = '─') {
  const pad = Math.max(0, width - text.length);
  return `${char.repeat(Math.ceil(pad / 2))} ${text} ${char.repeat(Math.floor(pad / 2))}`;
}

function assert(cond, message) {
  if (!cond) { console.error(`✗ ${message}`); process.exit(1); }
  console.log(`✓ ${message}`);
}

async function main() {
  const mod = await import(pathToFileURL(SKILL_FS_LIB).href);
  const { FileSystemSkillProvider } = mod;

  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-home-iso-'));
  const skillDir = path.join(home, 'skills');
  console.log(line('P3-4 hot-mount verification — isolated DSH_HOME'));
  console.log(`isolated DSH_HOME: ${home}`);

  // 1. P3-1 pipeline: extract from a synthetic trace, render a SKILL.md
  const workflow = extractWorkflow({
    events: [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: 'Summarize README files into a report' }], role: 'user' } },
      { type: 'tool/call', seq: 2, time: 3, data: { name: 'glob', arguments: '{"pattern":"**/README.md"}' } },
      { type: 'tool/result', seq: 3, time: 4, data: { message: { content: [{ type: 'text', text: 'a/README.md' }] } } },
      { type: 'tool/call', seq: 4, time: 5, data: { name: 'read', arguments: '{"file_path":"a/README.md"}' } },
      { type: 'tool/result', seq: 5, time: 6, data: { message: { content: [{ type: 'text', text: '# a docs' }] } } },
      { type: 'turn/end', seq: 6, time: 7, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  });
  const name = generateSkillName(workflow.taskDescription);
  const filename = generateSkillFilename(name);
  assert(filename === `${name}.md`, `P3-1 filename derives from the skill name: ${filename}`);

  // 2. write the SKILL.md bundle under an isolated DSH_HOME
  await fsp.mkdir(path.join(skillDir, name), { recursive: true });
  const md = generateSkill(workflow, {
    name,
    description: 'Summarize README files into a report',
    generatedFrom: 'session-a0c5c3a4-4b13-4d00-9cff-21cfcb3f40bc',
    generatedAt: '2026-08-23T00:00:00.000Z',
  });
  await fsp.writeFile(path.join(skillDir, name, 'SKILL.md'), md, 'utf8');
  assert(true, `SKILL.md written to $DSH_HOME/skills/${name}/SKILL.md (${md.length} chars)`);

  // 3. instantiate the REAL provider against the isolated home (watch off for determinism)
  const ctx = stubCtx();
  const signal = new AbortController().signal;
  const provider = new FileSystemSkillProvider(ctx, { invalidate() {}, signal }, {
    providerName: 'iso',
    includeDefaultRoots: true,
    dshHome: home,
    agentsHome: path.join(home, '.agents'),
    customSkillDirs: [],
    watch: false,
  });

  // 4. discovery through the harness's own discovery code
  let candidates = await provider.list({});
  assert(Array.isArray(candidates), 'provider.list() returned a candidate list');
  const found = candidates.find((c) => c.name === name);
  assert(!!found, `candidate discovered: ${name}`);
  assert(found.source === 'user-dsh' || found.source === 'user-agents', `source root: ${found.source}`);

  const skill = await provider.get(found, { signal });
  assert(!!skill, 'skill body loads');
  assert(skill.name === name, `loaded skill.name = ${skill.name}`);
  assert(/Summarize README files/.test(skill.description), `loaded skill.description matches`);
  assert(skill.content.includes('## Steps'), 'loaded skill content is the P3-1 body');
  console.log(`  resourceBase: ${skill.resourceBase.kind} ${skill.resourceBase.path}`);

  // 5. HOT discovery: drop a second SKILL.md after provider init, re-list
  await fsp.mkdir(path.join(skillDir, 'hot-add'), { recursive: true });
  const hotMd = `---\nname: hot-add\ndescription: Dropped after provider init\n---\n\nDo the hot thing.\n`;
  await fsp.writeFile(path.join(skillDir, 'hot-add', 'SKILL.md'), hotMd, 'utf8');
  candidates = await provider.list({});
  assert(!!candidates.find((c) => c.name === 'hot-add'), 'second skill discovered without restart (hot add)');

  await provider.dispose();
  await fsp.rm(home, { recursive: true, force: true });
  console.log('', line('verdict'));
  console.log('FEASIBLE: SKILL.md → live skill via the native filesystem provider;');
  console.log('zero composition changes; discoverable without restart.');
}

main().catch((err) => { console.error(err); process.exit(1); });