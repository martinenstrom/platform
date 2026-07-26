/**
 * The only module in the market-data layer that performs a network call.
 *
 * Scope is deliberately narrow — one owner per operational concern:
 *
 *   this module        perform the call, propagate the caller's AbortSignal,
 *                      enforce the network-disabled guard, parse safely
 *   attempt.ts         timeout, retry, rate limit, budget, circuit breaker
 *   the adapter        symbol mapping, validation, normalization
 *
 * It has **no timeout and no retry of its own**. Adding either would create a
 * second policy competing with the resilience pipeline, and two owners for one
 * concern is how retry storms are born. The signal it receives is the one the
 * pipeline aborts on deadline.
 */

import type { ErrorCode } from '~/domain/market'

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface HttpClientOptions {
  /** When true, every request fails immediately and non-retryably. */
  networkDisabled: boolean
  /** Injected so tests never depend on a real global. */
  fetchImpl?: typeof fetch
}

/** Maps a transport failure onto the domain's error vocabulary. */
function classify(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'network'
  return 'unknown'
}

export interface HttpClient {
  /**
   * `headers` is how credentials travel — never a query parameter, which
   * would end up in access logs, proxy caches and error messages.
   */
  getJson<T>(
    url: string,
    signal: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<T>
  /**
   * For sources that publish XML or CSV rather than JSON. Same guards, same
   * signal, same error classification — only the body decoding differs.
   */
  getText(
    url: string,
    signal: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<string>
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch

  /** Everything up to decoding, shared by the JSON and text readers. */
  async function request(
    url: string,
    signal: AbortSignal,
    headers: Record<string, string>,
  ): Promise<Response> {
    if (options.networkDisabled) {
      // Non-retryable on purpose: retrying a configuration decision would
      // burn budget and delay the fallback for no possible benefit.
      throw new HttpError(
        'network',
        'Outbound network access is disabled (MARKETDATA_DISABLE_NETWORK)',
      )
    }

    let response: Response
    try {
      response = await doFetch(url, {
        signal,
        headers: { accept: 'application/json, text/csv, application/xml', ...headers },
      })
    } catch (error) {
      // An abort is the pipeline's deadline firing; surface it as a timeout
      // so the breaker and stale reason classify it correctly.
      if (signal.aborted) throw new HttpError('timeout', 'Request aborted by deadline')
      throw new HttpError(
        'network',
        error instanceof Error ? error.message : 'Network request failed',
      )
    }

    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'))
      throw new HttpError(
        classify(response.status),
        `HTTP ${response.status} from upstream`,
        response.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : undefined,
      )
    }
    return response
  }

  return {
    async getText(url, signal, headers = {}) {
      const response = await request(url, signal, headers)
      try {
        return await response.text()
      } catch {
        throw new HttpError('schema', 'Upstream returned an unreadable body')
      }
    },

    async getJson<T>(
      url: string,
      signal: AbortSignal,
      headers: Record<string, string> = {},
    ): Promise<T> {
      if (options.networkDisabled) {
        // Non-retryable on purpose: retrying a configuration decision would
        // burn budget and delay the fallback for no possible benefit.
        throw new HttpError(
          'network',
          'Outbound network access is disabled (MARKETDATA_DISABLE_NETWORK)',
        )
      }

      let response: Response
      try {
        response = await doFetch(url, {
          signal,
          headers: { accept: 'application/json', ...headers },
        })
      } catch (error) {
        // An abort is the pipeline's deadline firing; surface it as a timeout
        // so the breaker and stale reason classify it correctly.
        if (signal.aborted) throw new HttpError('timeout', 'Request aborted by deadline')
        throw new HttpError(
          'network',
          error instanceof Error ? error.message : 'Network request failed',
        )
      }

      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after'))
        throw new HttpError(
          classify(response.status),
          `HTTP ${response.status} from upstream`,
          response.status,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : undefined,
        )
      }

      try {
        return (await response.json()) as T
      } catch {
        // Unparseable body is an adapter-visible contract break, not a
        // transport fault — so it must not trip the circuit breaker.
        throw new HttpError('schema', 'Upstream returned a body that is not valid JSON')
      }
    },
  }
}
