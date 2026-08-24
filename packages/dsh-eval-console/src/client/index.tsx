/**
 * Browser entry for the evolution console: one conversation.view slot tab.
 *
 * # absorbed-from: zhu1090093659/dsh-web-ui packages/dsh-task-board/src/client/index.ts (Apache-2.0)
 * (registration pattern) and @deepseek-ai/dsh-client-ui-trajectory
 * packages/client/ui-trajectory/src/client/index.ts (rc.8 authoritative
 * conversation.view registration: locale dictionaries + slots.inject +
 * label thunk).
 *
 * Adapted: the task-board settings-card/sidebar-entry registration is
 * replaced by a real conversation.view slot tab (id 'evolution', order 20 —
 * after ui-trajectory's order 10); the injected face is empty because the
 * console reads the Host, not the current session.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh } from './locales.ts'
import { EvalConsoleView, type EvalConsoleInjected } from './EvalConsoleView.tsx'
import './board.css'

/** Required services: the conversation slot registry and the locale service. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the evolution-console view tab. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab (and the injected stylesheet is disposed with the bundle).
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-eval-console: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'evolution',
    order: 20,
    locale: NS,
    label: () => t('view.title'),
    inject: (): EvalConsoleInjected => ({}),
  }, EvalConsoleView))
}
