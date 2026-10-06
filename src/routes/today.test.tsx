/**
 * Idag is a first-class workspace beside the market, reads through the
 * advisory door only, keeps the presentation boundary, and the start page
 * stays the market — read from the sources, as Sentinel's own test does.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('the Idag routes', () => {
  it('exist in the generated tree, the call brief beside the day and not beneath it', () => {
    const tree = read('src/routeTree.gen.ts')
    expect(tree).toMatch(/id: '\/today',/)
    expect(tree).toMatch(/'\/today_\/call\/\$clientId'/)
  })

  it('reach the record only through the advisory door and derive nothing themselves', () => {
    for (const path of ['src/routes/today.tsx', 'src/routes/today_.call.$clientId.tsx']) {
      const source = read(path)
      const infrastructureImports = [...source.matchAll(/from '~\/infrastructure\/([^']+)'/g)].map(
        (m) => m[1],
      )
      expect(infrastructureImports, path).toEqual(['advisory/serverFns'])
      expect(source, path).not.toMatch(/^import (?!type).*from '~\/domain\//m)
      expect(source, path).not.toMatch(/^import (?!type).*from '~\/application\//m)
    }
  })

  it('is one destination, named Idag, in the primary navigation and the rail — and the start page is still the market', () => {
    const navigation = read('src/lib/navigation.ts')
    expect(navigation.match(/to:\s*'\/today'/g)).toHaveLength(1)
    expect(navigation).toMatch(/label:\s*'Idag'/)
    const primary = navigation.slice(navigation.indexOf('export const primaryNav'))
    expect(primary).toMatch(/\[MARKET, TODAY, /)
    const rail = navigation.slice(navigation.indexOf('export const globalRail'))
    expect(rail).toMatch(/TODAY,/)
    /* The market keeps the first place in both. */
    expect(primary.indexOf('MARKET')).toBeLessThan(primary.indexOf('TODAY'))
    expect(rail.indexOf('MARKET')).toBeLessThan(rail.indexOf('TODAY'))
  })
})

describe('the Idag surfaces keep the presentation boundary', () => {
  it('import no infrastructure and no value from the domain or the application', () => {
    for (const file of ['DailyCommand.tsx', 'CallBriefView.tsx']) {
      const source = read(`src/components/today/${file}`)
      expect(source, file).not.toMatch(/from '~\/infrastructure\//)
      expect(source, file).not.toMatch(/^import (?!type).*from '~\/domain\//m)
      expect(source, file).not.toMatch(/^import (?!type).*from '~\/application\//m)
    }
  })

  it('shows bands and horizons as words, never a score', () => {
    const source = read('src/components/today/DailyCommand.tsx')
    expect(source).not.toMatch(/action\.score|priority\.score|\.score\b/)
    expect(source).toMatch(/BAND_LABEL/)
    expect(source).toMatch(/HORIZON_LABEL/)
  })
})
