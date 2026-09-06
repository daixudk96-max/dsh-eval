/**
 * Preset version synchronizer: writes one immutable registry revision's
 * content files into `<agentPresetsRoot>/<logicalId>-<digest8>/` as a
 * versioned agent-preset directory (so the new-session preset picker can
 * select it). The registry pointer is never touched.
 *
 * Original work for the dsh-eval project (Apache-2.0). Pure module with no
 * service dependencies — node:fs/promises only, unit-tested against real
 * tempdirs.
 *
 * Design (task 08-25-feat-08-25-preset-version-selector, D2):
 *   - owner marker `.dsh-preset-owner.json` records the synchronizing plugin
 *     and the revision identity; a directory that exists without this plugin
 *     as owner is refused (`refusing to overwrite <dir> (owned by <pkg>)`) —
 *     we never clobber someone else's preset directory;
 *   - idempotent: files already present with identical content are skipped;
 *   - atomic commit: all files + the owner marker are staged under
 *     `<dir>.installing-<pid>`, the existing directory is displaced to
 *     `<dir>.prev-<pid>`, and the staging directory is renamed into place; on
 *     any failure the staging directory is removed and the displaced
 *     directory is restored — no partial state survives;
 *   - path safety: revision file keys must be relative paths with no `..`
 *     segment, no leading slash, no Windows drive prefix and no backslash.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** The owner marker filename inside every synchronized preset directory. */
export const OWNER_FILE = '.dsh-preset-owner.json'
/** The default owner package recorded in the marker. */
export const OWNER_PACKAGE = 'dsh-eval-console'

/** The owner marker written into every synchronized preset directory. */
export interface SyncOwner {
  package: string
  kind: 'revision' | 'body'
  revisionId: string
  digest: string
  syncedAt: string
}

export interface SyncRevisionOptions {
  /** $DSH_HOME/.agent-presets (or ~/.dsh/.agent-presets). */
  agentPresetsRoot: string
  /** The registry logical id, e.g. 'evaluate'. */
  logicalId: string
  /** 64-hex content digest of the revision to sync. */
  digest: string
  /** Revision content files (relative path -> text). */
  files: Record<string, string>
  /** Owner package recorded in the marker. Default 'dsh-eval-console'. */
  ownerPackage?: string
  /**
   * Optional change note for this revision (e.g. the mutation summaries from
   * the revision manifest). When given, the synced copy of preset.yml is
   * decorated: `name` gains a ` · <digest8>` suffix and `description` gains a
   * `。本版变更: <note>` suffix, so the preset picker shows which version this
   * is and what changed. The registry content is never modified.
   */
  changeNote?: string
}

export interface SyncRevisionResult {
  /** Absolute target directory. */
  dir: string
  /** Directory id: <logicalId>-<digest8>. */
  targetId: string
  /** Files actually written by this call. */
  written: string[]
  /** Files already present with identical content. */
  skipped: string[]
  /** True when the target directory already existed before this call. */
  existed: boolean
}

const DIGEST_RE = /^[0-9a-f]{64}$/

/**
 * Decorate a preset.yml copy for a versioned directory: append ` · <digest8>`
 * to `name` and `。本版变更: <note>` to `description`.
 *
 * Input contract: the registry revision's preset.yml, which DSH generates
 * through `renderPresetMetadata` (js-yaml dump with `lineWidth: -1`), so
 * every field is exactly one line and each value a plain (unquoted) scalar.
 * Decoration re-renders each string value with `JSON.stringify` — a valid
 * YAML double-quoted scalar — instead of splicing text into the line:
 * change notes routinely contain `: ` (colon-space), which is illegal inside
 * a YAML plain scalar and would make the whole file unparsable, silently
 * emptying DSH's picker metadata. When none of the known fields is present
 * the text is returned unchanged.
 */
export function decoratePresetYml(text: string, digest: string, changeNote: string): string {
  const tag = digest.slice(0, 8)
  let name: string | undefined
  let description: string | undefined
  let order: number | undefined
  for (const line of text.split(/\r?\n/)) {
    const nameMatch = /^name:\s*(.+)$/.exec(line)
    const descMatch = /^description:\s*(.+)$/.exec(line)
    const orderMatch = /^order:\s*(-?\d+)$/.exec(line)
    if (nameMatch !== null && name === undefined) name = nameMatch[1]!.trim()
    else if (descMatch !== null && description === undefined) description = descMatch[1]!.trim()
    else if (orderMatch !== null && order === undefined) order = Number(orderMatch[1])
  }
  if (name === undefined && description === undefined && order === undefined) return text

  const out: string[] = []
  if (name !== undefined) out.push(`name: ${JSON.stringify(`${name} · ${tag}`)}`)
  if (description !== undefined) {
    const sep = /[。.!?！？]$/.test(description) ? '' : '。'
    out.push(`description: ${JSON.stringify(`${description}${sep}本版变更: ${changeNote}`)}`)
  }
  if (order !== undefined) out.push(`order: ${order}`)
  return `${out.join('\n')}\n`
}

