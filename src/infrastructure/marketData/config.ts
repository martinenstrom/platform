/**
 * Server-side configuration for the market-data layer.
 *
 * Read once, validated once. Two rules that the rest of the system depends on:
 *
 *  1. **No secret carries a `VITE_` prefix.** Vite exposes only `VITE_*` to the
 *     client, so unprefixed names are structurally incapable of reaching the
 *     browser bundle. `vite.config.ts` already loads unprefixed `.env` into
 *     `process.env` for server code.
 *  2. **A missing key removes its provider from the chain with a warning**
 *     rather than throwing. The fixture tail keeps the app running; a
 *     malformed value, by contrast, is a programming error and does throw.
 */

import type { DataCategory } from '~/application/marketData/ports'

/**
 * Deployment posture. Each mode has one meaning, and all three are testable:
 *
 *   fixture  fixture providers only. **No network provider is registered**,
 *            so no external request can be made and no provider budget can be
 *            consumed. This is the default, so a clean checkout is fully
 *            offline.
 *   hybrid   live providers first, fixture fallback where policy allows.
 *   live     live providers only; no fixture fallback where policy disallows.
 *
 * Before this was explicit, `fixture` only governed whether fixtures were
 * *permitted* — live providers were still attempted, so a fresh clone would
 * call an external API on first page load.
 */
export type MarketDataMode = 'fixture' | 'hybrid' | 'live'

/**
 * Records only that a credential EXISTS, never its value. Nothing downstream
 * can leak what it was never given — which is why `MarketDataConfig` is safe
 * to log, serialize or inspect in full.
 */
export interface ProviderCredential {
  providerId: string
  envVar: string
  present: boolean
}

export interface ProviderLimits {
  requestsPerMinute: number | null
  requestsPerDay: number | null
}

export interface MarketDataConfig {
  mode: MarketDataMode
  /** True only in `live`. Drives `allowFixture: 'non-production'`. */
  production: boolean
  /**
   * Whether any network provider may be registered at all.
   *
   * False in `fixture` mode and whenever `MARKETDATA_DISABLE_NETWORK` is set.
   * The composition root reads this and simply does not wire network adapters,
   * which is a stronger guarantee than a runtime guard: there is nothing left
   * to invoke by accident.
   */
  allowNetworkProviders: boolean
  /**
   * Maximum number of concurrent instances sharing a provider quota.
   *
   * A conservative temporary guard, NOT a correctness guarantee — see the
   * warnings in `checkQuotaSafety`. Must be set to the maximum possible
   * concurrent count, not the current one.
   */
  instanceCount: number
  cacheDir: string
  persistCache: boolean
  /** Hard-fails any outbound call. Set true in CI and tests. */
  disableNetwork: boolean
  chains: Record<DataCategory, string[]>
  /** True when CoinGecko may be called without a Demo key (hybrid dev only). */
  coinGeckoKeyless: boolean
  credentials: Record<string, ProviderCredential>
  limits: Record<string, ProviderLimits>
  /** Per-provider request deadline; falls back to `defaultTimeoutMs`. */
  timeouts: Record<string, number>
  defaultTimeoutMs: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** Log 1 in N routine successes. 1 logs all, 0 disables successful logs. */
  logSuccessSampleRate: number
  /**
   * Whether the health endpoint may answer at all.
   *
   * Defaults to true in fixture mode (local diagnostics) and **false in hybrid
   * and live**, because the payload reveals provider topology, availability
   * and quota state. That is internal operational information even though it
   * contains no credentials.
   */
  healthEnabled: boolean
  /**
   * Whether an operator token is configured. The VALUE is never stored here —
   * the endpoint reads it from the environment at call time, so it cannot be
   * serialized, logged or returned with the config object.
   */
  healthTokenPresent: boolean
  /** Non-fatal problems found while reading the environment. */
  warnings: string[]
}

export type EnvSource = Record<string, string | undefined>

