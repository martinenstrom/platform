/**
 * Node-only transport for the real `avanza-mcp` server (see the user-private
 * MCP registration this project's Claude Code session set up — this file is
 * the app's OWN connection, independent of that editor integration).
 *
 * IMPORTANT: this module spawns a child process and must never reach the
 * browser bundle. It is only ever imported via a dynamic `import()` inside a
 * `createServerFn` handler in `./serverFns.ts` — never imported statically
 * from `avanzaMcpAdapter.ts` or any client-reachable module. That is a
 * deliberate belt-and-braces guard on top of TanStack Start's own
 * server/client code-splitting for `createServerFn`.
 *
 * `avanza-mcp` (PyPI) wraps Avanza's public, unauthenticated market-data API
 * (avanza.se) — no login, no account/portfolio access. It is run via `uvx`
 * (from `uv`, https://astral.sh), which must be installed and resolvable —
 * either on PATH, or pointed at explicitly via `AVANZA_MCP_UVX_PATH` (set
 * this in a local, gitignored `.env` file; do not hardcode a machine-specific
 * path here).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const UVX_COMMAND = process.env.AVANZA_MCP_UVX_PATH ?? 'uvx'

let clientPromise: Promise<Client> | null = null

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StdioClientTransport({
        command: UVX_COMMAND,
        args: ['--prerelease=allow', 'avanza-mcp'],
      })
      const client = new Client({ name: 'stock-template', version: '0.1.0' })
      await client.connect(transport)
      return client
    })()
    // If connecting fails, allow a later call to retry instead of caching the rejection forever.
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

interface ToolResult {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

/**
 * Calls one `avanza-mcp` tool and returns its structured result.
 * Reuses a single long-lived connection across calls (spawning `uvx` per
 * call would add ~1-2s of process-startup latency to every request).
 */
export async function callAvanzaTool<TResult>(
  name: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  const client = await getClient()
  const result = (await client.callTool({ name, arguments: args })) as ToolResult

  if (result.isError) {
    const message = result.content?.find((c) => c.type === 'text')?.text
    throw new Error(`avanza-mcp tool "${name}" failed: ${message ?? 'unknown error'}`)
  }

  if (result.structuredContent !== undefined) {
    return result.structuredContent as TResult
  }

  const text = result.content?.find((c) => c.type === 'text')?.text
  if (text === undefined) {
    throw new Error(`avanza-mcp tool "${name}" returned no content.`)
  }
  return JSON.parse(text) as TResult
}
