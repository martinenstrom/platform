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
  credentials: Record<string, ProviderCredential>
  limits: Record<string, ProviderLimits>
  /** Per-provider request deadline; falls back to `defaultTimeoutMs`. */
  timeouts: Record<string, number>
  defaultTimeoutMs: number
  /** Non-fatal problems found while reading the environment. */
  warnings: string[]
}

export type EnvSource = Record<string, string | undefined>

const DEFAULT_CHAINS: Record<DataCategory, string[]> = {
  'equity-index-se': ['avanza', 'fixture'],
  'equity-index-intl': ['fixture'],
  'equity-se': ['avanza', 'fixture'],
  fx: ['frankfurter', 'fixture'],
  'yields-us': ['treasury', 'fred', 'fixture'],
  'yields-de': ['fred', 'fixture'],
  'yields-se': ['riksbank', 'fixture'],
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

/** Keyless providers, listed explicitly so an omission is visible, not implied. */
const KEYLESS_PROVIDERS = [
  'frankfurter',
  'treasury',
  'coingecko',
  'avanza',
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

  const limits: Record<string, ProviderLimits> = {
    twelvedata: {
      requestsPerMinute: parseInteger(env.TWELVEDATA_RPM, 'TWELVEDATA_RPM') ?? 8,
      requestsPerDay: parseInteger(env.TWELVEDATA_RPD, 'TWELVEDATA_RPD') ?? 800,
    },
    marketaux: {
      requestsPerMinute: null,
      requestsPerDay: parseInteger(env.MARKETAUX_RPD, 'MARKETAUX_RPD') ?? 100,
    },
    coingecko: {
      requestsPerMinute: parseInteger(env.COINGECKO_RPM, 'COINGECKO_RPM') ?? 100,
      requestsPerDay: null,
    },
  }

  const timeouts: Record<string, number> = {}
  for (const providerId of Object.keys(credentials)) {
    const raw = env[`MARKETDATA_TIMEOUT_MS_${providerId.toUpperCase()}`]
    const parsed = parseInteger(raw, `MARKETDATA_TIMEOUT_MS_${providerId.toUpperCase()}`)
    if (parsed !== null) timeouts[providerId] = parsed
  }

  return {
    mode,
    production,
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
