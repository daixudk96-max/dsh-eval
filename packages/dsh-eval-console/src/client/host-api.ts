/**
 * Evolution-console Host transport: relative /eval fetch + EventSource.
 *
 * # absorbed-from: zhu1090093659/dsh-web-ui packages/dsh-task-board/src/client/host-api.ts (Apache-2.0)
 * Adapted: task-board state/action/subscribe kept; the /api/task-board prefix
 * is replaced by EVAL_API_PREFIX ('/eval'), the requestId-envelope post and
 * the 15s AbortController timeout are kept, and the task-board-specific
 * import-bootstrap/localStorage marker logic is dropped.
 */

import {
  EVAL_API_PREFIX,
  type EvalAction,
  type EvalActionEnvelope,
  type EvalActionResult,
  type EvalEventPayload,
  type EvalSnapshot,
} from '../domain/protocol.ts'

const REQUEST_TIMEOUT_MS = 15_000

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `eval-console request failed: ${response.status}`)
  return body
}

export interface EvalHostTransport {
  /** Fetch the snapshot; pass the logical preset to scope it (default: configured). */
  state(logical?: string): Promise<EvalSnapshot>
  /** Resolve the preset a stored session runs with (null = none/unreadable). */
  sessionPreset(sessionId: string): Promise<{ presetId: string | null }>
  action(action: EvalAction): Promise<EvalActionResult>
  subscribe(listener: (event?: EvalEventPayload) => void): () => void
}

/** HTTP transport over the /eval channel (same-origin desktop GUI). */
export class HttpEvalHostTransport implements EvalHostTransport {
  async state(logical?: string): Promise<EvalSnapshot> {
    const query = logical !== undefined ? `?logical=${encodeURIComponent(logical)}` : ''
    return await this.request<EvalSnapshot>(`${EVAL_API_PREFIX}/state${query}`, { cache: 'no-store' })
  }

  async sessionPreset(sessionId: string): Promise<{ presetId: string | null }> {
    return await this.request<{ ok: boolean; presetId: string | null }>(
      `${EVAL_API_PREFIX}/session-preset?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: 'no-store' },
    )
  }

  async action(action: EvalAction): Promise<EvalActionResult> {
    const envelope: EvalActionEnvelope = { requestId: uuid(), action }
    return await this.request<EvalActionResult>(`${EVAL_API_PREFIX}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    try {
      return await readJson<T>(await fetch(url, { ...init, signal: controller.signal }))
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`eval-console Host request timed out after ${REQUEST_TIMEOUT_MS / 1_000}s`)
      throw error
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }

  subscribe(listener: (event?: EvalEventPayload) => void): () => void {
    const events = new EventSource(`${EVAL_API_PREFIX}/events`)
    events.onmessage = (message: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(message.data) as EvalEventPayload
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.revision !== 'number') throw new Error('invalid event frame')
        listener(parsed)
      } catch {
        listener()
      }
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') listener()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      events.close()
    }
  }
}
