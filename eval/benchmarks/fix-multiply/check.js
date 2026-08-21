// Grading check: verifies the fix and the ANSWER.md (run by the eval runner).
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const reasons = []

if (!existsSync('ANSWER.md')) {
  reasons.push('ANSWER.md missing')
} else {
  const text = readFileSync('ANSWER.md', 'utf8')
  if (!/product|\*|multiply/i.test(text)) reasons.push('ANSWER.md does not mention the fix')
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