/** Reject any path that could escape the target directory. */
function assertSafeRelativePath(key: string): void {
  if (key === '' || key.startsWith('/') || key.includes('\\') || /^[A-Za-z]:/.test(key)) {
    throw new Error(`unsafe revision file path: ${key}`)
  }
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`unsafe revision file path: ${key}`)
    }
  }
}

/** Read + shape-validate the owner marker; null when absent or malformed. */
async function readOwner(dir: string): Promise<SyncOwner | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dir, OWNER_FILE), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const owner = parsed as Record<string, unknown>
    if (typeof owner.package !== 'string') return null
    if (owner.kind !== 'revision' && owner.kind !== 'body') return null
    return {
      package: owner.package,
      kind: owner.kind,
      revisionId: typeof owner.revisionId === 'string' ? owner.revisionId : '',
      digest: typeof owner.digest === 'string' ? owner.digest : '',
      syncedAt: typeof owner.syncedAt === 'string' ? owner.syncedAt : '',
    }
  } catch {
    return null
  }
}

/** Classify a path: 'dir' | 'file' | 'missing'. */
async function pathKind(target: string): Promise<'dir' | 'file' | 'missing'> {
  try {
    const st = await stat(target)
    return st.isDirectory() ? 'dir' : 'file'
  } catch {
    return 'missing'
  }
}

/** True when the file exists and its content matches (false on any error). */
async function fileEquals(abs: string, text: string): Promise<boolean> {
  try {
    return (await readFile(abs, 'utf8')) === text
  } catch {
    return false
  }
}

/**
 * Synchronize one revision's files into `<agentPresetsRoot>/<logicalId>-<digest8>/`.
 * @throws when the digest or a file path is unsafe, when the target exists
 *   but is not owned by this plugin, or on any filesystem failure (staging
 *   cleanup guaranteed).
 */
export async function syncRevision(options: SyncRevisionOptions): Promise<SyncRevisionResult> {
  const { agentPresetsRoot, logicalId, digest, files } = options
  const ownerPackage = options.ownerPackage ?? OWNER_PACKAGE

  if (!DIGEST_RE.test(digest)) throw new Error(`invalid revision digest: ${digest.slice(0, 12)}…`)
  assertSafeLogicalId(logicalId)

  // Decorate the synced copy of preset.yml (never the registry content) with
  // the version tag and the change note when one is provided.
  const outFiles: Record<string, string> = { ...files }
  if (options.changeNote !== undefined && outFiles['preset.yml'] !== undefined) {
    outFiles['preset.yml'] = decoratePresetYml(outFiles['preset.yml'], digest, options.changeNote)
  }

  const targetId = `${logicalId}-${digest.slice(0, 8)}`
  const dir = path.join(agentPresetsRoot, targetId)
  const core = await syncDirTo({
    dir, files: outFiles, digest, ownerKind: 'revision',
    allowUnowned: false, ownerPackage, ownerRevisionId: targetId,
  })
  return { dir, targetId, ...core }
}

/**
 * Options for {@link syncBody} — the default-preset body synchronizer.
 */
export interface SyncBodyOptions {
  /** $DSH_HOME/.agent-presets (or ~/.dsh/.agent-presets). */
  agentPresetsRoot: string
  /** The registry logical id, e.g. 'evaluate'. */
  logicalId: string
  /** 64-hex content digest of the revision to sync. */
  digest: string
  /** Revision content files (relative path -> text), written UNDECORATED. */
  files: Record<string, string>
  /** Owner package recorded in the marker. Default 'dsh-eval-console'. */
  ownerPackage?: string
  /** Human-readable revision id recorded in the marker; defaults to digest8. */
  revisionId?: string
  /**
   * Adopt a body directory that exists WITHOUT an owner marker (typically a
   * manually created default-preset body), writing the marker on adoption.
   * A directory owned by any other package is always refused. Default false.
   */
  adopt?: boolean
}

export interface SyncBodyResult {
  /** Absolute target directory. */
  dir: string
  /** Files actually written by this call. */
  written: string[]
  /** Files already present with identical content. */
  skipped: string[]
  /** True when the target directory already existed before this call. */
  existed: boolean
  /** True when an unowned (marker-less) directory was adopted. */
  adopted: boolean
}

