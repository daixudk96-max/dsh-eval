/**
 * /eval WebRoute family: GET /eval/state, POST /eval/action, GET /eval/events.
 *
 * # absorbed-from: zhu1090093659/dsh-web-ui packages/dsh-task-board/src/host-routes.ts (Apache-2.0)
 * Adapted for the evolution console:
 *   - prefix /api/task-board -> /eval (EVAL_API_PREFIX);
 *   - handlers are async (snapshot() live-reads the real registry/audit);
 *   - the authenticated reverse-proxy layer (trustedProxyHosts / proxy token)
 *     is dropped — this console serves the desktop GUI over loopback only;
 *   - the route fence keeps the browser same-origin marker tripwire plus the
 *     loopback socket check; the 415/413/400/405 status ladder and the
 *     `data:` SSE frame + 15s `: ping` heartbeat are kept.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { EvalConsoleHostService } from './host-service.ts'
import { writeJson } from './http.ts'
import { parseActionEnvelope, EVAL_API_PREFIX } from './domain/protocol.ts'

const ACTION_LIMIT = 64 * 1024
const HEARTBEAT_MS = 15_000

/**
 * Logical preset ids fed back into registry path lookups — keep them safe:
 * registry._safeFileId escapes %,: but a `..` or a path separator in the id
 * would still escape the logical/ or pointers/ directory. Preset ids are
 * constrained to the same shape DSH allows (`[a-z0-9][a-z0-9-]*`).
 */
const LOGICAL_ID_RE = /^[a-z0-9][a-z0-9-]*$/

/** Loopback socket addresses (IPv4, IPv6, IPv4-mapped IPv6). */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Browser-signal tripwire, NOT an authority check: a bare curl sends neither
 * header and is refused, but a curl with a forged Origin passes this too.
 * The real boundary is the loopback socket check in isTrustedEvalRequest.
 */
function browserSameOriginMarker(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  return site === 'same-origin' || typeof req.headers.origin === 'string'
}

/**
 * /eval route fence: a browser same-origin marker AND a loopback socket are
 * required. The evolution console is a desktop GUI control surface — it must
 * never be reachable from the public network or from a bare local curl.
 */
export function isTrustedEvalRequest(req: IncomingMessage): boolean {
  if (!browserSameOriginMarker(req)) return false
  return LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')
}

/** Build the three /eval routes bound to one Host service. */
export function makeEvalRoutes(service: EvalConsoleHostService): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isTrustedEvalRequest(req)) return true
    writeJson(res, 403, { ok: false, error: 'forbidden' }, { 'cache-control': 'no-store' })
    return false
  }

  const state: WebRoute = {
    kind: 'exact',
    path: `${EVAL_API_PREFIX}/state`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'GET') {
        return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      }
      if (!guard(req, res)) return
      // Optional ?logical=<presetId>: the UI asks for the current session's
      // preset; without the parameter the configured logicalId is served.
      const logical = new URL(req.url ?? '/', 'http://localhost').searchParams.get('logical')
      if (logical !== null && !LOGICAL_ID_RE.test(logical)) {
        return writeJson(res, 400, { ok: false, error: 'invalid-logical' }, { 'cache-control': 'no-store' })
      }
      writeJson(res, 200, await service.snapshot(logical ?? undefined), { 'cache-control': 'no-store' })
    },
  }

  const action: WebRoute = {
    kind: 'exact',
    path: `${EVAL_API_PREFIX}/action`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'POST') {
        return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      }
      if (!guard(req, res)) return
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return writeJson(res, 415, { ok: false, error: 'json-required' }, { 'cache-control': 'no-store' })
      }
      const { readJsonBody } = await import('./http.ts')
      const body = await readJsonBody(req, { maxBytes: ACTION_LIMIT, objectOnly: true })
      if (body === null) {
        return writeJson(res, 413, { ok: false, error: 'body-too-large' }, { 'cache-control': 'no-store' })
      }
      const parsed = parseActionEnvelope(body)
      if (parsed === undefined) {
        return writeJson(res, 400, { ok: false, error: 'invalid-action' }, { 'cache-control': 'no-store' })
      }
      try {
        const result = await service.apply(parsed.requestId, parsed.action)
        writeJson(res, 200, result, { 'cache-control': 'no-store' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(res, 400, { ok: false, error: message }, { 'cache-control': 'no-store' })
      }
    },
  }

  const events: WebRoute = {
    kind: 'exact',
    path: `${EVAL_API_PREFIX}/events`,
    handler: (req, res): void => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      if (!guard(req, res)) return
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const push = (): void => {
        void service
          .eventPayload()
          .then((payload) => {
            res.write(`data: ${JSON.stringify(payload)}\n\n`)
          })
          .catch(() => undefined)
      }
      const unsubscribe = service.subscribe(push)
      const heartbeat = setInterval(() => {
        res.write(': ping\n\n')
      }, HEARTBEAT_MS)
      const close = (): void => {
        clearInterval(heartbeat)
        unsubscribe()
      }
      req.once('close', close)
      res.once('close', close)
      push()
    },
  }

  return [state, action, events]
}
