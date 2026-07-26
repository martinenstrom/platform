/**
 * Structured logging with allowlist redaction, levels and deterministic
 * sampling.
 *
 * Redaction is allowlist-based rather than denylist-based on purpose: a
 * denylist protects only the leaks someone thought of. Only the fields named
 * in `ALLOWED_FIELDS` are ever emitted — never a response body, never a URL
 * with a query string, never an authorization header.
 *
 * `scrub()` is defence in depth on top of that, for the day someone widens the
 * allowlist without thinking it through.
 *
 * Two properties the market-data pipeline depends on:
 *
 *  - **A sink failure never fails a request.** Logging is diagnostics; if it
 *    breaks, the product keeps working.
 *  - **A sink failure is never reported through the same sink**, which would
 *    recurse into the failure it is trying to report.
 */

import { sampledIn } from '~/domain/shared/hash'
import type { Logger, ResolutionLog } from '~/application/marketData/providerRegistry'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/**
 * Credential shapes worth catching. Each keeps the label in the output, so a
 * redacted line still says *what* was removed — `apikey=[REDACTED]` is far
 * more useful when debugging than a bare `[REDACTED]`.
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // `Authorization: Bearer <token>` — separated by a space, not by = or :.
  { pattern: /\b(bearer)\s+[\w.\-~+/]+=*/gi, replacement: '$1 [REDACTED]' },
  // `apikey=…`, `token: …`, `secret = "…"`, `x-cg-demo-api-key: …`.
  {
    pattern:
      /\b(x-cg-demo-api-key|api[-_]?key|apikey|access[-_]?token|token|secret|password)\b\s*[=:]\s*["']?[\w.\-]+["']?/gi,
    replacement: '$1=[REDACTED]',
  },
]

/** Removes anything that looks like a credential from free text. */
export function scrub(input: string, knownSecrets: readonly string[] = []): string {
  let out = input
  for (const secret of knownSecrets) {
    // Short values would match too much ordinary text to be worth scrubbing.
    if (secret && secret.length >= 8) out = out.split(secret).join('[REDACTED]')
  }
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/** No single field may grow without bound, whatever a caller passes. */
export const MAX_FIELD_LENGTH = 300

function bound(value: string): string {
  return value.length <= MAX_FIELD_LENGTH
    ? value
    : `${value.slice(0, MAX_FIELD_LENGTH)}…[truncated]`
}

/** Exactly the fields permitted in a resolution record. Nothing else is emitted. */
const ALLOWED_FIELDS = [
  'correlationId',
  'category',
  'capability',
  'cacheKey',
  'providerId',
  'outcome',
  'latencyMs',
  'attemptNumber',
  'quality',
  'staleReason',
  'errorCode',
  'budgetRemaining',
  'breakerState',
  'note',
] as const

/**
 * Outcomes that are always logged in full, never sampled.
 *
 * Everything here is either a failure, a degradation, or a state transition an
 * operator would want to see every instance of. Sampling those would mean
 * discovering an incident from a fraction of its evidence.
 */
const ALWAYS_LOG_OUTCOMES = new Set([
  'provider-failure',
  'provider-skipped',
  'stale-served',
  'fixture-served',
  'error',
])

export interface LoggerOptions {
  /** Minimum level to emit. */
  level?: LogLevel
  /**
   * Log 1 in N successful, routine resolutions. 1 logs everything, 0 disables
   * successful logs entirely.
   */
  successSampleRate?: number
  /** Credential values to scrub from free text. Never logged themselves. */
  knownSecrets?: readonly string[]
  sink?: (record: Record<string, unknown>) => void
  /**
   * Where sink failures are reported. Deliberately separate: reporting through
   * the failing sink would recurse into the failure.
   */
  onSinkError?: (error: unknown) => void
}

export interface LoggerDiagnostics {
  sinkFailures: number
  sampledOut: number
}

export interface DiagnosticLogger extends Logger {
  diagnostics(): LoggerDiagnostics
}

export function createLogger(options: LoggerOptions = {}): DiagnosticLogger {
  const level = options.level ?? 'info'
  const successSampleRate = options.successSampleRate ?? 20
  const secrets = options.knownSecrets ?? []
  let sinkFailures = 0
  let sampledOut = 0

  const rawSink =
    options.sink ??
    ((record) => {
      // eslint-disable-next-line no-console -- the process log IS the sink here
      console.info(JSON.stringify(record))
    })

  /** Isolates the sink: diagnostics must never break the product. */
  function emit(record: Record<string, unknown>): void {
    try {
      rawSink(record)
    } catch (error) {
      sinkFailures += 1
      // Reported out-of-band, never back through `rawSink`.
      options.onSinkError?.(error)
    }
  }

  function enabled(at: LogLevel): boolean {
    return LEVEL_ORDER[at] >= LEVEL_ORDER[level]
  }

  return {
    resolution(entry: ResolutionLog) {
      if (!enabled('info')) return

      const always = ALWAYS_LOG_OUTCOMES.has(entry.outcome)
      if (!always) {
        if (successSampleRate <= 0) return
        // Deterministic: keyed on the record's own identity so every line
        // belonging to one resolution is sampled together, and so a test gets
        // the same answer every run. Never Math.random().
        const key = `${entry.correlationId}:${entry.outcome}:${entry.providerId ?? '-'}`
        if (!sampledIn(key, successSampleRate)) {
          sampledOut += 1
          return
        }
      }

      const record: Record<string, unknown> = { event: 'marketdata.resolution' }
      for (const field of ALLOWED_FIELDS) {
        const value = (entry as unknown as Record<string, unknown>)[field]
        if (value === undefined) continue
        record[field] = typeof value === 'string' ? bound(scrub(value, secrets)) : value
      }
      emit(record)
    },

    warn(message: string, meta?: Record<string, unknown>) {
      if (!enabled('warn')) return
      emit({
        event: 'marketdata.warn',
        message: bound(scrub(message, secrets)),
        ...(meta ? { meta } : {}),
      })
    },

    diagnostics() {
      return { sinkFailures, sampledOut }
    },
  }
}
