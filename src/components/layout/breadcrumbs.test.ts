/**
 * The workspace bar's one hierarchy: JARVIS › KLIENTER › STRANDVÄGEN ›
 * CLIENT 360 › FÖRBERED MÖTE, derived from the route and the office the
 * loaded page belongs to — the same for the way in through the office
 * and for a direct link.
 */

import { describe, expect, it } from 'vitest'
import { breadcrumbs } from './AppTopBar'

const STRANDVAGEN = { id: 'of-strandvagen', label: 'Strandvägen' }

describe('breadcrumbs', () => {
  it('reads the relationship book', () => {
    expect(breadcrumbs('/clients').map((c) => c.label)).toEqual(['JARVIS', 'Klienter'])
  })

  it('reads an office book by the office’s name, linking to it', () => {
    const crumbs = breadcrumbs('/clients/office/of-strandvagen', STRANDVAGEN)
    expect(crumbs.map((c) => c.label)).toEqual(['JARVIS', 'Klienter', 'Strandvägen'])
    expect(crumbs[2]?.to).toBe('/clients/office/of-strandvagen')
    /* Before the office is known, the id stands in rather than nothing. */
    expect(breadcrumbs('/clients/office/of-strandvagen').map((c) => c.label)).toEqual([
      'JARVIS',
      'Klienter',
      'of-strandvagen',
    ])
  })

  it('puts the client’s office between the book and the dossier', () => {
    const crumbs = breadcrumbs('/clients/cl-berglund', STRANDVAGEN)
    expect(crumbs.map((c) => c.label)).toEqual([
      'JARVIS',
      'Klienter',
      'Strandvägen',
      'Client 360',
    ])
    expect(crumbs[2]?.to).toBe('/clients/office/of-strandvagen')
    expect(crumbs[3]?.to).toBe('/clients/cl-berglund')
    /* A direct link before the office is known still reads as a dossier. */
    expect(breadcrumbs('/clients/cl-berglund').map((c) => c.label)).toEqual([
      'JARVIS',
      'Klienter',
      'Client 360',
    ])
  })

  it('continues into the cockpit', () => {
    expect(
      breadcrumbs('/clients/cl-berglund/meeting-prep', STRANDVAGEN).map((c) => c.label),
    ).toEqual(['JARVIS', 'Klienter', 'Strandvägen', 'Client 360', 'Förbered möte'])
  })

  it('names the other doors of the workspace and the rest of the product', () => {
    expect(breadcrumbs('/sentinel').map((c) => c.label)).toEqual(['JARVIS', 'Sentinel'])
    expect(breadcrumbs('/market-impact').map((c) => c.label)).toEqual([
      'JARVIS',
      'Marknadspåverkan',
    ])
    expect(breadcrumbs('/evidence').map((c) => c.label)).toEqual(['Underlag'])
    expect(breadcrumbs('/').map((c) => c.label)).toEqual(['Kommandocentral'])
  })
})
