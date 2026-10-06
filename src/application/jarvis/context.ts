/**
 * Where the advisor is, as JARVIS must know it.
 *
 * JARVIS is the intelligence layer of Financial OS, not a chat window beside
 * it: the workspace on screen decides what a question is about. "Vad ska
 * jag ta upp på mötet?" asked on a client's page is about that client, and
 * nobody should have to type the name. This is the typed context — a scope
 * and identifiers, never a copy of the client — resolved deterministically
 * from the route, in the browser for the presence's indicator and quick
 * actions and again on the server for the answer. The server re-resolves
 * from the route the browser sends, the way it re-reads a case reference:
 * the context is a pointer, never an authority.
 */

export type JarvisScope =
  | 'GLOBAL'
  | 'MARKET'
  | 'CLIENT_DIRECTORY'
  | 'OFFICE'
  | 'CLIENT'
  | 'MEETING'
  | 'SENTINEL'
  | 'MARKET_IMPACT'

/** What JARVIS can answer from the evidence a scope reaches. */
export type JarvisCapability =
  | 'client-summary'
  | 'last-interaction'
  | 'open-commitments'
  | 'meeting-prep'
  | 'changes-since-last-meeting'
  | 'why-priority'
  | 'market-relevance'
  | 'financing'
  | 'goals'
  | 'opportunities'
  | 'risks'
  | 'questions'
  | 'key-figures'
  | 'client-memory'
  | 'office-priorities'
  | 'directory-priorities'
  /** The book's lifecycle: new, onboarding, former, moved, reactivated, what changed. */
  | 'book-lifecycle'
  | 'sentinel-queue'
  | 'market-impact'
  | 'market'
  | 'institution'

export interface JarvisContext {
  scope: JarvisScope
  /** The route the context was resolved from: pathname and search. */
  route: string
  officeId?: string
  clientId?: string
  /** The scheduled meeting's event id, when the server has resolved it. */
  meetingId?: string
  currentView?: 'kontor' | 'alla'
  capabilities: readonly JarvisCapability[]
}

const CLIENT_CAPABILITIES: readonly JarvisCapability[] = [
  'client-summary',
  'last-interaction',
  'open-commitments',
  'meeting-prep',
  'changes-since-last-meeting',
  'why-priority',
  'market-relevance',
  'financing',
  'goals',
  'opportunities',
  'risks',
  'questions',
  'key-figures',
  'client-memory',
  'market',
  'institution',
]

const CAPABILITIES: Record<JarvisScope, readonly JarvisCapability[]> = {
  GLOBAL: ['market', 'institution'],
  MARKET: ['market', 'institution'],
  CLIENT_DIRECTORY: [
    'directory-priorities',
    'book-lifecycle',
    'sentinel-queue',
    'market',
    'institution',
  ],
  OFFICE: ['office-priorities', 'book-lifecycle', 'sentinel-queue', 'market', 'institution'],
  CLIENT: CLIENT_CAPABILITIES,
  MEETING: CLIENT_CAPABILITIES,
  SENTINEL: ['sentinel-queue', 'why-priority', 'market', 'institution'],
  MARKET_IMPACT: ['market-impact', 'market', 'institution'],
}

/** The scopes the advisory record answers in Tier 0, before any model. */
export const ADVISORY_SCOPES: readonly JarvisScope[] = [
  'CLIENT_DIRECTORY',
  'OFFICE',
  'CLIENT',
  'MEETING',
  'SENTINEL',
  'MARKET_IMPACT',
]

export function isAdvisoryScope(scope: JarvisScope): boolean {
  return ADVISORY_SCOPES.includes(scope)
}

/** The scope and identifiers a route names, deterministically; GLOBAL for a route JARVIS does not know. */
export function resolveJarvisContext(route: string): JarvisContext {
  const [pathname = '/', search = ''] = route.split('?', 2)
  const parts = pathname.split('/').filter(Boolean)
  const at = (scope: JarvisScope, over: Partial<JarvisContext> = {}): JarvisContext => ({
    scope,
    route,
    capabilities: CAPABILITIES[scope],
    ...over,
  })

  if (parts.length === 0) return at('MARKET')
  const [head, second, third] = parts
  if (head === 'clients') {
    if (!second) {
      const view = /(?:^|&)view=alla(?:&|$)/.test(search) ? 'alla' : 'kontor'
      return at('CLIENT_DIRECTORY', { currentView: view })
    }
    if (second === 'office')
      return third ? at('OFFICE', { officeId: third }) : at('CLIENT_DIRECTORY')
    /* The cockpit and the pack preview are both about the meeting. */
    if (third === 'meeting-prep' || third === 'meeting-pack')
      return at('MEETING', { clientId: second })
    return at('CLIENT', { clientId: second })
  }
  if (head === 'sentinel') return at('SENTINEL')
  if (head === 'market-impact') return at('MARKET_IMPACT')
  if (head === 'markets' || head === 'watchlist') return at('MARKET')
  return at('GLOBAL')
}
