/**
 * Structured logging with allowlist redaction.
 *
 * Redaction is allowlist-based rather than denylist-based on purpose: a
 * denylist protects only the leaks someone thought of. Only the fields named
 * in `ResolutionLog` are ever emitted — never a response body, never a URL
 * with a query string, never a header.
 *
 * `scrub()` is defence in depth on top of that, for the day someone widens the
 * allowlist without thinking it through.
 */

import type { Logger, ResolutionLog } from '~/application/marketData/providerRegistry'

/**
 * Credential shapes worth catching. Each keeps the label in the output, so a
 * redacted line still says *what* was removed — `apikey=[REDACTED]` is far
 * more useful when debugging than a bare `[REDACTED]`.
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // `Authorization: Bearer <token>` — separated by a space, not by = or :.
  { pattern: /\b(bearer)\s+[\w.\-~+/]+=*/gi, replacement: '$1 [REDACTED]' },
  // `apikey=…`, `token: …`, `secret = "…"`.
  {
    pattern:
      /\b(api[-_]?key|apikey|access[-_]?token|token|secret|password)\b\s*[=:]\s*["']?[\w.\-]+["']?/gi,
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

export interface LoggerOptions {
  /** Credential values to scrub from any free text. Never logged themselves. */
  knownSecrets?: readonly string[]
  sink?: (record: Record<string, unknown>) => void
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const secrets = options.knownSecrets ?? []
  const sink =
    options.sink ??
    ((record) => {
      // eslint-disable-next-line no-console -- the process log IS the sink here
      console.info(JSON.stringify(record))
    })

  return {
    resolution(entry: ResolutionLog) {
      const record: Record<string, unknown> = { event: 'marketdata.resolution' }
      for (const field of ALLOWED_FIELDS) {
        const value = (entry as unknown as Record<string, unknown>)[field]
        if (value === undefined) continue
        record[field] = typeof value === 'string' ? scrub(value, secrets) : value
      }
      sink(record)
    },
    warn(message: string, meta?: Record<string, unknown>) {
      sink({
        event: 'marketdata.warn',
        message: scrub(message, secrets),
        ...(meta ? { meta } : {}),
      })
    },
  }
}
