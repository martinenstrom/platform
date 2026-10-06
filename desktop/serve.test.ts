/**
 * The application scheme's handler: a file under the client build is
 * served from disk and never from outside it; everything else reaches the
 * server on the internal origin and a redirect comes back on the
 * application's.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — the desktop host is plain JavaScript by design (no build step before Electron loads it).
import { createAppHandler, SERVER_ORIGIN, serverHeaders, staticFile } from './serve.mjs'

let clientDir: string

beforeAll(() => {
  clientDir = mkdtempSync(join(tmpdir(), 'fos-client-'))
  mkdirSync(join(clientDir, 'assets'))
  writeFileSync(join(clientDir, 'assets', 'app.css'), 'body{}')
  writeFileSync(join(clientDir, 'robots.txt'), 'ok')
})
afterAll(() => rmSync(clientDir, { recursive: true, force: true }))

describe('static files', () => {
  it('serves a file that exists under the client build', () => {
    expect(staticFile(clientDir, '/assets/app.css')).toMatch(/app\.css$/u)
    expect(staticFile(clientDir, '/robots.txt')).toMatch(/robots\.txt$/u)
  })
  it('never answers a path outside the build or a directory', () => {
    expect(staticFile(clientDir, '/../package.json')).toBeNull()
    expect(staticFile(clientDir, '/assets/../../etc')).toBeNull()
    expect(staticFile(clientDir, '/assets')).toBeNull()
    expect(staticFile(clientDir, '/%2e%2e/x')).toBeNull()
    expect(staticFile(clientDir, '/missing.js')).toBeNull()
  })
})

describe('the handler', () => {
  it('serves assets with immutable caching and the right type', async () => {
    const handle = createAppHandler({
      clientDir,
      fetch: async () => new Response('server'),
    })
    const res = await handle(new Request('app://financial-os/assets/app.css'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(await res.text()).toBe('body{}')
  })

  it('hands every other request to the server on the internal origin', async () => {
    const seen: string[] = []
    const handle = createAppHandler({
      clientDir,
      fetch: async (request: Request) => {
        seen.push(`${request.method} ${request.url}`)
        return new Response('page')
      },
    })
    await handle(new Request('app://financial-os/clients?view=alla'))
    await handle(
      new Request('app://financial-os/_serverFn/x', { method: 'POST', body: '{}' }),
    )
    expect(seen).toEqual([
      `GET ${SERVER_ORIGIN}/clients?view=alla`,
      `POST ${SERVER_ORIGIN}/_serverFn/x`,
    ])
  })

  it('marks a request from the window same-origin for the server’s CSRF guard — and one with no provenance, which is what the scheme hands over', async () => {
    const seen: Headers[] = []
    const handle = createAppHandler({
      clientDir,
      fetch: async (request: Request) => {
        seen.push(request.headers)
        return new Response('ok')
      },
    })
    /* A server function call from the window: origin and referer on the application scheme, no fetch-site. */
    await handle(
      new Request('app://financial-os/_serverFn/x', {
        method: 'POST',
        body: '{}',
        headers: { origin: 'app://financial-os', referer: 'app://financial-os/setup' },
      }),
    )
    expect(seen[0]!.get('origin')).toBe(SERVER_ORIGIN)
    expect(seen[0]!.get('referer')).toBe(`${SERVER_ORIGIN}/setup`)
    expect(seen[0]!.get('sec-fetch-site')).toBe('same-origin')
    /* A request that did not come from the window keeps what it carried and is judged as it stands. */
    const foreign = serverHeaders(
      new Headers({ origin: 'https://evil.example', referer: 'https://evil.example/x' }),
      'app://financial-os',
    )
    expect(foreign.get('origin')).toBe('https://evil.example')
    expect(foreign.get('referer')).toBe('https://evil.example/x')
    expect(foreign.get('sec-fetch-site')).toBeNull()
    /* Measured on the host: Electron's scheme strips origin, referer and fetch-site; the process is the provenance. */
    const bare = serverHeaders(new Headers({ 'content-type': 'application/json' }), 'app://financial-os')
    expect(bare.get('sec-fetch-site')).toBe('same-origin')
    expect(bare.get('origin')).toBeNull()
    /* A foreign fetch-site is kept for the server to refuse. */
    const crossSite = serverHeaders(new Headers({ 'sec-fetch-site': 'cross-site' }), 'app://financial-os')
    expect(crossSite.get('sec-fetch-site')).toBe('cross-site')
  })

  it('translates a redirect back to the application origin', async () => {
    const handle = createAppHandler({
      clientDir,
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: `${SERVER_ORIGIN}/sentinel` },
        }),
    })
    const res = await handle(new Request('app://financial-os/jarvis'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('app://financial-os/sentinel')
  })
})
