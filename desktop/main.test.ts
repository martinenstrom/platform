/**
 * The desktop host names the application before it resolves any path:
 * Electron keeps a person's data under `%APPDATA%\<app name>`, and the name
 * must be the product's, never package.json's. Measured once on an installed
 * build, where the data root landed under a template's name. The guard is
 * textual — the host is plain JavaScript that only Electron can run — and
 * it holds the order, not just the presence.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'desktop/main.mjs'), 'utf8')

describe('the desktop host', () => {
  it('sets the application name to the product’s before the single-instance lock and any path', () => {
    const setName = source.indexOf("app.setName('Financial OS')")
    expect(setName).toBeGreaterThan(-1)
    for (const later of ['app.requestSingleInstanceLock(', "app.getPath('userData')", 'dataLayout(']) {
      const at = source.indexOf(later)
      expect(at, later).toBeGreaterThan(setName)
    }
  })

  it('resolves the data root under the operating system’s application-data folder, by product name', () => {
    expect(source).toMatch(/join\(app\.getPath\('userData'\), 'Financial OS'\)/)
    /* Never the package's name: the data root is the product's whatever package.json says. */
    expect(source).not.toMatch(/stock-template|setName\('financial-os'\)|setName\(pkg/)
  })

  it('runs the packaged application in desktop mode, in production, with no port', () => {
    expect(source).toMatch(/FINANCIAL_OS_MODE\s*=\s*process\.env\.FINANCIAL_OS_MODE\s*\|\|\s*'desktop'/)
    expect(source).toMatch(/process\.env\.NODE_ENV\s*=\s*'production'/)
    expect(source).not.toMatch(/\.listen\(|localhost:\d+/)
  })
})
