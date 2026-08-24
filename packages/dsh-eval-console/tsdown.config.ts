/**
 * Standalone tsdown client-bundle config for dsh-eval-console.
 *
 * Replicates the DSH 0.1.0-rc.8 clientBundle preset
 * (packages/client/tsdown.client.ts) essentials WITHOUT importing the DSH
 * checkout or the dsh-web shared preset:
 *
 *   - browser CJS closure-factory artifact into lib/client.js, stamped with
 *     window.__ModuleLoader__.load({ id: 'dsh-eval-console', factory });
 *   - externals = the platform seed table + the package's dsh.client.inject
 *     rows (loader module-table requests); everything else inlines;
 *   - a bundle purity gate on @deepseek-ai value imports (type-only imports
 *     are erased and never reach it);
 *   - a global-CSS style injector: `import './board.css'` becomes a virtual
 *     module that injects a data-plugin-css style tag at factory execution.
 *
 * The Host half is NOT bundled here — tsc (tsconfig.build.json) emits it
 * directly to lib/, keeping the relative `require('../../preset-registry/...')`
 * intact. `tsdown` therefore builds only the client half.
 */

import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-eval-console'

/** The shell's frozen module-table seed (mirrors packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** Factories the shell preloads before start. */
const PRELOADED_CLIENT_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client'] as const

/** This package's dsh.client.inject rows (declared in package.json). */
const REQUESTED_CLIENT_EXTERNALS = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
] as const

/** Every specifier that must stay an import in the browser bundle. */
const EXTERNAL = new Set<string>([
  ...PLATFORM_MODULES,
  ...PRELOADED_CLIENT_EXTERNALS,
  ...REQUESTED_CLIENT_EXTERNALS,
])

const CSS_VIRTUAL_PREFIX = '\0dsh-eval-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Emit a plugin-owned style injector for one global stylesheet. */
function styleInjectionModule(id: string, fileId: string, css: string): string {
  const tagId = `${id}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    'export {};',
  ].join('\n')
}

const client: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: (specifier: string) => EXTERNAL.has(specifier),
    alwaysBundle: (specifier: string) => !EXTERNAL.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [
    {
      // Build-time mirror of the module-edge rules: any @deepseek-ai value
      // import outside the external set is a build error.
      name: 'dsh-eval-console-client-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (EXTERNAL.has(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a default client external or ${PLUGIN_ID}'s dsh.client.inject row — ` +
            'cross-plugin value imports are forbidden (type-only imports are erased and never reach this gate)',
        )
      },
    },
    {
      name: 'dsh-eval-console-css-global',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css') || source.endsWith('.module.css') || importer === undefined) return null
        const abs = resolvePath(dirname(importer), source)
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const css = await readFile(fileId, 'utf8')
        return styleInjectionModule(PLUGIN_ID, fileId, css)
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default client
