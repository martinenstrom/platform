/**
 * Sentinel is a destination, reads through the advisory door only, and the
 * home page reaches its brief through the same door — read from the
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

  it('is one of the primary destinations, once', () => {
    const navigation = read('src/lib/navigation.ts')
    expect(navigation.match(/to:\s*'\/sentinel'/g)).toHaveLength(1)
    expect(navigation).toMatch(/label:\s*'Sentinel'/)
  })
})

describe('the home page and Sentinel', () => {
  it('reads the brief through the advisory door and keeps the market screen intact', () => {
    const route = read('src/routes/index.tsx')
    expect(route).toMatch(/getSentinelBriefFn/)
    expect(route).toMatch(/from '~\/infrastructure\/advisory\/serverFns'/)
    expect(route).toMatch(/LightCommandCenter/)
    expect(route).toMatch(/getOverviewSnapshotFn/)
  })

  it('renders the client half only when the record answered', () => {
    const dashboard = read('src/components/lightDashboard/LightCommandCenter.tsx')
    expect(dashboard).toMatch(/\{sentinel && \(/)
    expect(dashboard).toMatch(/\{sentinel && <SentinelGreeting/)
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
