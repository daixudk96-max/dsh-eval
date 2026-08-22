// Probe: print the exact OLLAMA_API_KEY the runner injected into the child env.
// Writes a diagnostic file next to the workspace; exits 0 and prints PASS so a
// benchmark `check` can confirm the toolchain, but the real goal is the dump.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KEYS = ['OLLAMA_API_KEY', 'CLIPA_API_KEY', 'DEEPSEEK_API_KEY']
const dump = Object.fromEntries(
  KEYS.map((k) => {
    const key = process.env[k]
    return [k, {
      hasKey: key !== undefined,
      len: key === undefined ? -1 : key.length,
      repr: key === undefined ? null : JSON.stringify(key),
      legal: key === undefined ? null : /^[\x21-\x7E]+$/.test(key.trim()),
    }]
  }),
)
try {
  const out = join(process.cwd(), 'probe-env.json')
  writeFileSync(out, JSON.stringify(dump, null, 2))
} catch (e) {
  console.error('probe write failed: ' + (e instanceof Error ? e.message : String(e)))
}
console.log('APP_OK env-probe ' + JSON.stringify(Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, { len: v.len, legal: v.legal }]))))
