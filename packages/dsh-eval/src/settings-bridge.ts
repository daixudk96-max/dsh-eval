/**
 * Provider/settings bridge for dsh-eval: turn the selected provider into a
 * minimal child `settings.yaml` subtree, plus the credential ref it needs.
 *
 * Consumes only rc.8 public services: `llm.listProviders()` / `listConfigurableProviders()`
 * and `settings.describe({redactSecrets:true})`. The selected provider must be
 * BOTH live (`listProviders`) AND configurable (`listConfigurableProviders` with
 * settingsNs/settingsPath). Configurable-but-not-live, external bundles, and
 * non-directory routes fail closed with a readable message; the escape hatch is
 * an explicit wrapper command, never writing `benchmark.profile` to auto-install
 * an external bundle in an empty child home.
 *
 * @module dsh-eval/settings-bridge
 */

import type { ModelSelection } from './model.ts'

/** A route entry from `llm.listConfigurableProviders()`. */
export interface ConfigurableProvider {
  provider: string
  settingsNs: string
  settingsPath: readonly string[]
}

/** A provider entry returned by `llm.listProviders()`: an id-object or plain id. */
export type ProviderIdish = string | { id: string }

/** Normalize a provider-info object or id string to its id. */
export function providerIdOf(entry: ProviderIdish): string {
  return typeof entry === 'string' ? entry : entry.id
}

/** Narrow contract of the rc.8 `llm` public service (read-only). */
interface LlmRuntime {
  listProviders(): readonly ProviderIdish[]
  listConfigurableProviders(): readonly ConfigurableProvider[]
}

/** One descriptor from `settings.describe({redactSecrets:true})`. */
interface SettingsDescriptorish {
  /** The registered namespace. */
  ns: string
  /** Current resolved value (defaults + base + user layer). */
  value: unknown
  /** Raw user section from the stored document, when user-overridden. */
  user?: unknown
}

/**
 * Narrow contract of settings.describe({redactSecrets:true}). rc.8 returns an
 * ARRAY of descriptors (SettingsDescriptor[]), NOT a record keyed by namespace.
 */
interface SettingsProvider {
  describe(options: { redactSecrets: boolean }): readonly SettingsDescriptorish[]
}

/** The resolved settings subtree for one provider. */
export interface ProviderSettingsSubtree {
  settingsNs: string
  /** settingsPath under the namespace, e.g. [] or ['providers', <route>]. */
  settingsPath: readonly string[]
  /** Detached subtree value read from settings.describe. */
  value: unknown
  /** True when the subtree is redactable/plain (no raw headers, no secrets). */
  bridgeable: boolean
  /** When !bridgeable, a readable failure hint. */
  reason?: string
}

/** The child settings document (plain object written to settings.yaml). */
export interface ChildSettings {
  [key: string]: unknown
  'agent-default-model'?: { provider: string; model: string; reasoningEffort?: string }
}

/**
 * Locate the selected provider's configurable entry. Fails readably when the
 * route is not live, not configurable, or external.
 * @param selection - the effective provider.
 * @param llm - the llm public service.
 * @returns the configurable route entry.
 */
export function findConfigurable(
  selection: Pick<ModelSelection, 'provider'>,
  llm: LlmRuntime,
): ConfigurableProvider {
  const live = llm.listProviders()
  const liveIds = live.map(providerIdOf)
  if (!liveIds.includes(selection.provider)) {
    throw new Error(
      `eval: provider "${selection.provider}" is not a live route (llm.listProviders). `
      + 'Configure it, or use an explicit wrapper command that manages its own child profile/DSH_HOME/credential policy.',
    )
  }
  const configurable = llm.listConfigurableProviders().find(item => item.provider === selection.provider)
  if (configurable === undefined) {
    throw new Error(
      `eval: provider "${selection.provider}" is live but not configurable with settingsNs/settingsPath. `
      + 'External provider bundles are not auto-bridged; use an explicit wrapper command.',
    )
  }
  return configurable
}

/**
 * Extract the selected provider's settings subtree and decide whether it is
 * bridgeable (no non-empty raw `headers`, no redacted required field).
 * @param configurable - the resolved configurable route.
 * @param selection - the effective provider.
 * @param settings - the settings public service.
 * @returns the subtree verdict.
 */
export function extractProviderSubtree(
  configurable: ConfigurableProvider,
  selection: Pick<ModelSelection, 'provider'>,
  settings: SettingsProvider,
): ProviderSettingsSubtree {
  const described = settings.describe({ redactSecrets: true })
  const descriptor = described.find(d => d.ns === configurable.settingsNs)
  if (descriptor === undefined) {
    return {
      settingsNs: configurable.settingsNs,
      settingsPath: configurable.settingsPath,
      value: undefined,
      bridgeable: false,
      reason: `eval: no settings namespace "${configurable.settingsNs}" is registered for provider "${selection.provider}"`,
    }
  }
  // Walk the provider subtree through the user-override layer (reflects the
  // parent's stored llm-deepseek.baseURL / credential ref), else the resolved
  // value (defaults + base). settingsPath is [] for llm-deepseek.
  let node: unknown = descriptor.user ?? descriptor.value
  for (const key of configurable.settingsPath) {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      node = (node as Record<string, unknown>)[key]
    } else {
      return {
        settingsNs: configurable.settingsNs,
        settingsPath: configurable.settingsPath,
        value: undefined,
        bridgeable: false,
        reason: `eval: settings subtree for "${selection.provider}" at ${configurable.settingsNs}/${configurable.settingsPath.join('/')} is empty`,
      }
    }
  }
  // Fail closed on non-empty raw headers (may carry sensitive material).
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    const headers = (node as Record<string, unknown>).headers
    if (headers !== null && headers !== undefined && typeof headers === 'object' && Object.keys(headers as object).length > 0) {
      return {
        settingsNs: configurable.settingsNs,
        settingsPath: configurable.settingsPath,
        value: node,
        bridgeable: false,
        reason: `eval: provider "${selection.provider}" settings subtree contains non-empty raw headers; refusing to copy. Use an explicit wrapper command managing the child profile/DSH_HOME/credential policy.`,
      }
    }
  }
  return {
    settingsNs: configurable.settingsNs,
    settingsPath: configurable.settingsPath,
    value: node,
    bridgeable: true,
  }
}

/**
 * Build the minimal child settings object: `agent-default-model` plus the single
 * selected provider's subtree under its namespace/path.
 * @param selection - the effective provider/model.
 * @param subtree - the provider subtree (must be bridgeable).
 * @returns the child settings object to persist as settings.yaml.
 */
export function buildChildSettings(
  selection: ModelSelection,
  subtree: ProviderSettingsSubtree,
): ChildSettings {
  const child: ChildSettings = {
    'agent-default-model': {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
    },
  }
  if (subtree.bridgeable) {
    let target = child
    let lastKey: string = subtree.settingsNs
    const path = subtree.settingsPath
    for (const key of path) {
      const holder: Record<string, unknown> = {}
      target[lastKey] = holder
      target = holder as ChildSettings
      lastKey = key
    }
    target[lastKey] = subtree.value
  }
  return child
}
