#!/usr/bin/env node
/**
 * prepare-sdk.mjs — build the dsh-eval standalone tarball through a disposable
 * SDK mirror, without ever modifying the real DSH checkout.
 *
 * Usage:
 *   node packages/dsh-eval/scripts/prepare-sdk.mjs --dsh E:\github\dsh
 *
 * Flow (matches the design's disposable-mirror contract, pnpm-only):
 *   1. Verify the real DSH checkout HEAD == the pinned rc.8 SHA
 *      (141eb6fef83422698aef7a981029e843e8161534) and that `git status` is clean.
 *   2. Expand the tracked DSH workspace into the ignored `packages/dsh-eval/.sdk/dsh`
 *      via read-only `git archive` (never writes into E:\github\dsh).
 *   3. In the pristine mirror (no eval member yet) run `pnpm install --frozen-lockfile`
 *      then `pnpm run build:lib:host` (tsc -b tsconfig.host.json && tsdown ...).
 *   4. THEN copy this shipping package into the mirror member `packages/eval/dsh-eval`
 *      (the host build never sees the temp package via tsconfig.host.json glob).
 *   5. In the mirror run a second `pnpm install --no-frozen-lockfile` (the pinned
 *      lock has no importer for the new package), then pnpm --filter dsh-eval
 *      typecheck / build / test.
 *   6. Copy the built `lib/**` + test evidence back into the shipping package.
 *   7. Run `npm pack --json` INSIDE the mirror package (prepack rebuilds there),
 *      copy the exact tarball + pack JSON + shasum to `packages/dsh-eval/dist/`,
 *      then verify the real E:\github\dsh is still byte-identical (`git status`).
 *
 * pnpm only for install/build/test — never npm ci / package-lock (workspace:^).
 * npm is used only for `npm pack --json` inside the prepared mirror.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(__dirname, '..')
const SDK_DIR = join(PACKAGE_ROOT, '.sdk')
const DSH_MIRROR = join(SDK_DIR, 'dsh')
const DIST_DIR = join(PACKAGE_ROOT, 'dist')

const PINNED_DSH_SHA = '141eb6fef83422698aef7a981029e843e8161534'

// On Windows, pnpm/npm are .cmd shims that must run through the shell
// (execFileSync of a .cmd EINVALs without shell:true). git/tar/node are real
// exe and must NOT get a .cmd suffix or shell quoting.
const CMD_SHIMS = new Set(['pnpm', 'npm', 'npx', 'corepack'])

function run(cmd, args, opts = {}) {
  if (process.platform === 'win32' && CMD_SHIMS.has(cmd)) {
    // Invoke the .cmd through the shell with the original tokens preserved.
    const quoted = args.map(a => (/\s/u.test(a) ? `"${a}"` : a)).join(' ')
    console.log(`> ${cmd}.cmd ${args.join(' ')}`)
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${cmd} ${quoted}`], {
      stdio: 'inherit',
      ...opts,
    })
  }
  console.log(`> ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Run a Windows .cmd shim and CAPTURE its stdout (e.g. `npm pack --json`). */
function captureShim(cmd, args, opts = {}) {
  if (process.platform === 'win32' && CMD_SHIMS.has(cmd)) {
    const quoted = args.map(a => (/\s/u.test(a) ? `"${a}"` : a)).join(' ')
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${cmd} ${quoted}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...opts,
    })
  }
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts })
}

