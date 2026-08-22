/**
 * Rubric ACL for dsh-eval: rubric plaintext never touches the disk.
 * The evaluation runner is the ONLY consumer that decrypts — the optimizer
 * and the model (with its tools) can read benchmark files and see ciphertext
 * only, so rubric isolation is enforced by code, not by prompt construction.
 *
 * # absorbed-from: ZK-Andy/dsh-continual-evolve/src/rubric.ts
 *
 * Format: `v1:<base64(iv) | base64(tag) | base64(ciphertext)>` — each part is
 * URL-safe base64 without padding, joined by `|`. A value without the `v1:`
 * prefix is treated as legacy plaintext and passes through.
 *
 * Key resolution (first match wins):
 *   1. explicit `rubricKey` option
 *   2. environment `DSH_EVOLVE_RUBRIC_KEY`
 *   3. a per-installation local key file at `<baseDir>/evolve/rubric.key`
 *      (auto-generated with 0600 permissions on first use)
 *   4. a fixed development key as a last-resort fallback when the key file
 *      can neither be read nor written (warns; only reachable in
 *      pathological environments)
 * The key string is derived to 32 bytes with SHA-256, so any passphrase works.
 *
 * @module dsh-eval/rubric
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The development fallback key — reachable only when the local key file is unusable. */
export const DEV_RUBRIC_KEY = 'dsh-eval-dev-key'

/** Name of the per-installation key file under `<baseDir>/evolve/`. */
export const RUBRIC_KEY_FILE_NAME = 'rubric.key'

/** Full path of the per-installation rubric key file. */
export function rubricKeyFilePath(baseDir: string): string {
  return join(baseDir, 'evolve', RUBRIC_KEY_FILE_NAME)
}

/** Envelope prefix marking an encrypted rubric. */
export const RUBRIC_PREFIX = 'v1:'

/** Derive a 32-byte AES-256 key from any passphrase. */
export function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase, 'utf8').digest()
}

/** Resolve the rubric key with documented precedence. */
export interface RubricKeyOptions {
  /** Explicit key configured by the plugin. */
  configKey?: string
  /** Environment to read `DSH_EVOLVE_RUBRIC_KEY` from. */
  env?: Record<string, string | undefined>
  /** Warning sink for the dev-key fallback. */
  warn?: (message: string) => void
}

/**
 * Resolve the effective rubric key: explicit config key → env → local key
 * file (auto-created 0600) → development fallback (warns).
 * @param baseDir - base directory for the local key file.
 * @param opts - key-resolution overrides.
 * @returns the derived 32-byte key.
 */
export function resolveRubricKey(baseDir: string, opts: RubricKeyOptions = {}): Buffer {
  const { configKey, env = process.env, warn } = opts
  if (configKey !== undefined && configKey.length > 0) {
    return deriveKey(configKey)
  }
  const envKey = env['DSH_EVOLVE_RUBRIC_KEY']
  if (envKey !== undefined && envKey.length > 0) {
    return deriveKey(envKey)
  }
  return loadOrCreateLocalKey(baseDir, warn)
}

/**
 * Load the per-installation key file, generating a fresh random key (0600)
 * on first use. Falls back to the development key with a warning when the
 * file can neither be read nor written.
 */
function loadOrCreateLocalKey(baseDir: string, warn?: (message: string) => void): Buffer {
  const keyPath = rubricKeyFilePath(baseDir)
  try {
    if (existsSync(keyPath)) {
      const content = readFileSync(keyPath, 'utf8').trim()
      if (content.length > 0) {
        return deriveKey(content)
      }
    }
    const key = randomBytes(32).toString('hex')
    mkdirSync(dirname(keyPath), { recursive: true })
    writeFileSync(keyPath, `${key}\n`, { encoding: 'utf8', mode: 0o600 })
    return deriveKey(key)
  }
  catch (cause) {
    warn?.(`rubric encryption: cannot read/write the local key file (${keyPath}): ${cause instanceof Error ? cause.message : String(cause)} — using the development key`)
    return deriveKey(DEV_RUBRIC_KEY)
  }
}

/**
 * Encrypt rubric plaintext into the `v1:` envelope (never written raw).
 * @param plaintext - the rubric text to encrypt.
 * @param key - the 32-byte derived key.
 * @returns the `v1:` envelope.
 */
export function encryptRubric(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${RUBRIC_PREFIX}${[iv, tag, data].map(part => part.toString('base64url')).join('|')}`
}

/**
 * Decrypt a `v1:` envelope. Legacy plaintext (no prefix) passes through
 * unchanged so pre-ACL benchmark files keep working. Throws on tampered
 * data, a wrong key, or a malformed envelope.
 * @param payload - the stored rubric (envelope or legacy plaintext).
 * @param key - the 32-byte derived key.
 * @returns the rubric plaintext.
 */
export function decryptRubric(payload: string, key: Buffer): string {
  if (!payload.startsWith(RUBRIC_PREFIX)) {
    return payload // legacy plaintext file
  }
  const raw = payload.slice(RUBRIC_PREFIX.length)
  const parts = raw.split('|')
  if (parts.length !== 3) {
    throw new Error('rubric: malformed encrypted envelope')
  }
  const [ivText, tagText, dataText] = parts
  const iv = Buffer.from(ivText!, 'base64url')
  const tag = Buffer.from(tagText!, 'base64url')
  const data = Buffer.from(dataText!, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** True when a stored rubric is an encrypted envelope rather than legacy plaintext. */
export function isEncryptedRubric(payload: string): boolean {
  return payload.startsWith(RUBRIC_PREFIX)
}
