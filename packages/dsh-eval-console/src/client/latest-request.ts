/**
 * Latest-request controller: a tiny pure helper for "only the most recent
 * request may land" semantics, shared by the session-preset hook, the board
 * tab's state poller and the version dropdown's refresh.
 *
 * Original work for the dsh-eval project (Apache-2.0). Two cross-cutting
 * races motivated this (review F2/F3):
 *   - useSessionPreset: an old sessionId's sessionPreset() resolving after a
 *     newer one would overwrite the newer preset with the older session's;
 *   - useEvalState / VersionSelect.refresh: an old logical's state() resolving
 *     after a newer logical's would overwrite the newer snapshot.
 *
 * A `scope` is created per request (per effect run); the holder keeps the
 * current scope. `isStale(scope)` tells the async continuation whether its
 * request is still the latest — an old request that resolves late returns
 * stale and must not touch state. No cancellation API is needed beyond the
 * scope token, and no DOM/React dependency means it is unit-testable without
 * a renderer.
 */

/** One in-flight request generation. */
export interface LatestRequestScope {
  /** Monotonic marker; strictly increasing per begin(). */
  readonly id: number
}

/** Holder for the current scope; `begin()` invalidates the previous one. */
export class LatestRequestController {
  private current: LatestRequestScope | null = null
  private counter = 0

  /** Start a new request generation; the previous one becomes stale. */
  begin(): LatestRequestScope {
    this.counter += 1
    const scope: LatestRequestScope = { id: this.counter }
    this.current = scope
    return scope
  }

  /** True when `scope` is still the most recent begin(). */
  isStale(scope: LatestRequestScope): boolean {
    return this.current === null || scope.id !== this.current.id
  }

  /** Invalidate without starting a new generation (e.g. cleanup on unmount). */
  invalidate(): void {
    this.current = null
  }

  /** The monotonic counter (tests / debugging). */
  count(): number {
    return this.counter
  }
}

/** Convenience: create a scope for the request and retrieve it in the same call. */
export function scopeOf(controller: LatestRequestController): LatestRequestScope {
  return controller.begin()
}
