/**
 * The route decides what JARVIS is looking at — deterministically, with the
 * identifiers the route names and nothing copied from the record.
 */

import { describe, expect, it } from 'vitest'
import { isAdvisoryScope, resolveJarvisContext } from './context'

describe('resolveJarvisContext', () => {
  it('reads the market landing page and the firm as the market and the institution', () => {
    expect(resolveJarvisContext('/')).toMatchObject({ scope: 'MARKET', route: '/' })
    expect(resolveJarvisContext('/headquarters').scope).toBe('GLOBAL')
    expect(resolveJarvisContext('/evidence').scope).toBe('GLOBAL')
    expect(isAdvisoryScope('MARKET')).toBe(false)
  })

  it('reads the relationship book, whole or by office', () => {
    expect(resolveJarvisContext('/clients')).toMatchObject({
      scope: 'CLIENT_DIRECTORY',
      currentView: 'kontor',
    })
    expect(resolveJarvisContext('/clients?view=alla')).toMatchObject({
      scope: 'CLIENT_DIRECTORY',
      currentView: 'alla',
    })
    expect(resolveJarvisContext('/clients/office/of-strandvagen')).toMatchObject({
      scope: 'OFFICE',
      officeId: 'of-strandvagen',
    })
  })

  it('reads a client and the meeting being prepared for that client', () => {
    expect(resolveJarvisContext('/clients/cl-dahlqvist')).toMatchObject({
      scope: 'CLIENT',
      clientId: 'cl-dahlqvist',
    })
    expect(resolveJarvisContext('/clients/cl-dahlqvist/meeting-prep')).toMatchObject({
      scope: 'MEETING',
      clientId: 'cl-dahlqvist',
    })
    /* The pack preview is about the meeting too, whatever its search. */
    expect(
      resolveJarvisContext('/clients/cl-dahlqvist/meeting-pack?depth=full&format=pptx'),
    ).toMatchObject({ scope: 'MEETING', clientId: 'cl-dahlqvist' })
    expect(resolveJarvisContext('/clients/cl-dahlqvist').meetingId).toBeUndefined()
  })

  it('reads Sentinel and Marknadspåverkan', () => {
    expect(resolveJarvisContext('/sentinel').scope).toBe('SENTINEL')
    expect(resolveJarvisContext('/market-impact').scope).toBe('MARKET_IMPACT')
  })

  it('names what each scope can answer, and the market everywhere', () => {
    const client = resolveJarvisContext('/clients/cl-dahlqvist')
    expect(client.capabilities).toEqual(
      expect.arrayContaining([
        'meeting-prep',
        'last-interaction',
        'open-commitments',
        'market',
      ]),
    )
    expect(resolveJarvisContext('/clients/office/of-x').capabilities).toEqual(
      expect.arrayContaining(['office-priorities', 'market']),
    )
    expect(resolveJarvisContext('/sentinel').capabilities).not.toContain('meeting-prep')
  })
})
