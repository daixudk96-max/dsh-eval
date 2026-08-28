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
  kind: 'revision'
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
 * to `name` and `。本版变更: <note>` to `description`. Lines are matched with
 * `^name:` / `^description:` anchors; when either line is absent the text is
 * returned unchanged.
 */
export function decoratePresetYml(text: string, digest: string, changeNote: string): string {
  const tag = digest.slice(0, 8)
  let out = text.replace(/^name:\s*(.+)$/m, (_m, name: string) => `name: ${name.trim()} · ${tag}`)
  out = out.replace(/^description:\s*(.+)$/m, (_m, desc: string) => {
    const trimmed = desc.trim()
    const sep = /[。.!?！？]$/.test(trimmed) ? '' : '。'
    return `description: ${trimmed}${sep}本版变更: ${changeNote}`
  })
  return out
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
    if (typeof owner.package !== 'string' || owner.kind !== 'revision') return null
    return {
      package: owner.package,
      kind: 'revision',
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
  if (logicalId === '' || logicalId === '.' || logicalId === '..' || /[/\\]/.test(logicalId)) {
    throw new Error(`unsafe logical id: ${logicalId}`)
  }

  // Decorate the synced copy of preset.yml (never the registry content) with
  // the version tag and the change note when one is provided.
  const outFiles: Record<string, string> = { ...files }
  if (options.changeNote !== undefined && outFiles['preset.yml'] !== undefined) {
    outFiles['preset.yml'] = decoratePresetYml(outFiles['preset.yml'], digest, options.changeNote)
  }

  const targetId = `${logicalId}-${digest.slice(0, 8)}`
  const dir = path.join(agentPresetsRoot, targetId)

  const kind = await pathKind(dir)
  if (kind === 'file') throw new Error(`refusing to overwrite ${dir} (not a directory)`)
  const existed = kind === 'dir'
  let owner: SyncOwner | null = null
  if (existed) {
    owner = await readOwner(dir)
    if (owner === null || owner.package !== ownerPackage) {
      const ownerName = owner === null ? '(missing)' : owner.package
      throw new Error(`refusing to overwrite ${dir} (owned by ${ownerName})`)
    }
  }

  // Idempotence pass: unchanged files are skipped, only differing files are
  // reported as written.
  const written: string[] = []
  const skipped: string[] = []
  for (const rel of Object.keys(outFiles)) {
    assertSafeRelativePath(rel)
    if (existed && (await fileEquals(path.join(dir, rel), outFiles[rel]!))) skipped.push(rel)
    else written.push(rel)
  }

  const ownerCurrent = owner !== null && owner.package === ownerPackage && owner.digest === digest
  if (written.length === 0 && ownerCurrent) {
    return { dir, targetId, written: [], skipped, existed }
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
    for (const [rel, text] of Object.entries(outFiles)) {
      const abs = path.join(staging, rel)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, text, 'utf8')
    }
    const ownerEntry: SyncOwner = {
      package: ownerPackage,
      kind: 'revision',
      revisionId: targetId,
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

  return { dir, targetId, written, skipped, existed }
}