const DEFAULT_CHAINS: Record<DataCategory, string[]> = {
  'equity-index-se': ['avanza', 'fixture'],
  'equity-index-intl': ['fixture'],
  'equity-se': ['avanza', 'fixture'],
  fx: ['frankfurter', 'fixture'],
  // No universal chain: coverage and methodology differ per country. The
  // Riksbank also carries a German 10Y, but it is a Refinitiv benchmark rather
  // than the Bundesbank's fitted zero rate, so it is deliberately NOT wired as
  // a German fallback.
  'yields-us': ['treasury', 'fixture'],
  'yields-de': ['bundesbank', 'fixture'],
  'yields-se': ['riksbank', 'fixture'],
  'curve-us': ['treasury', 'fixture'],
  // Monetary policy. One official source each, and no cross-institution
  // fallback: the ECB cannot stand in for the Fed, and neither can a yield.
  'search-se': ['avanza-search', 'fixture'],
  'policy-us': ['nyfed', 'fixture'],
  'policy-ea': ['ecb', 'fixture'],
  'policy-se': ['riksbank-policy', 'fixture'],
  commodities: ['fixture'],
  crypto: ['coingecko', 'fixture'],
  news: ['marketaux', 'fixture'],
  sentiment: ['derived', 'fixture'],
  intraday: ['fixture'],
  sectors: ['fixture'],
}

/** Which env var holds each provider's key. Providers absent here need none. */
const PROVIDER_KEY_ENV: Record<string, string> = {
  fred: 'FRED_API_KEY',
  marketaux: 'MARKETAUX_API_KEY',
  twelvedata: 'TWELVEDATA_API_KEY',
  riksbank: 'RIKSBANK_API_KEY',
}

/**
 * Providers that need no credential at all.
 *
 * CoinGecko is deliberately NOT here. Its keyless endpoint works today but is
 * not a published production contract, so live mode requires a Demo key and
 * hybrid must opt in explicitly via `COINGECKO_ALLOW_KEYLESS`.
 */
const KEYLESS_PROVIDERS = [
  'frankfurter',
  'treasury',
  'bundesbank',
  'riksbank',
  'nyfed',
  'ecb',
  'riksbank-policy',
  'avanza',
  'avanza-search',
  'derived',
  'fixture',
] as const

const CATEGORY_ENV: Record<DataCategory, string> = {
  'equity-index-se': 'MARKETDATA_CHAIN_EQUITY_SE_INDEX',
  'equity-index-intl': 'MARKETDATA_CHAIN_EQUITY_INTL',
  'equity-se': 'MARKETDATA_CHAIN_EQUITY_SE',
  fx: 'MARKETDATA_CHAIN_FX',
  'yields-us': 'MARKETDATA_CHAIN_YIELDS_US',
  'yields-de': 'MARKETDATA_CHAIN_YIELDS_DE',
  'yields-se': 'MARKETDATA_CHAIN_YIELDS_SE',
  'curve-us': 'MARKETDATA_CHAIN_CURVE_US',
  'search-se': 'MARKETDATA_CHAIN_SEARCH_SE',
  'policy-us': 'MARKETDATA_CHAIN_POLICY_US',
  'policy-ea': 'MARKETDATA_CHAIN_POLICY_EA',
  'policy-se': 'MARKETDATA_CHAIN_POLICY_SE',
  commodities: 'MARKETDATA_CHAIN_COMMODITIES',
  crypto: 'MARKETDATA_CHAIN_CRYPTO',
  news: 'MARKETDATA_CHAIN_NEWS',
  sentiment: 'MARKETDATA_CHAIN_SENTIMENT',
  intraday: 'MARKETDATA_CHAIN_INTRADAY',
  sectors: 'MARKETDATA_CHAIN_SECTORS',
}

function parseMode(raw: string | undefined): MarketDataMode {
  const value = (raw ?? 'fixture').trim()
  if (value === 'fixture' || value === 'hybrid' || value === 'live') return value
  throw new Error(
    `MARKETDATA_MODE must be one of fixture|hybrid|live, received "${raw ?? ''}"`,
  )
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = raw.trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be "true" or "false", received "${raw}"`)
}

function parseInteger(raw: string | undefined, name: string): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`)
  }
  return value
}

function parseLogLevel(raw: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
  const value = (raw ?? 'info').trim()
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value
  }
  throw new Error(
    `MARKETDATA_LOG_LEVEL must be one of debug|info|warn|error, received "${raw ?? ''}"`,
  )
}

