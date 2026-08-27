/**
 * Host loader entry for the dsh-eval-console plugin.
 *
 * Original work for the dsh-eval project (Apache-2.0). The Host half owns the
 * live /eval channel: it loads the real preset-registry Registry (CJS,
 * zero-dep, required via createRequire — never value-imported) and the
 * evolution-audit JSONL ledger, serves GET /eval/state / POST /eval/action /
 * GET /eval/events SSE over the webServer service, and polls the ledger to
 * push SSE frames when evolution activity lands. The browser is a same-origin
 * asynchronous view over that channel.
 *
 * Mount pattern: ctx.effect() owns the route disposers + service lifecycle so
 * stop/update/undefine tears everything down. The whole registration is
 * wrapped in mountOnce so a double load (standalone + aggregate) registers
 * only once — duplicate (kind,path) routes would otherwise throw.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { RegistryLike, SessionPersistenceLike } from './host-service.ts'
import { EvalConsoleHostService } from './host-service.ts'
import { makeEvalRoutes } from './host-routes.ts'

const require = createRequire(import.meta.url)
const presetRegistryModule = require('../../preset-registry/lib/registry.js') as {
  Registry: new (options: { root: string; rollbackWindow?: number; agentPresets?: unknown }) => RegistryLike
}

/** Minimal structural slice of the DSH Host Context this plugin consumes. */
export interface HostContext {
  webServer: {
    register(route: WebRoute): () => void
  }
  /** Optional service lookup (the sessionPersistence service is optional). */
  get<T = unknown>(name: string): T | undefined
  effect(fn: () => (() => void) | void, name?: string): void
}

/**
 * Plugin config. No schemastery schema is exported — the loader passes the
 * cordis row's config as-is and defaults are applied here (deviation from the
 * dsh-task-board pattern, which validates via a same-named schema; our
 * dependency footprint stays zero for the Host half).
 */
export interface Config {
  /** Master switch. Default true. */
  enabled?: boolean
  /** The registry logical model id. Default 'evaluate'. */
  logicalId?: string
  /** preset-registry root. Default $DSH_HOME/preset-registry (or ~/.dsh). */
  registryRoot?: string
  /** Absolute audit ledger path. Default $DSH_HOME/evolution-audit/ledger.jsonl. */
  auditFile?: string
  /** Timeline tail cap. Default 120. */
  tailLimit?: number
  /** Audit poll interval ms. Default 5000. */
  pollMs?: number
  /** Agent-presets install root for switch-revision syncs. Default $DSH_HOME/.agent-presets. */
  agentPresetsRoot?: string
}

export const inject = ['webServer']

/** Guard against double registration (standalone + aggregate coexistence). */
const MOUNTED = new Set<string>()
function mountOnce(
  name: string,
  impl: (ctx: HostContext, config?: Config) => void,
): (ctx: HostContext, config?: Config) => void {
  return (ctx, config) => {
    if (MOUNTED.has(name)) return
    MOUNTED.add(name)
    impl(ctx, config)
  }
}

function resolveHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}

/**
 * Resolve the audit ledger path. The real evolution-controller writes a
 * single evolution-audit/ledger.jsonl (the original spec mentioned a nested
 * ledger/ subdirectory); prefer the real layout, fall back to the nested one.
 */
function resolveAuditFile(home: string, explicit?: string): string {
  if (explicit !== undefined) return explicit
  const single = path.join(home, 'evolution-audit', 'ledger.jsonl')
  const nested = path.join(home, 'evolution-audit', 'ledger', 'ledger.jsonl')
  return existsSync(single) || !existsSync(nested) ? single : nested
}

/** Apply defaults and build the service + routes inside one ctx.effect. */
export const apply = mountOnce('dsh-eval-console', (ctx: HostContext, config?: Config): void => {
  const enabled = config?.enabled ?? true
  if (!enabled) return

  const home = resolveHome()
  const registryRoot = config?.registryRoot ?? path.join(home, 'preset-registry')
  const logicalId = config?.logicalId ?? 'evaluate'
  const auditFile = resolveAuditFile(home, config?.auditFile)
  const tailLimit = config?.tailLimit ?? 120
  const pollMs = config?.pollMs ?? 5000

  const registry: RegistryLike = new presetRegistryModule.Registry({ root: registryRoot })
  // Optional: the DSH sessionPersistence service tells us which preset a
  // stored session runs with (the session-port store exposes no agentPreset).
  // Absent (host composition without it) → the version selector hides.
  const sessionPersistence = ctx.get<SessionPersistenceLike>('sessionPersistence')
  const service = new EvalConsoleHostService({
    registry,
    registryRoot,
    logicalId,
    auditFile,
    agentPresetsRoot: config?.agentPresetsRoot ?? path.join(home, '.agent-presets'),
    ...(sessionPersistence === undefined ? {} : { sessionPersistence }),
    tailLimit,
    pollMs,
  })
  service.start()

  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      for (const route of makeEvalRoutes(service)) disposers.push(ctx.webServer.register(route))
    } catch (error) {
      for (const dispose of disposers) dispose()
      service.dispose()
      throw error
    }
    return () => {
      for (const dispose of disposers) dispose()
      service.dispose()
    }
  }, 'dsh-eval-console: /eval state/action/events routes')
})

export type { IncomingMessage, ServerResponse, WebRoute }
export type { EvalConsoleHostService, RegistryLike }
