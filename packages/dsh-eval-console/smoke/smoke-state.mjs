/**
 * Real-data smoke: assemble a live EvalSnapshot from the actual preset-registry
 * and evolution-audit ledger, print a JSON excerpt, and assert the shape.
 *
 * READ-ONLY: only resolveCurrent/history (registry reads), the pointer file
 * read, and the audit ledger read — NO mutation of the real registry.
 *
 * Usage: node smoke/smoke-state.mjs
 * (cwd = packages/dsh-eval-console so the relative preset-registry require
 * resolves; configurable via DSH_HOME / --registry-root / --audit-file).
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
const { Registry } = require('../../preset-registry/lib/registry.js')

const args = process.argv.slice(2)
function argValue(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback
}

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const registryRoot = argValue('--registry-root', path.join(home, 'preset-registry'))
const logicalId = argValue('--logical-id', 'evaluate')
const auditFile = argValue('--audit-file', path.join(home, 'evolution-audit', 'ledger.jsonl'))
const nestedAudit = path.join(home, 'evolution-audit', 'ledger', 'ledger.jsonl')
const auditPath = existsSync(auditFile) || !existsSync(nestedAudit) ? auditFile : nestedAudit

console.log('[smoke] registryRoot:', registryRoot)
console.log('[smoke] auditFile:   ', auditPath)

const registry = new Registry({ root: registryRoot })
const { EvalConsoleHostService } = await import('../src/host-service.ts')

const service = new EvalConsoleHostService({
  registry,
  registryRoot,
  logicalId,
  auditFile: auditPath,
  tailLimit: 120,
})
const snapshot = await service.snapshot()
service.dispose()

// Shape assertions.
if (snapshot.schemaVersion !== 1) throw new Error(`bad schemaVersion ${snapshot.schemaVersion}`)
if (snapshot.logicalId !== logicalId) throw new Error(`bad logicalId ${snapshot.logicalId}`)
if (snapshot.columns.length !== 6) throw new Error(`expected 6 columns, got ${snapshot.columns.length}`)
if (typeof snapshot.revision !== 'number' || snapshot.revision < 0) throw new Error('bad revision counter')

const excerpt = {
  schemaVersion: snapshot.schemaVersion,
  logicalId: snapshot.logicalId,
  revision: snapshot.revision,
  generatedAt: snapshot.generatedAt,
  current: snapshot.current,
  history: snapshot.history,
  columns: snapshot.columns.map((column) => ({
    status: column.status,
    label: column.label,
    count: column.rows.length,
    rows: column.rows.map((row) => ({
      revisionId: row.revisionId,
      digestShort: row.digestShort,
      status: row.status,
      isCurrent: row.isCurrent,
      runId: row.runId ?? null,
      sealedAt: row.sealedAt ?? null,
      gateReason: row.gateReason ?? null,
    })),
  })),
  timelineCount: snapshot.timeline.length,
  timelineTail: snapshot.timeline.slice(-3),
}

console.log('\n[smoke] snapshot excerpt:\n' + JSON.stringify(excerpt, null, 2))
console.log(`\n[smoke] OK: ${snapshot.columns.reduce((n, c) => n + c.rows.length, 0)} revision rows across 6 columns, ${snapshot.timeline.length} timeline events`)
