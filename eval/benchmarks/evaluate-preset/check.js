// Grading check for the evaluate-preset benchmark: verifies the eval agent
// produced a real report (REPORT.md with metrics table + Chinese conclusion)
// and that the import actually ran (a report JSON exists).
import { existsSync, readFileSync } from 'node:fs'

const reasons = []

if (!existsSync('REPORT.md')) {
  reasons.push('REPORT.md missing')
} else {
  const text = readFileSync('REPORT.md', 'utf8')
  if (!/steps|tool|token|指标|步骤/i.test(text)) reasons.push('REPORT.md lacks a metrics table')
  if (!/[\u4e00-\u9fff]/.test(text)) reasons.push('REPORT.md lacks a Chinese conclusion')
}

// Any report JSON the agent produced (import --out) counts as evidence the
// eval CLI actually ran.
const reportJsons = ['eval-report.json', 'report.json', 'run.json']
if (!reportJsons.some((f) => existsSync(f))) {
  reasons.push('no report JSON produced (import did not run)')
}

if (reasons.length === 0) {
  console.log('CHECK_PASS')
  process.exit(0)
}
console.log('CHECK_FAIL: ' + reasons.join('; '))
process.exit(1)
