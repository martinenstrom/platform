/**
 * The application's own scheme, answered in-process.
 *
 * Every request the window makes — a page, a server function, an asset —
 * arrives here as a Fetch `Request`. A file that exists under the client
 * build is served from disk; everything else goes to the TanStack Start
 * server handler, which renders the page or runs the server function in
 * this very process. No socket is opened, no port is chosen, nothing
 * listens: the "server" is a function call.
 */

import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

/** The file under `clientDir` a path names, or null: never outside the directory, never a directory. */
export function staticFile(clientDir, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const root = resolve(clientDir)
  const candidate = normalize(join(root, decoded))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  try {
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}

function fileResponse(file, headOnly) {
  const stat = statSync(file)
  const ext = extname(file).toLowerCase()
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': String(stat.size),
    'cache-control': file.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  }
  if (headOnly) return new Response(null, { status: 200, headers })
  return new Response(Readable.toWeb(createReadStream(file)), { status: 200, headers })
}

/**
 * The origin the server sees. A request over the application scheme has
 * an opaque origin in Node (`new URL('app://x/y').origin === 'null'`), and
 * the router builds its base from the origin; so the server is handed the
 * same request on an internal, unroutable http origin, and a redirect it
 * answers with is translated back before the window sees it.
 */
export const SERVER_ORIGIN = 'http://financial-os.local'

function toServerUrl(url, appOrigin) {
  return url.startsWith(appOrigin) ? SERVER_ORIGIN + url.slice(appOrigin.length) : url
}

function toAppUrl(url, appOrigin) {
  return url.startsWith(SERVER_ORIGIN) ? appOrigin + url.slice(SERVER_ORIGIN.length) : url
}

/**
 * The headers the server judges a request's provenance by. Its CSRF guard
 * reads `Sec-Fetch-Site`, then `Origin`, then `Referer`, against the
 * request URL's origin, and refuses a request that carries none of them.
 * Measured: a request handed to the scheme handler by Electron carries
 * none of them — the scheme strips them — so every server function call
 * from the window was answered 403 Forbidden.
 *
 * Here the provenance is the process: the scheme is served to this
 * application's own window and to nothing else, so a request with no
 * provenance headers came from that window and is marked same-origin.
 * One that names the application scheme is translated with the URL. One
 * that carries a foreign origin keeps it and is judged as it stands.
 */
export function serverHeaders(headers, appOrigin) {
  const out = new Headers(headers)
  const origin = out.get('origin')
  const referer = out.get('referer')
  const fetchSite = out.get('sec-fetch-site')
  const fromWindow =
    origin === appOrigin ||
    (referer !== null && referer.startsWith(`${appOrigin}/`)) ||
    (origin === null && referer === null && fetchSite === null)
  if (origin === appOrigin) out.set('origin', SERVER_ORIGIN)
  if (referer !== null && referer.startsWith(appOrigin))
    out.set('referer', toServerUrl(referer, appOrigin))
  if (fromWindow) out.set('sec-fetch-site', 'same-origin')
  return out
}

/**
 * The handler for the scheme: static client files first, the server for
 * the rest. `fetch` is the built server's own `fetch`; `appOrigin` is the
 * window's origin on the application scheme.
 */
export function createAppHandler({ clientDir, fetch, appOrigin = 'app://financial-os' }) {
  return async (request) => {
    const url = new URL(request.url)
    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = staticFile(clientDir, url.pathname)
      if (file) return fileResponse(file, request.method === 'HEAD')
    }
    /* An explicit init: a Request passed as init loses its method and body in Node's fetch. */
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const forwarded = new Request(toServerUrl(request.url, appOrigin), {
      method: request.method,
      headers: serverHeaders(request.headers, appOrigin),
      body: hasBody ? request.body : null,
      duplex: hasBody ? 'half' : undefined,
      signal: request.signal,
    })
    const response = await fetch(forwarded)
    const location = response.headers.get('location')
    if (location && location.startsWith(SERVER_ORIGIN)) {
      const headers = new Headers(response.headers)
      headers.set('location', toAppUrl(location, appOrigin))
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    return response
  }
}
