/**
 * Global CSS declaration: the evolution console ships a plain, globally
 * namespaced stylesheet (evc- prefixed classes, no CSS modules, no DOM
 * takeover) rather than a css-module build — the client bundle injects the
 * stylesheet at load time.
 */

declare module '*.css' {
  const css: string
  export default css
}