function parseChain(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined || raw.trim() === '') return [...fallback]
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Builds the configuration from an environment snapshot. Takes `env` as a
 * parameter rather than reading `process.env` directly so it is testable
 * without mutating global state.
 */
export function loadMarketDataConfig(env: EnvSource): MarketDataConfig {
  const warnings: string[] = []

  const mode = parseMode(env.MARKETDATA_MODE)
  const production = mode === 'live'
  const disableNetwork = parseBoolean(
    env.MARKETDATA_DISABLE_NETWORK,
    false,
    'MARKETDATA_DISABLE_NETWORK',
  )
  // Fixture mode is fully offline: not "fixtures are allowed", but "no
  // network provider exists".
  const allowNetworkProviders = mode !== 'fixture' && !disableNetwork
  const instanceCount =
    parseInteger(env.MARKETDATA_INSTANCE_COUNT, 'MARKETDATA_INSTANCE_COUNT') ?? 1

  const credentials: Record<string, ProviderCredential> = {}
  for (const [providerId, envVar] of Object.entries(PROVIDER_KEY_ENV)) {
    const present = (env[envVar] ?? '').trim().length > 0
    credentials[providerId] = { providerId, envVar, present }
  }
  for (const providerId of KEYLESS_PROVIDERS) {
    credentials[providerId] = { providerId, envVar: '', present: true }
  }

  // CoinGecko: a key is mandatory in live mode. In hybrid, the keyless
  // endpoint may be used for local development, but only when asked for.
  const coinGeckoKey = (env.COINGECKO_API_KEY ?? '').trim()
  const allowKeyless = parseBoolean(
    env.COINGECKO_ALLOW_KEYLESS,
    false,
    'COINGECKO_ALLOW_KEYLESS',
  )
  credentials.coingecko = {
    providerId: 'coingecko',
    envVar: 'COINGECKO_API_KEY',
    present: coinGeckoKey.length > 0 || (allowKeyless && mode !== 'live'),
  }

  const chains = {} as Record<DataCategory, string[]>
  for (const [category, envVar] of Object.entries(CATEGORY_ENV) as Array<
    [DataCategory, string]
  >) {
    const configured = parseChain(env[envVar], DEFAULT_CHAINS[category])
    // A provider whose key is absent is dropped from the chain, not fatal.
    const usable = configured.filter((providerId) => {
      const credential = credentials[providerId]
      if (!credential) {
        warnings.push(`Unknown provider "${providerId}" in ${envVar} — ignored.`)
        return false
      }
      if (!credential.present) {
        warnings.push(
          `Provider "${providerId}" dropped from ${category}: ${credential.envVar} is not set.`,
        )
        return false
      }
      if (providerId !== 'fixture' && !allowNetworkProviders) {
        // Not a warning: in fixture mode this is the intended state, and
        // warning on every category would train people to ignore warnings.
        return false
      }
      return true
    })
    chains[category] = usable
  }

  /**
   * Divides a per-day quota across instances, floor-wise with a floor of 1.
   *
   * A conservative TEMPORARY guard, not a correctness guarantee: it is only as
   * good as the number configured, and autoscaling or a rolling deploy can
   * exceed it. See `checkQuotaSafety`.
   */
  const perInstance = (perDay: number | null): number | null =>
    perDay === null ? null : Math.max(1, Math.floor(perDay / instanceCount))

  const limits: Record<string, ProviderLimits> = {
    twelvedata: {
      requestsPerMinute: parseInteger(env.TWELVEDATA_RPM, 'TWELVEDATA_RPM') ?? 8,
      requestsPerDay: perInstance(
        parseInteger(env.TWELVEDATA_RPD, 'TWELVEDATA_RPD') ?? 800,
      ),
    },
    marketaux: {
      requestsPerMinute: null,
      requestsPerDay: perInstance(
        parseInteger(env.MARKETAUX_RPD, 'MARKETAUX_RPD') ?? 100,
      ),
    },
    coingecko: {
      // Demo plan: ~30 calls/min and 10,000 calls/month (~322/day). 250 leaves
      // roughly 22% headroom for retries and clock skew. The DAILY ceiling is
      // not a substitute for watching the MONTHLY allowance: normal use at a
      // 10-minute TTL is ~144/day, i.e. ~4,320 per 30 days, well inside
      // 10,000 — but sustained retry pressure at the daily ceiling would not
      // be. Update these values in configuration, never in provider code, if
      // the published plan changes.
      requestsPerMinute: parseInteger(env.COINGECKO_RPM, 'COINGECKO_RPM') ?? 30,
      requestsPerDay: perInstance(
        parseInteger(env.COINGECKO_RPD, 'COINGECKO_RPD') ?? 250,
      ),
    },
  }

  const timeouts: Record<string, number> = {}
  for (const providerId of Object.keys(credentials)) {
    const raw = env[`MARKETDATA_TIMEOUT_MS_${providerId.toUpperCase()}`]
    const parsed = parseInteger(raw, `MARKETDATA_TIMEOUT_MS_${providerId.toUpperCase()}`)
    if (parsed !== null) timeouts[providerId] = parsed
  }

  const rawSample = parseInteger(
    env.MARKETDATA_LOG_SUCCESS_SAMPLE,
    'MARKETDATA_LOG_SUCCESS_SAMPLE',
  )
  // 0 is a meaningful setting ("no successful logs") that parseInteger rejects
  // as non-positive, so it is read separately rather than loosening that guard.
  const explicitZero = (env.MARKETDATA_LOG_SUCCESS_SAMPLE ?? '').trim() === '0'
  const logSuccessSampleRate = explicitZero ? 0 : (rawSample ?? 20)

  const logLevel = parseLogLevel(env.MARKETDATA_LOG_LEVEL)
  const healthEnabled = parseBoolean(
    env.MARKETDATA_HEALTH_ENABLED,
    // Local diagnostics by default; closed by default anywhere that can reach
    // a real provider.
    mode === 'fixture',
    'MARKETDATA_HEALTH_ENABLED',
  )

  return {
    mode,
    production,
    logLevel,
    logSuccessSampleRate,
    healthEnabled,
    healthTokenPresent: (env.MARKETDATA_HEALTH_TOKEN ?? '').trim().length > 0,
    allowNetworkProviders,
    instanceCount,
    timeouts,
    defaultTimeoutMs:
      parseInteger(env.MARKETDATA_TIMEOUT_MS, 'MARKETDATA_TIMEOUT_MS') ?? 5_000,
    cacheDir: env.MARKETDATA_CACHE_DIR?.trim() || '.cache',
    persistCache: parseBoolean(
      env.MARKETDATA_PERSIST_CACHE,
      false,
      'MARKETDATA_PERSIST_CACHE',
    ),
    disableNetwork,
    chains,
    coinGeckoKeyless: coinGeckoKey.length === 0,
    credentials,
    limits,
    warnings,
  }
}