function main() {
  const args = process.argv.slice(2)
  const dshFlag = args.indexOf('--dsh')
  if (dshFlag === -1 || dshFlag === args.length - 1) {
    throw new Error('usage: node prepare-sdk.mjs --dsh <real-dsh-checkout>')
  }
  const DSH_REAL = resolve(args[dshFlag + 1])
  if (!existsSync(join(DSH_REAL, '.git'))) {
    throw new Error(`--dsh must point to a git checkout with .git: ${DSH_REAL}`)
  }

  // 1. Verify pinned SHA on the real checkout (read-only). Capture the
  //    pre-existing git status (may include the user's untracked helper files,
  //    e.g. dsh-web.cmd). The invariant is a byte-identical status before and
  //    after the build — the SDK mirror never modifies the DSH checkout.
  const beforeSha = git(DSH_REAL, 'rev-parse', 'HEAD')
  if (beforeSha !== PINNED_DSH_SHA) {
    throw new Error(
      `real DSH checkout HEAD ${beforeSha} != pinned ${PINNED_DSH_SHA}; ` +
      'this mirror prepares against a pinned rc.8 host. Aborting.',
    )
  }
  const beforeStatus = git(DSH_REAL, 'status', '--porcelain')

  // 2. Expand tracked workspace into the disposable mirror (git archive = read-only).
  rmSync(SDK_DIR, { recursive: true, force: true })
  mkdirSync(DSH_MIRROR, { recursive: true })
  // Stream `git archive` to a temp tar file (avoids ENOBUFS from capturing the
  // whole workspace in memory), then extract with tar into the mirror.
  const archivePath = join(SDK_DIR, 'dsh-archive.tar')
  run('git', ['-C', DSH_REAL, 'archive', '--format=tar', '-o', archivePath, PINNED_DSH_SHA])
  run('tar', ['-x', '-f', archivePath, '-C', DSH_MIRROR])
  rmSync(archivePath, { force: true })
  console.log('mirror workspace expanded into', DSH_MIRROR)

  // 3. Pristine mirror: install + build host libs FIRST (no eval member yet).
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: DSH_MIRROR })
  run('pnpm', ['run', 'build:lib:host'], { cwd: DSH_MIRROR })

  // 4. Insert shipping package as member packages/eval/dsh-eval.
  const memberRoot = join(DSH_MIRROR, 'packages', 'eval', 'dsh-eval')
  mkdirSync(memberRoot, { recursive: true })
  copyShippingTo(memberRoot)

  // 5. Second install (lock has no importer for the new package; lock changes
  //    stay inside the mirror), then typecheck/build/test the member.
  run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: DSH_MIRROR })
  run('pnpm', ['--filter', 'dsh-eval', 'run', 'typecheck'], { cwd: DSH_MIRROR })
  run('pnpm', ['--filter', 'dsh-eval', 'run', 'build'], { cwd: DSH_MIRROR })
  run('pnpm', ['--filter', 'dsh-eval', 'test'], { cwd: DSH_MIRROR })

  // 6. Copy lib/** + test evidence back to shipping package.
  const memberLib = join(memberRoot, 'lib')
  if (!existsSync(memberLib)) {
    throw new Error('member build produced no lib/ — build config problem, not a packaging bug')
  }
  rmSync(join(PACKAGE_ROOT, 'lib'), { recursive: true, force: true })
  cpSync(memberLib, join(PACKAGE_ROOT, 'lib'), { recursive: true })
  console.log('shipping lib/** copied back from mirror member')

  // 7. Authoritative npm pack --json INSIDE the mirror package.
  mkdirSync(DIST_DIR, { recursive: true })
  const packJson = captureShim('npm', ['pack', '--json', '--pack-destination', DIST_DIR], {
    cwd: memberRoot,
  })
  const parsed = JSON.parse(packJson)
  const tarball = parsed[0]?.filename
  if (!tarball) throw new Error('npm pack produced no filename')
  const tgzPath = join(DIST_DIR, tarball)
  const shasum = createHash('sha512').update(readFileSync(tgzPath)).digest('hex')
  writeFileSync(join(DIST_DIR, `${tarball}.sha512`), `${shasum}  ${tarball}\n`)
  writeFileSync(join(DIST_DIR, 'pack.json'), packJson)
  console.log('tarball written:', tgzPath)

  // 8. Verify real checkout is still byte-identical / clean (read-only guarantee).
  const afterStatus = git(DSH_REAL, 'status', '--porcelain')
  if (afterStatus !== beforeStatus) {
    throw new Error(`real DSH checkout changed during build — aborting. status now:\n${afterStatus}`)
  }
  console.log('OK: real DSH checkout unchanged; tarball + pack.json in', DIST_DIR)
}

function copyShippingTo(memberRoot) {
  // Copy tracked shipping source/tests/configs; EXCLUDE .sdk, node_modules,
  // dist (self artifacts) and any stale lib (mirror builds it fresh).
  const copyDirs = ['src', 'tests']
  for (const dir of copyDirs) {
    const src = join(PACKAGE_ROOT, dir)
    if (existsSync(src)) cpSync(src, join(memberRoot, dir), { recursive: true })
  }
  for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts',
    'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'UPSTREAM.md']) {
    const src = join(PACKAGE_ROOT, file)
    if (existsSync(src)) cpSync(src, join(memberRoot, file))
  }
}

try {
  main()
} catch (error) {
  console.error('prepare-sdk failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
