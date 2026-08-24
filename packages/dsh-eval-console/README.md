# dsh-eval-console

Evolution console for the DSH Web GUI: a `conversation.view` slot tab (id
`evolution`, order 20 — after ui-trajectory's order 10) rendering a six-column
board over the **real** preset-registry and the evolution-audit JSONL ledger.

- **Host half** (`exports "."`, runs in the DSH process): serves the `/eval`
  channel over the `webServer` service —
  `GET /eval/state` (no-store snapshot), `POST /eval/action` (requestId
  envelope), `GET /eval/events` (SSE, 15 s heartbeat, revision-delta frames) —
  and polls the audit ledger to push SSE frames when evolution activity lands.
- **Browser half** (`exports "./client"`): registers the conversation.view tab
  and renders the board: header (audit revision + snapshot time), current
  version bar (revision/digest + GATE/PROMOTED/APPROVAL chips), the six
  columns (**SEALED / EVALUATING / ACCEPTED / PROMOTED / REJECTED /
  INCONCLUSIVE**), a revision detail modal (content files) and the audit
  timeline.

Read-only-first: the only write reachable from the UI is a **confirm-gated
content rollback** (`registry.rollbackContent`). Promote is never exposed —
advancing the pointer stays on the CLI/approval path.

## Status derivation

- History rows (`registry.history()`: current + rollback window) are always
  **PROMOTED** — they are the live pointer chain.
- Audit-only revisions (sealed outside the rollback window) derive their
  status from their run's latest gate outcome
  (`PASS→ACCEPTED`, `FAIL→REJECTED`, `INCONCLUSIVE`, `EVALUATING`), falling
  back to **SEALED** when only a seal exists.

## Layout

```
src/
  index.ts            Host plugin entry (config defaults, webServer routes, lifecycle)
  host-service.ts     EvalConsoleHostService: registry+audit -> EvalSnapshot
  host-routes.ts      /eval state/action/events WebRoutes + loopback/same-origin fence
  http.ts             bounded JSON body reader + writer   (absorbed from dsh-task-board)
  audit.ts            evolution-audit ledger.jsonl reader
  domain/
    states.ts         six-state model + column table
    protocol.ts       /eval wire types + strict action-envelope parser
    adapter.ts        registry+audit -> rows/columns/snapshot (pure)
    timeline.ts       audit records -> timeline events (pure)
  client/
    index.tsx         conversation.view registration (slots + locale)
    EvalConsoleView.tsx / EvalCard.tsx / EvalDetail.tsx / ConfirmDialog.tsx
    host-api.ts       /eval transport (fetch + EventSource)
    locales.ts        zh/en dictionaries
    board.css         evc- prefixed global styles (adapted from board.module.css)
test/                 node:test unit tests (states/protocol/adapter/timeline)
smoke/
  smoke-state.mjs     real-registry read-only snapshot smoke
  smoke-routes.mjs    plain node:http route smoke (state/action/events/fence)
```

## Build & verify

```sh
pnpm typecheck   # tsc build + client program, zero errors
pnpm build       # tsc host -> lib/, tsdown client bundle -> lib/client.js
pnpm test        # node --test test/*.test.js
pnpm smoke       # smoke-state.mjs against the real registry/audit (read-only)
```

Host builds with `tsc` (keeps the relative `require('../../preset-registry/
lib/registry.js')` intact); the browser bundle is built by the standalone
`tsdown.config.ts`, which replicates the DSH rc.8 `clientBundle` essentials
(closure-factory `__ModuleLoader__.load`, platform-seed externals, a purity
gate on `@deepseek-ai` value imports, and a global-CSS style injector).

## Config (cordis row)

| key           | default                                  | meaning                          |
| ------------- | ---------------------------------------- | -------------------------------- |
| `enabled`     | `true`                                   | master switch                    |
| `logicalId`   | `evaluate`                               | registry logical model id        |
| `registryRoot`| `$DSH_HOME/preset-registry`              | preset-registry root             |
| `auditFile`   | `$DSH_HOME/evolution-audit/ledger.jsonl` | audit ledger (nested fallback)   |
| `tailLimit`   | `120`                                    | timeline tail cap                |
| `pollMs`      | `5000`                                   | audit poll interval              |

## Security model

`/eval` is a desktop GUI control surface. Every route requires a browser
same-origin marker (`sec-fetch-site: same-origin` or an `Origin` header) AND a
loopback socket address. A bare local `curl` without the marker is refused
(403). Actions are strict-exact-key envelopes; rollback additionally requires
the exact `ROLLBACK:<revisionId>` confirmation phrase and is the only
mutating action.

## License

Apache-2.0. Files adapted from
[zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web)
(`dsh-task-board`, Apache-2.0) carry an `absorbed-from` note in their headers;
see `NOTICE` and `LICENSE`.
