/**
 * The request that opens a live voice session, checked field by field.
 *
 * The browser may send an SDP offer, a voice name, and the case pointer the
 * conversation is already bound to — so a spoken "var står det?" reads the
 * same case a typed question opened. It may send nothing else: a field the
 * contract does not name — an actor, an operator, a command — is refused by
 * name, not ignored, the way `parseHostRequest` refuses it for the typed
 * presence. A reference is a pointer the firm re-reads, never an authority.
 */

import type { DomainReference } from '~/application/analysis/domainSystem'

export interface LiveOpenRequest {
  sdp: string
  voice?: string
  reference?: DomainReference
  /** Where the advisor is when the session opens; the server resolves the workspace from the route. */
  context?: { route: string }
}

const MAX_ROUTE = 400

/** `{ route }` and nothing else: a path the server resolves, never an id the browser chose. */
export function parseRouteContext(value: unknown): { route: string } | null {
  if (!isRecord(value)) return null
  if (Object.keys(value).length !== 1) return null
  if (
    typeof value.route !== 'string' ||
    !value.route.startsWith('/') ||
    value.route.length > MAX_ROUTE
  )
    return null
  return { route: value.route }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseReference(value: unknown): DomainReference | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value).sort()
  if (keys.join(',') !== 'id,kind,provenanceId,system') return null
  if (value.system !== 'financial-os' || value.kind !== 'case') return null
  if (typeof value.id !== 'string' || typeof value.provenanceId !== 'string') return null
  return {
    system: 'financial-os',
    kind: 'case',
    id: value.id,
    provenanceId: value.provenanceId,
  }
}

export function parseLiveOpenRequest(
  input: unknown,
): { ok: true; request: LiveOpenRequest } | { ok: false; field: string } {
  if (!isRecord(input)) return { ok: false, field: '' }
  for (const key of Object.keys(input)) {
    if (key !== 'sdp' && key !== 'voice' && key !== 'reference' && key !== 'context')
      return { ok: false, field: key }
  }
  if (typeof input.sdp !== 'string' || input.sdp.trim().length === 0)
    return { ok: false, field: 'sdp' }
  if (input.voice !== undefined && typeof input.voice !== 'string')
    return { ok: false, field: 'voice' }
  let reference: DomainReference | undefined
  if (input.reference !== undefined) {
    const parsed = parseReference(input.reference)
    if (!parsed) return { ok: false, field: 'reference' }
    reference = parsed
  }
  let context: { route: string } | undefined
  if (input.context !== undefined && input.context !== null) {
    const parsed = parseRouteContext(input.context)
    if (!parsed) return { ok: false, field: 'context' }
    context = parsed
  }
  return {
    ok: true,
    request: {
      sdp: input.sdp,
      ...(input.voice ? { voice: input.voice } : {}),
      ...(reference ? { reference } : {}),
      ...(context ? { context } : {}),
    },
  }
}
