/**
 * Operational health and metrics endpoints.
 *
 * These reveal no credentials, but they do reveal **operational topology** —
 * which providers exist, whether they are failing, how much quota is left. That
 * is internal information, so:
 *
 *  - fixture/local: open, for development diagnostics
 *  - hybrid/live: **disabled by default**, enabled only by explicit
 *    configuration, and then requiring a server-side operator token
 *
 * The token is read from the environment at call time and never stored on the
 * config object, so it cannot be serialized, logged or returned by accident.
 *
 * The token is a NARROWLY SCOPED TEMPORARY MEASURE, not an authorization
 * model. The moment this application has real authentication, these endpoints
 * should move behind it.
 *
 * Both functions use POST rather than GET **because of the token**: a GET
 * server function serializes its payload into the URL, which would put an
 * operator credential into access logs, proxy caches and error reports — the
 * same rule that keeps provider API keys out of query strings.
 */

import { createServerFn } from '@tanstack/react-start'
import type { MarketDataHealth } from '~/application/marketData/health'

export type HealthResponse =
  | { status: 'ok'; health: MarketDataHealth }
  /**
   * Deliberately indistinguishable between "disabled" and "wrong token", and
   * carrying no provider information: a probe must not be able to learn the
   * topology from the shape of a refusal.
   */
  | { status: 'unavailable' }

/** Length-independent comparison, so a token cannot be guessed byte by byte. */
function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface AuthorizationInput {
  enabled: boolean
  /** True when the deployment can reach a real provider (hybrid or live). */
  requiresToken: boolean
  configuredToken: string | undefined
  presentedToken: string | undefined
}

/**
 * Pure authorization decision, separated from the transport so it can be
 * tested exhaustively without a server.
 */
export function isHealthAuthorized(input: AuthorizationInput): boolean {
  if (!input.enabled) return false
  if (!input.requiresToken) return true
  const configured = (input.configuredToken ?? '').trim()
  const presented = (input.presentedToken ?? '').trim()
  // A missing configured token must not mean "allow everything".
  if (configured.length === 0) return false
  return secretEquals(configured, presented)
}

/**
 * Health snapshot. Instance-scoped — see `MarketDataHealth.scope`.
 *
 * Never cached: a cached health response is a stale answer to a question only
 * asked because something might be wrong.
 */
export const getMarketDataHealthFn = createServerFn({ method: 'POST' })
  .validator((token: string | undefined) => token)
  .handler(async ({ data: presentedToken }): Promise<HealthResponse> => {
    const { getContainer } = await import('./serverFns')
    const container = await getContainer()

    const authorized = isHealthAuthorized({
      enabled: container.config.healthEnabled,
      requiresToken: container.config.mode !== 'fixture',
      configuredToken: process.env.MARKETDATA_HEALTH_TOKEN,
      presentedToken,
    })
    if (!authorized) return { status: 'unavailable' }

    return { status: 'ok', health: await container.health() }
  })

/**
 * Prometheus text exposition, behind the same gate.
 *
 * Returns a string rather than a `Response` so it stays a plain server
 * function; a host that wants a real `/metrics` route can wrap it and set
 * `Content-Type: text/plain; version=0.0.4`.
 */
export const getMarketDataMetricsFn = createServerFn({ method: 'POST' })
  .validator((token: string | undefined) => token)
  .handler(async ({ data: presentedToken }): Promise<string> => {
    const [{ getContainer }, { renderPrometheus }] = await Promise.all([
      import('./serverFns'),
      import('./metrics/prometheus'),
    ])
    const container = await getContainer()

    const authorized = isHealthAuthorized({
      enabled: container.config.healthEnabled,
      requiresToken: container.config.mode !== 'fixture',
      configuredToken: process.env.MARKETDATA_HEALTH_TOKEN,
      presentedToken,
    })
    if (!authorized || !container.metricsRegistry) return ''

    return renderPrometheus(container.metricsRegistry.snapshot())
  })
