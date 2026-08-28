/**
 * Shared session->preset resolver hook for the evolution console.
 *
 * Original work for the dsh-eval project (Apache-2.0). Both the session
 * header version dropdown (VersionSelect) and the board tab
 * (EvalConsoleView) bind to the *current session's* preset: the preset is
 * resolved Host-side via sessionPersistence.inspect (the client session
 * store exposes no agentPreset field) through GET /eval/session-preset.
 *
 * Semantics (shared by both consumers — a drift here would make the header
 * control and the board tab disagree):
 *   - undefined  => resolving (or the session id presence is unknown yet);
 *   - string     => the preset id the session runs with;
 *   - null       => the session records no preset, the session is unreadable,
 *                   or the Host lacks sessionPersistence — the caller treats
 *                   null as "no preset" and renders its empty state.
 *
 * The sessionId is passed through verbatim (DSH session header ids carry the
 * 'session-' prefix and sessionPersistence.inspect keys on that exact id).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EvalHostTransport } from './host-api.ts'
import type { EvalSnapshot } from '../domain/protocol.ts'
import { LatestRequestController } from './latest-request.ts'

export interface UseSessionPresetResult {
  /** undefined = resolving; string = preset id; null = no preset/unreadable. */
  preset: string | null | undefined
  /** Re-run the resolution (used by the error/retry path). */
  reload: () => void
}

/** The board tab's scoped view phase (pure, unit-testable). */
export type EvalViewPhase = 'loading' | 'no-preset' | 'no-chain' | 'ready' | 'error'

/**
 * Derive the scoped view phase from the raw resolution + snapshot facts:
 *   - loading   — preset still resolving;
 *   - no-preset — session records no preset (meta nor selection events);
 *   - no-chain  — preset has an id but the registry holds no chain
 *                 (current null + history empty);
 *   - ready     — a scoped chain snapshot is available;
 *   - error     — a fetch/parse failure (retry disponible).
 */
export function evalViewPhaseOf(
  preset: string | null | undefined,
  snapshot: EvalSnapshot | null,
  error: string | null,
): EvalViewPhase {
  if (preset === undefined) return 'loading'
  if (preset === null) return 'no-preset'
  if (error !== null) return 'error'
  if (snapshot === null) return 'loading'
  if (snapshot.current === null && snapshot.history.length === 0) return 'no-chain'
  return 'ready'
}

export function useSessionPreset(
  transport: EvalHostTransport,
  sessionId: string,
): UseSessionPresetResult {
  const [preset, setPreset] = useState<string | null | undefined>(undefined)
  const [nonce, setNonce] = useState(0)
  // Latest-request guard: the per-effect scope token invalidates any in-flight
  // sessionPreset() from an earlier sessionId — a late old request must never
  // overwrite the new session's preset.
  const controller = useMemo(() => new LatestRequestController(), [])

  useEffect(() => {
    setPreset(undefined)
    const scope = controller.begin()
    transport
      .sessionPreset(sessionId)
      .then((result) => {
        if (!controller.isStale(scope)) setPreset(result.presetId)
      })
      .catch(() => {
        // Unreadable session (or Host without sessionPersistence): no preset.
        if (!controller.isStale(scope)) setPreset(null)
      })
    return () => {
      controller.invalidate()
    }
  }, [transport, sessionId, nonce, controller])

  const reload = useCallback(() => {
    setPreset(undefined)
    setNonce((value) => value + 1)
  }, [])

  return { preset, reload }
}