export interface ReadinessIssue {
  category: DataCategory
  message: string
}

/**
 * Live-readiness check.
 *
 * Because every category is `allowFixture: 'non-production'` (decision D2), a
 * category still on a fixture-only chain returns an error in live mode. That
 * is correct, but it must not be discovered in production — so it is reported
 * at startup, naming each category. Phases 2–9 each clear one of these.
 */
export function checkLiveReadiness(config: MarketDataConfig): ReadinessIssue[] {
  if (!config.production) return []
  const issues: ReadinessIssue[] = []
  for (const [category, chain] of Object.entries(config.chains) as Array<
    [DataCategory, string[]]
  >) {
    const live = chain.filter((providerId) => providerId !== 'fixture')
    if (live.length === 0) {
      issues.push({
        category,
        message:
          `Category "${category}" has no live provider configured. In live mode it will ` +
          `return an error rather than fixture data.`,
      })
    }
  }
  return issues
}

/**
 * Warns when live mode is combined with a non-shared cache. Cached values
 * degrade gracefully across instances, but the daily request budget does not —
 * N instances will attempt N× the quota.
 */
export function checkCacheSharing(
  config: MarketDataConfig,
  storeIsShared: boolean,
): string | null {
  if (!config.production || storeIsShared) return null
  return (
    'Live mode is using a non-shared cache store. Daily provider budgets are ' +
    'counted per instance, so a multi-instance deployment will exceed its quotas. ' +
    'Use a shared store (KV) before scaling out.'
  )
}

