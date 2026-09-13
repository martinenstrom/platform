/**
 * A route nested under a page that renders no `<Outlet/>` never renders.
 *
 * Measured on 2026-09-13: `/cases/$caseId/underlag` had been a child of
 * `/cases/$caseId` since the record was split out of the room, and the room
 * renders no outlet — so the Underlag deep link showed the Boardroom, on every
 * case, from the day it was created. Every suite was green throughout, because
 * every suite rendered the component and none rendered the route. This reads
 * the generated tree instead, which is the only place the nesting exists.
 *
 * The rule: a file route whose parent is another file route must find an
 * `<Outlet` in that parent's source. A route that should not nest un-nests by
 * the router's own convention — a trailing `_` on the parent segment, as
 * `agents_.$departmentId.commission.tsx` and `cases.$caseId_.underlag.tsx` do.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const tree = read('src/routeTree.gen.ts')

/** `import { Route as XRouteImport } from './routes/x'` → X → routes/x */
const importPaths = new Map<string, string>()
for (const match of tree.matchAll(
  /import \{ Route as (\w+)Import \} from '\.\/routes\/([^']+)'/g,
)) {
  importPaths.set(match[1]!, `src/routes/${match[2]!}.tsx`)
}

/** `const XRoute = XRouteImport.update({ id, path, getParentRoute: () => Y })` */
const routes = [
  ...tree.matchAll(
    /const (\w+) =\s*\w+Import\.update\(\{\s*id: '([^']+)',\s*path: '([^']+)',\s*getParentRoute: \(\) => (\w+),/g,
  ),
].map((match) => ({
  name: match[1]!,
  id: match[2]!,
  path: match[3]!,
  parent: match[4]!,
}))

describe('file routes only nest under pages that render an outlet', () => {
  it('parses every route in the generated tree', () => {
    /*
     * A parse that quietly matched nothing would make the rule below vacuous.
     * Checked by id, not path: a nested child's generated `path` is relative
     * to its parent (`/underlag`), and this must hold in the broken state too.
     */
    expect(routes.length).toBeGreaterThan(10)
    expect(routes.some((route) => route.id.endsWith('/underlag'))).toBe(true)
  })

  it('finds an <Outlet in every parent that is not the root', () => {
    const offenders = routes
      .filter((route) => route.parent !== 'rootRouteImport')
      .map((route) => {
        const parentFile = importPaths.get(route.parent)
        const parentSource = parentFile ? read(parentFile) : ''
        return { ...route, parentFile, rendersOutlet: /<Outlet\b/.test(parentSource) }
      })
      .filter((route) => !route.rendersOutlet)
      .map((route) => `${route.id} under ${route.parentFile ?? route.parent}`)
    expect(offenders).toEqual([])
  })

  it('keeps the record beside the room, not beneath it', () => {
    /*
     * Named, so a future re-nesting fails by its own name rather than as an
     * anonymous entry in the list above. The room and the record are two
     * surfaces over one read model; neither is a frame for the other.
     */
    const record = routes.find((route) => route.path === '/cases/$caseId/underlag')
    expect(record?.parent).toBe('rootRouteImport')
    expect(record?.id).toBe('/cases/$caseId_/underlag')
  })
})
