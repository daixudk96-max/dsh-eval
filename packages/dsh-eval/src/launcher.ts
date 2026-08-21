/**
 * Launcher resolution for dsh-eval: decide which executable the trial child
 * spawns. Precedence is explicit CLI argv override > benchmark YAML `command`
 * array > the current running DSH CLI (`[process.execPath, argv[1]]`). This is
 * an explicit product-correctness bridge (not a failure-gated adapter): the
 * upstream `command: ['dsh']` default spawns `dsh` from PATH and fails ENOENT
 * on machines where dsh is not on PATH.
 *
 * The current-CLI default is `[process.execPath, resolved process.argv[1]]`
 * with `shell:false`, so it never depends on PATH and preserves argv tokens
 * (including Windows paths with spaces). We fail early with a readable
 * diagnostic only when the current launcher cannot resolve (e.g. argv[1] is
 * missing/unreadable) or an explicit argv override is invalid.
 *
 * @module dsh-eval/launcher
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** A resolvable dsh launch argv; the first entry is the Node executable. */
export interface Launcher {
  /** Node executable (process.execPath). */
  node: string
  /** The DSH CLI entry script, resolved to an absolute path when possible. */
  script: string
  /** Full argv handed to runCommand: [node, script, ...tail]. */
  argv: readonly string[]
  /** True when node+script resolve to a readable CLI entry. */
  valid: boolean
}

/**
 * Resolve the current running DSH CLI into a launch argv. The CLI entry is
 * `process.argv[1]`; when missing or not a readable file we still return the
 * argv form but flag `valid=false` so the caller fails early and readably.
 * @param processRef - the process object (tests substitute a fixture).
 * @returns the resolved launcher or an invalid marker.
 */
export function resolveCurrentCli(processRef: { execPath: string; argv: readonly string[] }): Launcher {
  const scriptRaw = processRef.argv[1]
  const script = scriptRaw
  let node = processRef.execPath
  let valid = true
  if (scriptRaw === undefined || scriptRaw === '') {
    valid = false
  } else {
    try {
      const absolute = resolve(scriptRaw)
      if (!existsSync(absolute)) valid = false
    } catch {
      valid = false
    }
  }
  // We carry the raw argv for the valid case; invalid markers are handled by
  // the caller's diagnostic. `argv` is only used when valid.
  return { node, script: scriptRaw ?? '', argv: valid ? [node, script as string] : [], valid }
}

/**
 * Resolve the effective launcher with the documented precedence.
 * @param cliOverride - explicit CLI `--dsh <argv...>` override, or undefined.
 * @param benchmarkCommand - benchmark YAML `command` array, or undefined.
 * @param processRef - the current process (for the default CLI launcher).
 * @returns the effective launcher argv plus a validity flag.
 */
export function resolveLauncher(
  cliOverride: readonly string[] | undefined,
  benchmarkCommand: readonly string[] | undefined,
  processRef: { execPath: string; argv: readonly string[] },
): { argv: readonly string[]; validated: boolean; reason?: string } {
  if (cliOverride !== undefined && cliOverride.length > 0) {
    if (cliOverride[0] === undefined) {
      return { argv: cliOverride, validated: false, reason: 'eval: --dsh requires a non-empty argv' }
    }
    return { argv: cliOverride, validated: true }
  }
  if (benchmarkCommand !== undefined && benchmarkCommand.length > 0) {
    if (benchmarkCommand[0] === undefined) {
      return { argv: benchmarkCommand, validated: false, reason: 'eval: benchmark command must not be empty' }
    }
    return { argv: benchmarkCommand, validated: true }
  }
  const current = resolveCurrentCli(processRef)
  if (current.valid) return { argv: current.argv, validated: true }
  return {
    argv: current.argv,
    validated: false,
    reason: 'eval: no launcher resolved; current DSH CLI argv[1] is missing/unreadable. '
      + 'Write an absolute launcher in benchmark `command` or add the dsh bin to PATH.',
  }
}
