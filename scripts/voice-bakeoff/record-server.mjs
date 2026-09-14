/**
 * Serves the recorder page on localhost and saves what it records.
 *
 * `localhost` is a secure context, so the microphone works without a
 * certificate; each recording is POSTed back and written straight into
 * `recordings/`, which is ignored by git. Nothing here touches the product.
 *
 *   node scripts/voice-bakeoff/record-server.mjs
 *   → open http://localhost:4174/
 */

import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, RECORDINGS } from './lib.mjs'

mkdirSync(RECORDINGS, { recursive: true })

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.mjs': 'text/javascript' }

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')

  if (request.method === 'POST' && /^\/recordings\/\d\d\.webm$/.test(url.pathname)) {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const file = join(RECORDINGS, url.pathname.slice('/recordings/'.length))
      writeFileSync(file, Buffer.concat(chunks))
      console.log('saved', file, `${Buffer.concat(chunks).length} bytes`)
      response.writeHead(204).end()
    })
    return
  }

  const path = url.pathname === '/' ? '/record.html' : url.pathname
  if (!/^\/(record\.html|utterances\.json)$/.test(path)) {
    response.writeHead(404).end()
    return
  }
  const extension = path.slice(path.lastIndexOf('.'))
  response.writeHead(200, { 'content-type': TYPES[extension] ?? 'application/octet-stream' })
  response.end(readFileSync(join(HERE, path)))
}).listen(4174, () => console.log('recorder at http://localhost:4174/  — recordings land in', RECORDINGS))
