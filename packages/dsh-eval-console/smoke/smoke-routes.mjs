/**
 * Route smoke: mount the /eval route family on a plain node:http server
 * (no DSH webServer service) and exercise state / action / events / fence.
 *
 * READ-ONLY against the real registry (state + refresh only; the rollback
 * case below is a deliberately-invalid envelope that is rejected before any
 * mutation).
 *
 * Usage: node smoke/smoke-routes.mjs
 * (cwd = packages/dsh-eval-console so relative imports resolve; registry and
 * audit paths follow DSH_HOME like smoke-state.mjs).
 */

import { createRequire } from 'node:module'
import http from 'node:http'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
const { Registry } = require('../../preset-registry/lib/registry.js')
const { makeEvalRoutes } = await import('../src/host-routes.ts')
const { EvalConsoleHostService } = await import('../src/host-service.ts')

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const registryRoot = path.join(home, 'preset-registry')
const logicalId = 'evaluate'
const auditSingle = path.join(home, 'evolution-audit', 'ledger.jsonl')
const auditNested = path.join(home, 'evolution-audit', 'ledger', 'ledger.jsonl')
const auditFile = existsSync(auditSingle) || !existsSync(auditNested) ? auditSingle : auditNested

const registry = new Registry({ root: registryRoot })
const service = new EvalConsoleHostService({ registry, registryRoot, logicalId, auditFile, tailLimit: 120 })
service.start()

const routes = makeEvalRoutes(service)
const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  const route = routes.find((candidate) => candidate.kind === 'exact' && candidate.path === url)
  if (route === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  void Promise.resolve(route.handler(req, res))
})

const PORT = 37811
const BASE = `http://127.0.0.1:${PORT}`
const BROWSER = { 'sec-fetch-site': 'same-origin' }

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
console.log(`[smoke] server on ${BASE}`)

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === '' ? '' : ' — ' + extra}`)
  if (!ok) failures += 1
}

try {
  // 1. state
  const stateRes = await fetch(`${BASE}/eval/state`, { headers: BROWSER, cache: 'no-store' })
  check('GET /eval/state 200', stateRes.status === 200, `status=${stateRes.status}`)
  const state = await stateRes.json()
  check('state is an EvalSnapshot', state.schemaVersion === 1 && Array.isArray(state.columns) && state.columns.length === 6)
  check('state carries current + revision', typeof state.revision === 'number' && (state.current === null || typeof state.current.revisionId === 'string'))

  // 2. refresh action (read-only)
  const refreshRes = await fetch(`${BASE}/eval/action`, {
    method: 'POST',
    headers: { ...BROWSER, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'smoke-refresh-1', action: { kind: 'refresh' } }),
  })
  check('POST /eval/action refresh 200', refreshRes.status === 200, `status=${refreshRes.status}`)
  const refreshed = await refreshRes.json()
  check('refresh returns a snapshot', refreshed.ok === true && refreshed.action === 'refresh' && refreshed.snapshot?.schemaVersion === 1)

  // 3. rollback without a confirm token is rejected (no mutation)
  const badRollback = await fetch(`${BASE}/eval/action`, {
    method: 'POST',
    headers: { ...BROWSER, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'smoke-rollback-1', action: { kind: 'rollback', logicalId, revisionId: 'evaluate-x', confirm: '' } }),
  })
  check('POST /eval/action unconfirmed rollback 400', badRollback.status === 400, `status=${badRollback.status}`)

  // 4. SSE first frame
  const eventsRes = await fetch(`${BASE}/eval/events`, { headers: BROWSER })
  check('GET /eval/events 200 text/event-stream', eventsRes.status === 200 && (eventsRes.headers.get('content-type') ?? '').includes('text/event-stream'))
  const reader = eventsRes.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let frame = ''
  for (let i = 0; i < 64; i += 1) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const double = buffer.indexOf('\n\n')
    if (double >= 0) {
      frame = buffer.slice(0, double)
      break
    }
  }
  await reader.cancel()
  check('SSE first data frame carries a revision', /^data: /.test(frame) && /"revision":\s*\d+/.test(frame), frame.split('\n')[0]?.slice(0, 80) ?? '')

  // 5. fence: bare request (no browser marker) is refused
  const bare = await fetch(`${BASE}/eval/state`)
  check('GET /eval/state without browser marker 403', bare.status === 403, `status=${bare.status}`)

  // 6. wrong method
  const wrongMethod = await fetch(`${BASE}/eval/state`, { method: 'POST', headers: BROWSER })
  check('POST /eval/state 405', wrongMethod.status === 405, `status=${wrongMethod.status}`)
} finally {
  service.dispose()
  await new Promise((resolve) => server.close(resolve))
}

console.log(`\n[smoke] ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exitCode = failures === 0 ? 0 : 1
