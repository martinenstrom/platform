/**
 * Sentinel is a destination of the JARVIS workspace, reads through the
 * advisory door only, and the home page carries none of it — read from the
 * sources, as the home page's own test does.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('the Sentinel route', () => {
  it('exists in the generated tree', () => {
    expect(read('src/routeTree.gen.ts')).toMatch(/id: '\/sentinel',/)
  })

  it('reaches the record only through the advisory door and derives nothing itself', () => {
    const source = read('src/routes/sentinel.tsx')
    const infrastructureImports = [
      ...source.matchAll(/from '~\/infrastructure\/([^']+)'/g),
    ].map((m) => m[1])
    expect(infrastructureImports).toEqual(['advisory/serverFns'])
    expect(source).not.toMatch(/^import (?!type).*from '~\/domain\//m)
    expect(source).not.toMatch(/^import (?!type).*from '~\/application\//m)
  })

  it('is one of the JARVIS workspace destinations, once', () => {
    const navigation = read('src/lib/navigation.ts')
    expect(navigation.match(/to:\s*'\/sentinel'/g)).toHaveLength(1)
    expect(navigation).toMatch(/label:\s*'Sentinel'/)
  })
})

describe('the home page and the JARVIS workspace', () => {
  /*
   * For one stage the market command centre carried Sentinel's priorities
   * and Market-to-Client's episodes as modules, and became a client page
   * with a globe on it. The ruling that followed: the home page is the
   * market, clients are the JARVIS workspace's, and the only thing the
   * market screen may carry about them is the muted count beside a row.
   */
  it('reads no Sentinel brief and keeps the market screen intact', () => {
    const route = read('src/routes/index.tsx')
    expect(route).not.toMatch(/getSentinelBriefFn/)
    expect(route).toMatch(/LightCommandCenter/)
    expect(route).toMatch(/getOverviewSnapshotFn/)
    /* The row marks still come through the advisory door, and only they. */
    expect(route).toMatch(/getMarketImpactFn/)
    expect(route).toMatch(/from '~\/infrastructure\/advisory\/serverFns'/)
  })

  it('renders no client module and no client greeting', () => {
    const dashboard = read('src/components/lightDashboard/LightCommandCenter.tsx')
    expect(dashboard).not.toMatch(/SentinelBriefList|SentinelGreeting/)
    expect(dashboard).not.toMatch(/title="Klientprioriteringar"|title="Marknadspåverkan"/)
    expect(dashboard).not.toMatch(/MarketImpactList|dashboardEpisodes/)
    /* The pointer that remains: a count beside a row, nothing more. */
    expect(dashboard).toMatch(/AffectedClientsMark/)
  })

  it('reaches Sentinel through the JARVIS gateway, not the primary rail', () => {
    const navigation = read('src/lib/navigation.ts')
    const jarvis = navigation.slice(
      navigation.indexOf('export const jarvisNav'),
      navigation.indexOf('export const jarvisGateway'),
    )
    expect(jarvis).toMatch(/to:\s*'\/sentinel'/)
    expect(jarvis).toMatch(/to:\s*'\/market-impact'/)
    const primary = navigation.slice(navigation.indexOf('export const primaryNav'))
    expect(primary).not.toMatch(/to:\s*'\/sentinel'/)
    expect(primary).toMatch(/jarvisGateway/)
  })
})

describe('the Sentinel surfaces keep the presentation boundary', () => {
  it('import no infrastructure and no value from the domain or the application', () => {
    for (const file of ['SentinelBrief.tsx', 'SentinelQueue.tsx', 'sentinelActions.ts']) {
      const source = read(`src/components/sentinel/${file}`)
      expect(source, file).not.toMatch(/from '~\/infrastructure\//)
      expect(source, file).not.toMatch(/^import (?!type).*from '~\/domain\//m)
      expect(source, file).not.toMatch(/^import (?!type).*from '~\/application\//m)
    }
  })
})
