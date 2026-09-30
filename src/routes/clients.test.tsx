/**
 * Klienter is a first-class destination, and its pages reach the record
 * through one door.
 *
 * Read from the sources rather than rendered, like the home page's own
 * test: what must hold is a dependency, and an import is caught before it
 * becomes a panel. The route may name `infrastructure/advisory/serverFns`
 * and nothing else in the layer; the intelligence it shows is derived on
 * the server and arrives as data.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const ROUTES = [
  'src/routes/clients.index.tsx',
  'src/routes/clients.$clientId.tsx',
  'src/routes/clients.office.$officeId.tsx',
]

describe('the client routes', () => {
  it('exist in the generated tree, beside each other rather than nested', () => {
    const tree = read('src/routeTree.gen.ts')
    expect(tree).toMatch(/id: '\/clients\/',/)
    expect(tree).toMatch(/id: '\/clients\/\$clientId',/)
    /* The office book is a destination of its own, deep-linkable. */
    expect(tree).toMatch(/id: '\/clients\/office\/\$officeId',/)
  })

  it('reach the record only through the advisory door', () => {
    for (const path of ROUTES) {
      const source = read(path)
      const infrastructureImports = [
        ...source.matchAll(/from '~\/infrastructure\/([^']+)'/g),
      ].map((m) => m[1])
      expect(infrastructureImports).toEqual(['advisory/serverFns'])
      /* The client page derives nothing: no domain rule is called from a route. */
      expect(source).not.toMatch(/^import (?!type).*from '~\/domain\/advisory'/m)
      expect(source).not.toMatch(/from '~\/data\/mockData'/)
    }
  })

  it('shows the client through the command centre, the office book and the 360 view', () => {
    expect(read('src/routes/clients.index.tsx')).toMatch(/ClientCommandCentre/)
    expect(read('src/routes/clients.office.$officeId.tsx')).toMatch(/OfficeBook/)
    expect(read('src/routes/clients.$clientId.tsx')).toMatch(/Client360/)
  })

  it('keeps the view of the book in the URL, so a book can be linked', () => {
    expect(read('src/routes/clients.index.tsx')).toMatch(/validateSearch/)
  })
})

describe('Klienter in the navigation', () => {
  it('is one of the primary destinations, once', () => {
    const navigation = read('src/lib/navigation.ts')
    expect(navigation.match(/to:\s*'\/clients'/g)).toHaveLength(1)
    expect(navigation).toMatch(/label:\s*'Klienter'/)
  })
})

describe('the client surfaces keep the presentation boundary', () => {
  it('import no infrastructure but the door, and no value from the domain', () => {
    const dir = resolve(process.cwd(), 'src/components/clients')
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      const source = read(`src/components/clients/${file}`)
      expect(source, file).not.toMatch(/from '~\/infrastructure\//)
      expect(source, file).not.toMatch(/^import (?!type).*from '~\/domain\//m)
      expect(source, file).not.toMatch(/^import (?!type).*from '~\/application\//m)
    }
  })
})
