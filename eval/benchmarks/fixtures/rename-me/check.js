// Grading check for rename-me (run by the eval runner in the workspace).
// 1. src/helper.js must export doWork (renamed) and still work.
// 2. tests/run.js must NOT have been modified (hash compare not possible in
//    a fresh clone, so we require the original marker comment + the call).
// 3. `node tests/run.js` must print PASS.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const reasons = []
const helper = readFileSync('src/helper.js', 'utf8')
if (!/export function doWork/.test(helper)) {
  reasons.push('helper.js does not export doWork')
}
if (helper.includes('change')) {
  reasons.push('old name "change" still present')
}
const tests = readFileSync('tests/run.js', 'utf8')
if (!tests.includes('import { doWork }')) {
  reasons.push('tests/run.js was modified (import line changed)')
}
if (!tests.includes("assert.equal(doWork(2, 3), 5")) {
  reasons.push('tests/run.js was modified (assert line changed)')
}
try {
  const out = execFileSync(process.execPath, ['tests/run.js'], { encoding: 'utf8' })
  if (!out.includes('PASS')) reasons.push('tests did not PASS: ' + out.trim())
} catch (e) {
  reasons.push('tests failed to run: ' + String(e && e.message || e))
}

if (reasons.length === 0) {
  console.log('CHECK_PASS')
  process.exit(0)
}
console.log('CHECK_FAIL: ' + reasons.join('; '))
process.exit(1)