export interface QuotaSafetyResult {
  /** Fatal: configuration must be corrected before serving live traffic. */
  errors: string[]
  warnings: string[]
}

/**
 * Quota safety for multi-instance deployment.
 *
 * Local memory and local disk **cannot enforce a global quota**. Each instance
 * counts its own attempts, so N instances against a 250/day budget will
 * attempt 250 × N. With CoinGecko's ~322/day that is exceeded at two
 * instances.
 *
 * `MARKETDATA_INSTANCE_COUNT` divides the budget as a conservative guard, but
 * it is only as good as the number configured. It must be set to the MAXIMUM
 * POSSIBLE concurrent count, not the current one — autoscaling, rolling
 * deployments and a stale value can all still breach the global quota. No
 * multi-instance quota correctness is claimed until a shared `CacheStore`
 * exists.
 *
 * Therefore, in live mode with a non-shared store and a metered provider, this
 * FAILS rather than proceeding: silently risking a quota overrun is worse than
 * refusing to start.
 */
export function checkQuotaSafety(
  config: MarketDataConfig,
  storeIsShared: boolean,
  instanceCountWasExplicit: boolean,
): QuotaSafetyResult {
  const errors: string[] = []
  const warnings: string[] = []

  const metered = Object.entries(config.limits)
    .filter(([, limit]) => limit.requestsPerDay !== null)
    .map(([providerId]) => providerId)
    .filter((providerId) =>
      Object.values(config.chains).some((chain) => chain.includes(providerId)),
    )

  if (metered.length === 0) return { errors, warnings }

  if (!storeIsShared) {
    const detail =
      `Provider budgets for ${metered.join(', ')} are counted PER INSTANCE ` +
      `(cache store is not shared). ${config.instanceCount} instance(s) configured.`

    /*
     * Two separate live-mode failures, and the second one used to be a warning.
     *
     * Declaring MARKETDATA_INSTANCE_COUNT > 1 is not a mitigation — it is the
     * operator stating that N processes each hold their own budget counter. A
     * 250/day quota then permits 250 x N calls, and the failure arrives as a
     * provider ban rather than an error message. Treating the declaration as
     * an escape hatch had it exactly backwards: the clearer the operator is
     * about the multi-instance deployment, the more certain the overrun.
     *
     * An unset count in live mode is the same hazard with less information.
     */
    if (config.production && config.instanceCount > 1) {
      errors.push(
        `${detail} Declaring more than one instance without a shared cache store ` +
          `guarantees the per-day budget is multiplied by the instance count. ` +
          `Provide a shared CacheStore, reduce MARKETDATA_INSTANCE_COUNT to 1, ` +
          `or remove the metered provider from its chain.`,
      )
    } else if (config.production && !instanceCountWasExplicit) {
      errors.push(
        `${detail} In live mode this risks exceeding the provider's global quota. ` +
          `Set MARKETDATA_INSTANCE_COUNT to the maximum possible concurrent instance ` +
          `count, or provide a shared cache store.`,
      )
    } else {
      warnings.push(
        `${detail} The value must reflect the MAXIMUM possible concurrent instances; ` +
          `autoscaling or a rolling deploy can still breach the global quota. ` +
          `Multi-instance quota correctness is not guaranteed until a shared ` +
          `CacheStore is in place.`,
      )
    }
  }

  return { errors, warnings }
}

/**
 * CoinGecko's keyless endpoint works today but is not a published production
 * contract, so live mode must not depend on it.
 */
export function checkProviderCredentials(config: MarketDataConfig): string[] {
  const errors: string[] = []
  const usesCoinGecko = Object.values(config.chains).some((chain) =>
    chain.includes('coingecko'),
  )
  if (config.production && usesCoinGecko && config.coinGeckoKeyless) {
    errors.push(
      'CoinGecko is configured in live mode without COINGECKO_API_KEY. The keyless ' +
        'endpoint is not a production contract; set a Demo API key or remove ' +
        'coingecko from MARKETDATA_CHAIN_CRYPTO.',
    )
  }
  return errors
}
