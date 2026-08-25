/**
 * Client display formatting helpers (pure, framework-free).
 *
 * Original work for the dsh-eval project (Apache-2.0). Kept in a plain .ts
 * module so the console's node:test suite can unit-test it directly (the
 * .tsx components are not strip-importable in node:test).
 */

/** Compact local-time formatting for audit timestamps — seconds included,
 * never truncated. ISO in, `YYYY-MM-DD HH:mm:ss` out. */
export function fmtTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}
