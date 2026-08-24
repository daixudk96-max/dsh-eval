/**
 * Evolution-audit JSONL ledger reader (node:fs).
 *
 * Original work for the dsh-eval project (Apache-2.0). Reads the audit
 * ledger (one JSON object per line) appended by fs-store.appendLedger; the
 * Host service polls it to detect evolution activity and re-render the board.
 */

import { readFile } from 'node:fs/promises'
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
