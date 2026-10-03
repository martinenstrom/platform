/**
 * The research adapters' own HTTP seam: text and JSON over `fetch`, with
 * the same two guards the market-data client has — a network switch that
 * refuses every request, and credentials only ever in headers — and
 * nothing of the provider registry. Research is not a market-data provider,
 * so it does not reach into that directory; the import-graph fitness rule
 * (`nothing outside the composition root imports a concrete provider`) is
 * what keeps the two apart.
 */

import { PublicResearchUnavailable } from '~/application/jarvis/research/publicSearch'

export interface ResearchHttp {
  getText(
    url: string,
    signal: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<string>
  getJson<T>(
    url: string,
    signal: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<T>
}

export interface ResearchHttpOptions {
  /** When true, every request fails at once as `disabled`; for tests and offline environments. */
  networkDisabled: boolean
  /** Injected so tests never depend on a real global. */
  fetchImpl?: typeof fetch
}

export function createResearchHttp(options: ResearchHttpOptions): ResearchHttp {
  const doFetch = options.fetchImpl ?? globalThis.fetch

  async function request(
    url: string,
    signal: AbortSignal,
    headers: Record<string, string>,
  ): Promise<Response> {
    if (options.networkDisabled)
      throw new PublicResearchUnavailable('disabled', 'network disabled')
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers,
        signal,
        redirect: 'follow',
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      throw new PublicResearchUnavailable(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
        `${url}: ${String(error).slice(0, 120)}`,
      )
    }
    if (!response.ok)
      throw new PublicResearchUnavailable(
        response.status >= 500 ? 'network' : 'refused',
        `${response.status} ${url}`,
      )
    return response
  }

  return {
    async getText(url, signal, headers = {}) {
      return (await request(url, signal, headers)).text()
    },
    async getJson<T>(
      url: string,
      signal: AbortSignal,
      headers: Record<string, string> = {},
    ) {
      const response = await request(url, signal, {
        accept: 'application/json',
        ...headers,
      })
      const text = await response.text()
      try {
        return JSON.parse(text) as T
      } catch {
        throw new PublicResearchUnavailable('network', `${url}: unreadable JSON`)
      }
    },
  }
}
