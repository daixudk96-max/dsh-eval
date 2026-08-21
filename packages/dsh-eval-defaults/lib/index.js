/**
 * dsh-eval-defaults host plugin: a persistent `eval-defaults` settings
 * namespace plus the `evalDefaults` Typert Remote service (settings page
 * reads/writes). The saved defaults are consumed by dsh-eval evaluations:
 * a benchmark omitting provider/reasoningEffort inherits these values.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { TYPERT_MANIFEST } from './contract.js'

/** Cordis plugin name (the Loader entry and client bundle id). */
export const name = 'dsh-eval-defaults'

/** Services required before load: the Typert registry. */
export const inject = ['typert']

/** Settings namespace owning the persistent eval defaults. */
export const NS = 'eval-defaults'

const NS_SCHEMA = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

const norm = (v) => (typeof v === 'string' ? v.trim() : '')

// In-memory copy of the eval defaults. The settings namespace read is
// unreliable at request time in this deployment, so saves write BOTH the
// settings document AND this state; reads prefer the settings document.
let state = { provider: '', model: '', reasoningEffort: '' }

function hydrateState(st) {
  const d = readDefaults(st)
  if (d.provider || d.model || d.reasoningEffort) state = d
  return state
}

// The settings service may not be resolvable at apply time (composition
// ordering) — it only becomes available later, when the settings-file row has
// applied. The lazy guard therefore NEVER burns its one-shot flag on a
// transient undefined: it retries on every read/write until it can register.
let ensured = false
let ensureError = null

function ensureNs(st) {
  if (ensured) return ensureError
  if (st === undefined) return null // 服务尚未就绪，下次调用再试（不烧标志）
  try {
    st.register(NS, NS_SCHEMA, { base: { provider: '', model: '', reasoningEffort: '' } })
    ensured = true
    ensureError = null
  } catch (e) {
    // A duplicate registration means the namespace already exists and writes
    // work — treat that as success.
    if (String((e && e.message) || e).indexOf('already registered') >= 0) {
      ensured = true
      ensureError = null
    } else {
      ensureError = 'settings namespace 注册失败: ' + String((e && e.message) || e)
    }
  }
  return ensureError
}

function readDefaults(st) {
  const empty = { provider: '', model: '', reasoningEffort: '' }
  if (st === undefined) return empty
  try {
    const d = st.get(NS)
    if (d && typeof d === 'object') {
      return { provider: norm(d.provider), model: norm(d.model), reasoningEffort: norm(d.reasoningEffort) }
    }
  } catch (e) { /* keep empty */ }
  return empty
}

/** The evalDefaults Remote service. */
class EvalDefaultsRuntime extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'evalDefaults')
  }

  /** defaults + main selection + provider/model list, with diagnostics. */
  async getState() {
    const diag = []
    const st = this.ctx.get('settings')
    const nsErr = ensureNs(st)
    if (nsErr) diag.push(nsErr)
    const llm = this.ctx.get('llm')

    const defaults = readDefaults(st)

    let main = { provider: '', model: '', reasoningEffort: '' }
    const adm = this.ctx.get('agentDefaultModel')
    if (adm !== undefined) {
      try {
        const sel = adm.currentSelection()
        main = { provider: sel.provider, model: sel.model, reasoningEffort: sel.reasoningEffort || '' }
      } catch (e) { diag.push('main: ' + String((e && e.message) || e)) }
    }

    // Provider list: prefer LIVE registered routes + routes configured in
    // settings; only fall back to the full configurable directory (which
    // contains many dormant catalog providers) when both are empty.
    const ids = new Set()
    if (llm !== undefined) {
      try { llm.listProviders().forEach((p) => { if (p && p.id) ids.add(p.id) }) } catch (e) { diag.push('listProviders: ' + String((e && e.message) || e)) }
    }
    if (st !== undefined) {
      try {
        const sec = st.get('llm-pi-ai')
        if (sec && sec.providers && typeof sec.providers === 'object') Object.keys(sec.providers).forEach((k) => ids.add(k))
      } catch (e) { diag.push('settings: ' + String((e && e.message) || e)) }
    }
    if (ids.size === 0 && llm !== undefined) {
      try { llm.listConfigurableProviders().forEach((p) => { if (p && p.provider) ids.add(p.provider) }) } catch (e) { diag.push('listConfigurableProviders: ' + String((e && e.message) || e)) }
    }
    const providers = []
    for (const id of ids) {
      const models = []
      const seen = new Set()
      const push = (m) => {
        const mid = typeof m === 'string' ? m : (m && m.id)
        if (!mid || seen.has(mid)) return
        seen.add(mid)
        const mname = (typeof m === 'object' && m && typeof m.name === 'string' && m.name) ? m.name : mid
        models.push({ id: mid, name: mname })
      }
      if (llm !== undefined) {
        try { (await llm.listModels(id)).forEach(push) } catch (e) { diag.push(id + ': listModels ' + String((e && e.message) || e)) }
      }
      if (st !== undefined && models.length === 0) {
        try {
          const sec = st.get('llm-pi-ai')
          const prof = sec && sec.providers && sec.providers[id]
          if (prof && Array.isArray(prof.models)) prof.models.forEach(push)
        } catch (e) { diag.push(id + ': settingsModels ' + String((e && e.message) || e)) }
      }
      providers.push({ id, models })
    }
    providers.sort((a, b) => String(a.id).localeCompare(String(b.id)))

    return { ok: true, defaults, main, providers, diagnostics: diag }
  }

  /** Persist the eval defaults (empty string = inherit). */
  async setDefaults(patch) {
    const st = this.ctx.get('settings')
    if (st === undefined) return { ok: false, error: 'settings 服务不可用' }
    const nsErr = ensureNs(st)
    if (nsErr) return { ok: false, error: nsErr }
    const p = patch && typeof patch === 'object' ? patch : {}
    const next = { provider: norm(p.provider), model: norm(p.model), reasoningEffort: norm(p.reasoningEffort) }
    try {
      await st.replace(NS, next)
      state = next // keep state authoritative even if st.get(NS) fails
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
    return { ok: true, defaults: next }
  }
}

export function apply(ctx) {
  const st = ctx.get('settings')
  const nsErr = ensureNs(st)
  if (nsErr) ctx.logger.warn('dsh-eval-defaults: ' + nsErr)

  new EvalDefaultsRuntime(ctx)
  ctx.effect(() => ctx.typert.register(TYPERT_MANIFEST), 'dsh-eval-defaults: typert manifest')
}