/**
 * Synchronize the CURRENT registry revision (undecorated) into the default
 * preset body directory `<agentPresetsRoot>/<logicalId>/` — the directory a
 * deployment's `agent-presets.default` points at. Each promote writes the new
 * current revision here, so the default preset the new-session picker starts
 * follows registry evolution instead of going stale.
 *
 * Unlike {@link syncRevision}, the body is identity-stable: no digest tag and
 * no change note decorate its preset.yml. Version identity belongs to the
 * versioned directories; the body is the live pointer to the current one.
 * @throws when the digest or a file path is unsafe, when the target exists
 *   and is owned by another package, or on any filesystem failure (staging
 *   cleanup guaranteed).
 */
export async function syncBody(options: SyncBodyOptions): Promise<SyncBodyResult> {
  const { agentPresetsRoot, logicalId, digest, files } = options
  const ownerPackage = options.ownerPackage ?? OWNER_PACKAGE

  if (!DIGEST_RE.test(digest)) throw new Error(`invalid revision digest: ${digest.slice(0, 12)}…`)
  assertSafeLogicalId(logicalId)

  const dir = path.join(agentPresetsRoot, logicalId)
  const core = await syncDirTo({
    dir, files, digest, ownerKind: 'body',
    allowUnowned: options.adopt === true, ownerPackage,
    ownerRevisionId: options.revisionId ?? digest.slice(0, 8),
  })
  return { dir, ...core }
}

/** Reject unsafe logical ids (path segments, separators, dot-forms). */
function assertSafeLogicalId(logicalId: string): void {
  if (logicalId === '' || logicalId === '.' || logicalId === '..' || /[/\\]/.test(logicalId)) {
    throw new Error(`unsafe logical id: ${logicalId}`)
  }
}

interface SyncDirOptions {
  /** Absolute target directory. */
  dir: string
  /** Files (relative path -> text); already decorated by the caller when applicable. */
  files: Record<string, string>
  /** 64-hex digest used for the idempotence check. */
  digest: string
  /** Owner marker kind: 'revision' for versioned dirs, 'body' for the default body. */
  ownerKind: 'revision' | 'body'
  /** Whether a marker-less existing directory may be adopted (body only). */
  allowUnowned: boolean
  /** Owner package recorded in the marker. */
  ownerPackage: string
  /** Human-readable revision identity recorded in the marker. */
  ownerRevisionId: string
}

/**
 * Shared commit core: owner-guarded idempotent atomic write of a file set
 * into one preset directory. See {@link syncRevision} / {@link syncBody}.
 */
async function syncDirTo(options: SyncDirOptions): Promise<{
  written: string[]
  skipped: string[]
  existed: boolean
  adopted: boolean
}> {
  const { dir, files, digest, ownerKind, allowUnowned, ownerPackage, ownerRevisionId } = options

  const kind = await pathKind(dir)
  if (kind === 'file') throw new Error(`refusing to overwrite ${dir} (not a directory)`)
  const existed = kind === 'dir'
  let owner: SyncOwner | null = null
  let adopted = false
  if (existed) {
    owner = await readOwner(dir)
    if (owner === null) {
      if (!allowUnowned) throw new Error(`refusing to overwrite ${dir} (owned by (missing))`)
      adopted = true
    } else if (owner.package !== ownerPackage) {
      throw new Error(`refusing to overwrite ${dir} (owned by ${owner.package})`)
    }
  }

  // Idempotence pass: unchanged files are skipped, only differing files are
  // reported as written.
  const written: string[] = []
  const skipped: string[] = []
  for (const rel of Object.keys(files)) {
    assertSafeRelativePath(rel)
    if (existed && (await fileEquals(path.join(dir, rel), files[rel]!))) skipped.push(rel)
    else written.push(rel)
  }

  const ownerCurrent = owner !== null && owner.package === ownerPackage && owner.digest === digest
  if (written.length === 0 && ownerCurrent) {
    return { written: [], skipped, existed, adopted }
  }

  // Atomic commit: stage every file + the owner marker, then displace the
  // old directory and rename the staging directory into place.
  const staging = `${dir}.installing-${process.pid}`
  const backup = `${dir}.prev-${process.pid}`
  await rm(staging, { recursive: true, force: true })
  await rm(backup, { recursive: true, force: true })
  let movedAside = false
  try {
    await mkdir(staging, { recursive: true })
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(staging, rel)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, text, 'utf8')
    }
    const ownerEntry: SyncOwner = {
      package: ownerPackage,
      kind: ownerKind,
      revisionId: ownerRevisionId,
      digest,
      syncedAt: new Date().toISOString(),
    }
    await writeFile(path.join(staging, OWNER_FILE), JSON.stringify(ownerEntry, null, 2) + '\n', 'utf8')
    if (existed) {
      await rename(dir, backup)
      movedAside = true
    }
    await rename(staging, dir)
    if (movedAside) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    if (movedAside) await rename(backup, dir).catch(() => undefined)
    throw error
  }

  return { written, skipped, existed, adopted }
}
