/**
 * Credential bridge for dsh-eval: resolve the selected provider's credential
 * ref once per run (from the fixed settings snapshot), then resolve the value
 * via the parent `credentials.resolve(ref)` before EVERY case x trial spawn —
 * never cached per run. The value is injected only into the child env; it is
 * never written to settings/overlay/run.json/session logs/temp files.
 *
 * The runner still inherits parent `process.env` (PATH/HOME/TEMP + ambient env)
 * to keep the child runnable; we only ADD the selected managed ref/value. This
 * is non-persistence, not "the child sees only one credential".
 *
 * @module dsh-eval/credential-bridge
 */

import type { ModelSelection } from './model.ts'

/** Narrow contract of the rc.8 `credentials` public service. */
interface CredentialsProvider {
  /** Resolve one credential reference to its value (per operation). */
  resolve(ref: string): Promise<string | undefined>
}

/** The credential plan for one run (ref fixed per run). */
export interface CredentialPlan {
  /** The managed credential ref, or undefined when none is named. */
  ref: string | undefined
}

/**
 * Discover a candidate apiKeyEnv from a provider subtree/config. DeepSeek
 * default is `DEEPSEEK_API_KEY`; pi-ai routes may name their own.
 * @param provider - the effective provider.
 * @param providerConfig - the provider's resolved settings subtree, if any.
 * @returns a named credential ref, or undefined to rely on ambient discovery.
 */
export function discoverCredentialRef(
  provider: string,
  providerConfig: unknown,
): string | undefined {
  const generic = ['deepseek', 'deepseek-official']
  if (generic.includes(provider)) return 'DEEPSEEK_API_KEY'
  if (providerConfig !== null && typeof providerConfig === 'object' && !Array.isArray(providerConfig)) {
    const apiKeyEnv = (providerConfig as Record<string, unknown>).apiKeyEnv
    if (typeof apiKeyEnv === 'string' && apiKeyEnv.length > 0) return apiKeyEnv
  }
  return undefined
}

/**
 * Resolve the credential value immediately before one trial spawn.
 * @param ref - the credential ref from the run plan.
 * @param credentials - the credentials public service.
 * @returns the value, or undefined when the ref is unresolved.
 */
export async function resolveCredentialValue(
  ref: string,
  credentials: CredentialsProvider,
): Promise<string | undefined> {
  return credentials.resolve(ref)
}

/**
 * Build the env-suffix for one trial: only the selected managed ref/value is
 * added to the inherited child env. Uses a copy so we never mutate a shared env.
 * @param base - the inherited env (process.env).
 * @param ref - the credential ref, if any.
 * @param value - the resolved credential value, if any.
 * @param selection - the effective provider (for a readable unresolved diagnostic).
 * @returns a shallow copy of base plus the single ref/value, when resolvable.
 */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  ref: string | undefined,
  value: string | undefined,
  selection: Pick<ModelSelection, 'provider'>,
): NodeJS.ProcessEnv {
  const env = { ...base }
  if (ref !== undefined && value === undefined) {
    // Readable diagnostic (ref name only, never the value), carried via a
    // non-env marker caller checks; here we throw to fail pre-spawn.
    throw new Error(
      `eval: credential ref "${ref}" for provider "${selection.provider}" could not be resolved (no value)`,
    )
  }
  if (ref !== undefined && value !== undefined) {
    env[ref] = value
  }
  return env
}
