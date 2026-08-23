// Grading check for readme-me (run by the eval runner in the workspace).
// README.md must exist, document multiply usage, and mention error
// handling — a generic README fails.
import { readFileSync } from 'node:fs'

const reasons = []
try {
  const readme = readFileSync('README.md', 'utf8')
  if (!/multiply/i.test(readme)) reasons.push('README does not mention multiply')
  if (!/usage|example|how to|import|import {/i.test(readme)) reasons.push('README has no usage/example section')
  if (!/error|throw|TypeError|invalid/i.test(readme)) reasons.push('README does not mention error handling')
  if (readme.length < 120) reasons.push('README too short (<120 chars)')
} catch {
  reasons.push('README.md missing')
}

if (reasons.length === 0) {
  console.log('CHECK_PASS')
  process.exit(0)
}
console.log('CHECK_FAIL: ' + reasons.join('; '))
process.exit(1)
