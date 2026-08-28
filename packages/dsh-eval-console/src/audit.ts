/**
 * Evolution-audit JSONL ledger reader (node:fs).
 *
 * Original work for the dsh-eval project (Apache-2.0). Reads the audit
 * ledger (one JSON object per line) appended by fs-store.appendLedger; the
 * Host service polls it to detect evolution activity and re-render the board.
 */

import { appendFile, readFile } from 'node:fs/promises'
import type { AuditEntry } from './domain/adapter.ts'

/** Parse one ledger line; null when the line is blank or not JSON. */
export function parseAuditLine(line: string): AuditEntry | null {
  const text = line.trim()
  if (text === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as AuditEntry)
      : null
  } catch {
    return null
  }
}

/**
 * Read and parse the whole ledger file. A torn trailing write (last line not
 * fully flushed) is tolerated: parseAuditLine drops unparseable lines, so the
 * ledger never throws on a mid-write read. Returns [] when the file is
 * missing (ledger not created yet).
 */
export async function readAuditEntries(file: string): Promise<AuditEntry[]> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  const entries: AuditEntry[] = []
  for (const line of text.split('\n')) {
    const entry = parseAuditLine(line)
    if (entry !== undefined && entry !== null) entries.push(entry)
  }
  return entries
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

/** The revision counter: number of audit records the ledger currently holds. */
export function auditRevisionCounter(entries: readonly AuditEntry[]): number {
  return entries.length
}

/** The last `n` entries of the ledger (newest first for display). */
export function auditTail(entries: readonly AuditEntry[], n: number): AuditEntry[] {
  return entries.slice(Math.max(0, entries.length - n)).reverse()
}

/** New entries appended since a previously observed index (empty when none). */
export function deltaAuditEntries(entries: readonly AuditEntry[], fromIndex: number): AuditEntry[] {
  return fromIndex >= entries.length ? [] : entries.slice(fromIndex)
}

/** A revision-id (or rollback target) prefix for one logical preset. */
function revisionPrefix(logicalId: string): string {
  return `${logicalId}-`
}

/**
 * Scope a full evolution-audit ledger to one logical preset, so the board
 * (buildRows) and timeline never show another preset's candidates.
 *
 * Rules (two passes, order preserved, never sorted):
 *   1. ownership collection:
 *      - explicit `entry.logicalId === logicalId` → owned;
 *      - `entry.revisionId` / `entry.targetRevisionId` starts with
 *        `<logicalId>-` → owned (by prefix, kept by index), and its `runId` is
 *        remembered (old records carry no logicalId; the sealed/promoted
 *        revision prefix bridges the run back to this preset);
 *   2. keep every entry that is explicitly owned (logicalId or prefix), plus
 *      every entry of an owned run. A record with an explicit `logicalId`
 *      belonging to *another* preset is excluded even when its runId collides
 *      with an owned run (the runId is global, but ownership is per-record).
 *      Any entry that cannot be attributed is dropped — better to
 *      under-display than to leak.
 *
 * Contract: the output is a subsequence of the input (same order, no
 * re-sorting), so timeline ids and revision-fact keys stay stable.
 */
export function scopeAuditEntries(audit: readonly AuditEntry[], logicalId: string): AuditEntry[] {
  const prefix = revisionPrefix(logicalId)
  const ownedRuns = new Set<string>()
  const ownedByPrefix = new Set<number>()
  for (let i = 0; i < audit.length; i += 1) {
    const entry = audit[i]
    if (entry === undefined) continue
    if (entry.logicalId === logicalId) {
      if (typeof entry.runId === 'string') ownedRuns.add(entry.runId)
      continue
    }
    if (
      (typeof entry.revisionId === 'string' && entry.revisionId.startsWith(prefix)) ||
      (typeof entry.targetRevisionId === 'string' && entry.targetRevisionId.startsWith(prefix))
    ) {
      ownedByPrefix.add(i)
      if (typeof entry.runId === 'string') ownedRuns.add(entry.runId)
    }
  }
  return audit.filter((entry, index) => {
    if (entry.logicalId === logicalId) return true
    if (ownedByPrefix.has(index)) return true
    // A record explicitly marked for another logical never belongs here, even
    // when its runId happens to match an owned run.
    if (entry.logicalId !== undefined && entry.logicalId !== logicalId) return false
    return typeof entry.runId === 'string' && ownedRuns.has(entry.runId)
  })
}

/**
 * Append one ledger line (JSON + '\n') with a single atomic appendFile write
 * (safe against concurrent appenders, same mode as evolution-controller's
 * fs-store.appendLedger). Auditing is best-effort by design: a failure is
 * logged and swallowed so a ledger problem never blocks the sync that
 * already succeeded.
 * @param file - absolute ledger path.
 * @param entry - the record to append.
 * @returns the JSON text that was appended (for tests).
 */
export async function appendAuditLine(file: string, entry: AuditEntry): Promise<string> {
  const line = JSON.stringify(entry) + '\n'
  try {
    await appendFile(file, line, 'utf8')
    return line
  } catch (error) {
    console.error(`[dsh-eval-console] audit append failed: ${file}`, error)
    return line
  }
}
