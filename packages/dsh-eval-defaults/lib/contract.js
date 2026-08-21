/**
 * dsh-eval-defaults wire contract: strict Typert invocation descriptors
 * and the host manifest for the `evalDefaults` Remote namespace.
 *
 * Shared verbatim by both sides: the static client entry embeds INVOCATIONS
 * (lib/client.js) and the host entry imports TYPERT_MANIFEST (lib/index.js).
 */
const schema = (parse) => ({ parse })

const objectSchema = schema((v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('expected an object')
  return v
})
/** Every business method answers `{ ok, ... }` or `{ ok: false, error }`. */
const resultEnvelopeSchema = schema((v) => {
  if (v === null || typeof v !== 'object' || typeof v.ok !== 'boolean') throw new TypeError('expected an { ok, ... } envelope')
  return v
})

const codec = (name, sch) => ({ mode: 'strict', typeSymbol: `dsh-eval-defaults#${name}`, schema: sch })

const objectParam = (name) => ({
  name,
  wire: name,
  source: 'json',
  codec: codec('Object', objectSchema),
})

export const INVOCATIONS = [
  {
    id: 'dsh-eval-defaults#evalDefaults/getState',
    service: 'evalDefaults',
    namespace: 'evalDefaults',
    method: 'getState',
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'strict', typeSymbol: 'dsh-eval-defaults#GetStateResult', schema: resultEnvelopeSchema },
  },
  {
    id: 'dsh-eval-defaults#evalDefaults/setDefaults',
    service: 'evalDefaults',
    namespace: 'evalDefaults',
    method: 'setDefaults',
    invocation: { kind: 'direct' },
    parameters: [objectParam('patch')],
    result: { mode: 'strict', typeSymbol: 'dsh-eval-defaults#SetDefaultsResult', schema: resultEnvelopeSchema },
  },
]

/**
 * Host manifest registered through `ctx.typert.register`.
 */
export const TYPERT_MANIFEST = {
  package: 'dsh-eval-defaults',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'evalDefaults',
        exportName: 'EvalDefaultsRuntime',
        description: 'Read and write the default provider/model/reasoning effort used by dsh-eval evaluations.',
        tags: [],
        members: [
          { kind: 'method', name: 'getState', signature: 'getState(): Promise<object>' },
          { kind: 'method', name: 'setDefaults', signature: 'setDefaults(patch: object): Promise<object>' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: INVOCATIONS,
}
