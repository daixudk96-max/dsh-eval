// wrapper.cjs — benchmark `command` override for evaluating a user agent
// preset (e.g. `evaluate`) under dsh-eval's isolated child DSH_HOME.
//
// dsh-eval spawns the child with a fresh temp DSH_HOME, so three things the
// real home has are invisible to the child:
//   1. user agent presets under ~/.dsh/.agent-presets — and `--profile`
//      does NOT select an agent preset anyway (it selects a profile bundle);
//      the headless bundle composes no preset roster, so the agent reads its
//      model-facing rows from the global layer. The way to make the child
//      agent BE the preset is to merge the preset's agent.cordis.yml rows
//      into the runner's eval overlay.
//   2. the `eval` profile bundle under ~/.dsh/profiles/eval — the child's
//      `dsh --profile eval ...` calls (import/report) fail without it.
//   3. the provider settings + credential — dsh-eval's settings/credential
//      bridge is deliberately SKIPPED when a benchmark declares an explicit
//      `command` (the user owns the child launch), so this wrapper must
//      rebuild the child settings.yaml (agent-default-model + the selected
//      provider subtree from the real settings.yaml) and inject the
//      provider's API key (read from ~/.dsh/.credentials.yaml when the
//      launching env does not carry it).
//
// This wrapper therefore:
//   a. copies ~/.dsh/profiles/eval into $DSH_HOME/profiles/eval,
//   b. writes $DSH_HOME/settings.yaml from the real settings (provider
//      subtree + agent-default-model), and injects the provider API key,
//   c. reads the runner's overlay (argv --patch), appends the preset's
//      agent.cordis.yml rows, writes the merged overlay next to it, and
//      rewrites argv to point at the merged overlay,
//   d. exec's the real dsh CLI with the rewritten argv.
//
// Wrapper-owned argv (stripped before forwarding): --preset-src <dir>,
// --preset-name <id>, --provider <name>, --model <id>, --reasoning-effort <e>.
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DSH_HOME = process.env.DSH_HOME;
if (!DSH_HOME) {
  console.error('wrapper: DSH_HOME not set');
  process.exit(1);
}
const realHome = process.env.REAL_DSH_HOME || path.join(os.homedir(), '.dsh');

// ---- wrapper-owned argv ----------------------------------------------------
const argv = process.argv.slice(2);
let presetSrc = process.env.PRESET_SRC;
let presetName = process.env.PRESET_NAME || 'evaluate';
let providerName = process.env.PRESET_PROVIDER;
let modelId = process.env.PRESET_MODEL;
let reasoningEffort = process.env.PRESET_REASONING_EFFORT;
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  const next = i + 1 < argv.length ? argv[i + 1] : undefined;
  if ((flag === '--preset-src' || flag === '--preset-name' || flag === '--provider' || flag === '--model' || flag === '--reasoning-effort') && next !== undefined) {
    if (flag === '--preset-src') presetSrc = next;
    else if (flag === '--preset-name') presetName = next;
    else if (flag === '--provider') providerName = next;
    else if (flag === '--model') modelId = next;
    else if (flag === '--reasoning-effort') reasoningEffort = next;
    argv.splice(i, 2);
    i--;
  }
}
if (presetSrc === undefined) {
  presetSrc = path.join(realHome, '.agent-presets', presetName);
}

// ---- (a) make the eval profile bundle visible to the child ----------------
const evalProfileSrc = path.join(realHome, 'profiles', 'eval');
const evalProfileDest = path.join(DSH_HOME, 'profiles', 'eval');
if (fs.existsSync(evalProfileSrc)) {
  fs.mkdirSync(path.dirname(evalProfileDest), { recursive: true });
  fs.cpSync(evalProfileSrc, evalProfileDest, { recursive: true });
  console.error(`wrapper: installed eval profile -> ${evalProfileDest}`);
} else {
  console.error(`wrapper: WARNING eval profile not found at ${evalProfileSrc}`);
}

// ---- (b) rebuild child settings.yaml + inject the provider API key --------
let yaml;
try {
  yaml = require(path.join(evalProfileSrc, 'node_modules', 'js-yaml'));
} catch {
  yaml = require('js-yaml');
}
const childEnv = { ...process.env };
if (providerName !== undefined && modelId !== undefined) {
  const realSettings = yaml.load(fs.readFileSync(path.join(realHome, 'settings.yaml'), 'utf8'));
  const providers = realSettings?.['llm-pi-ai']?.providers ?? {};
  const providerCfg = providers[providerName];
  if (providerCfg === undefined) {
    console.error(`wrapper: provider "${providerName}" not found in real settings.yaml`);
    process.exit(1);
  }
  const childSettings = {
    'agent-default-model': {
      provider: providerName,
      model: modelId,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    },
    'llm-pi-ai': { providers: { [providerName]: providerCfg } },
  };
  fs.writeFileSync(path.join(DSH_HOME, 'settings.yaml'), yaml.dump(childSettings), 'utf8');
  console.error(`wrapper: wrote child settings.yaml (provider ${providerName}, model ${modelId})`);
  // Credential: prefer the launching env, else the real credentials file.
  const ref = providerCfg.apiKeyEnv;
  if (ref !== undefined) {
    let value = process.env[ref];
    if (value === undefined || value === '') {
      const credPath = path.join(realHome, '.credentials.yaml');
      if (fs.existsSync(credPath)) {
        const creds = yaml.load(fs.readFileSync(credPath, 'utf8'));
        value = creds?.[ref];
      }
    }
    if (value !== undefined && value !== '') {
      childEnv[ref] = value;
      console.error(`wrapper: injected credential ref ${ref} into child env`);
    } else {
      console.error(`wrapper: WARNING no value for credential ref ${ref}`);
    }
  }
} else {
  console.error('wrapper: WARNING --provider/--model not given; child settings.yaml not written');
}

// ---- (c) merge the preset's agent-plane rows into the runner's overlay ----
let overlayPath = null;
for (let i = 0; i < argv.length - 1; i++) {
  if (argv[i] === '--patch') {
    overlayPath = argv[i + 1];
    break;
  }
}
if (overlayPath === null) {
  console.error('wrapper: no --patch overlay in argv');
  process.exit(1);
}
if (!fs.existsSync(presetSrc)) {
  console.error(`wrapper: preset source not found: ${presetSrc}`);
  process.exit(1);
}
const overlayText = fs.readFileSync(overlayPath, 'utf8');
const presetRows = fs.readFileSync(path.join(presetSrc, 'agent.cordis.yml'), 'utf8');
const merged = `${overlayText.replace(/\s+$/u, '')}\n${presetRows}\n`;
const mergedPath = path.join(DSH_HOME, 'eval-overlay.cordis.yml');
fs.writeFileSync(mergedPath, merged, 'utf8');
for (let i = 0; i < argv.length - 1; i++) {
  if (argv[i] === '--patch') {
    argv[i + 1] = mergedPath;
    break;
  }
}
console.error(`wrapper: merged preset ${presetName} rows into overlay -> ${mergedPath}`);

// ---- (d) exec the real dsh CLI ---------------------------------------------
const bin = process.env.DSH_BIN || path.join('E:', 'github', 'dsh', 'apps', 'cli', 'lib', 'bin.js');
const r = spawnSync(process.execPath, [bin, ...argv], {
  stdio: 'inherit',
  env: childEnv,
});
process.exit(r.status === null ? 1 : r.status);
