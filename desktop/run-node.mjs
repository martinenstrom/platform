/**
 * The built application hosted by plain Node on the loopback interface —
 * for `npm start`, for a server-side smoke test, and for anyone running
 * Financial OS without the desktop host. The desktop host itself never
 * uses this: it answers the window's requests in-process over the
 * application scheme (see `main.mjs` and `serve.mjs`).
 *
 *   FINANCIAL_OS_DATA_DIR=… PORT=3000 node desktop/run-node.mjs
 */

import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createAppHandler } from './serve.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'

const server = (
  await import(pathToFileURL(join(appRoot, 'dist', 'server', 'server.js')).href)
).default
const handle = createAppHandler({
  clientDir: join(appRoot, 'dist', 'client'),
  fetch: (request) => server.fetch(request),
})

createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? `${host}:${port}`}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) for (const v of value) headers.append(key, v)
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : Readable.toWeb(req)
  const response = await handle(
    new Request(url, { method: req.method, headers, body, duplex: 'half' }),
  )
  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (response.body) Readable.fromWeb(response.body).pipe(res)
  else res.end()
}).listen(port, host, () => {
  console.log(`Financial OS on http://${host}:${port}`)
})
