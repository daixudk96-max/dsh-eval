/**
 * Registry revision-id ↔ logical-id helpers, shared by the Host service and
 * the /eval route layer.
 *
 * Original work for the dsh-eval project (Apache-2.0). Registry revision ids
 * have the fixed shape `<logicalId>-<digest8>` (e.g. `evaluate-0c3922a0`),
 * and the logical id itself may contain dashes (`system-evolver-5fac7f0b`),
 * so only the final `-[0-9a-f]{8}` segment is stripped. Synced agent-presets
 * directories use the same `<logicalId>-<digest8>` id, so the same function
 * maps a session-recorded versioned preset id back to its registry chain.
 */

/** Strips the final `-<hex8>` segment; null when the id has no such tail. */
export function logicalIdFromRevisionId(revisionId: string): string | null {
  const m = /^(.+)-[0-9a-f]{8}$/.exec(revisionId)
  if (m === null) return null
  const base = m[1]
  return base === undefined || base === '' ? null : base
}

/**
 * Map a versioned preset dir id (`<logicalId>-<digest8>`, e.g.
 * `evaluate-0c3922a0`) back to the registry logical id (`evaluate`).
 * Sessions record the synced directory id as their preset, but the registry
 * chain lives under the bare logical id; without this mapping the version
 * dropdown would find no chain for any versioned preset and render nothing.
 *
 * Same shape rule as {@link logicalIdFromRevisionId} — kept as an alias so the
 * route layer reads intent ("this id is a directory/preset id") without
 * duplicating the regex.
 */
export function baseLogicalId(id: string): string | null {
  return logicalIdFromRevisionId(id)
}
