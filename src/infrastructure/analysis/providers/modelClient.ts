/**
 * The model call itself. One endpoint, JSON over HTTPS, no SDK.
 *
 * Follows the `httpClient` pattern the market-data providers established, for
 * the reasons §2 of the client decision measured: an SDK brings its own timeout
 * and its own retry, which would be second owners for two concerns the
 * execution pipeline already owns — and two owners for one concern is how retry
 * storms are born.
 *
 * So this module does exactly one thing: send a request, and map what comes
 * back onto a bounded vocabulary.
 *
 * - **no timeout of its own** — the caller's `AbortSignal` is propagated, and
 *   `executeWithinRun` owns the clock
 * - **no retry of its own** — retries are attempts within one run, upstream
 * - **no error type of its own beyond a bounded code** — a driver-native error
 *   at the port is the exact defect contract parity caught in R1
 *
 * Confined to this directory by the `llm-client-confined-to-provider` fitness
 * rule: nothing in domain, application or presentation may import it.
 */

import type { RunFailureCategory } from '~/domain/analysis'

/** Anthropic's Messages API. The only endpoint this client knows. */
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

export interface ModelRequest {
  model: string
  /** Rendered by the caller. This module does not know what a prompt means. */
  system: string
  user: string
  maxTokens: number
  temperature: number
}

/** What the provider reported spending. Absent when it did not say. */
export interface ModelUsage {
  inputTokens: number
  outputTokens: number
}

export interface ModelResponse {
  /** The model that actually ANSWERED, which may differ from the one asked. */
  model: string
  /** Concatenated text blocks. Tool protocols are not used; see §3. */
  text: string
  usage: ModelUsage | null
}

export type ModelCallOutcome =
  | { state: 'ok'; response: ModelResponse }
  | { state: 'failed'; category: RunFailureCategory }

export interface ModelClientConfig {
  apiKey: string
  /** Injected so tests drive a fake transport and never touch the network. */
  fetch?: typeof globalThis.fetch
}

/**
 * HTTP status onto the analysis failure vocabulary.
 *
 * Bounded on purpose: `RunFailure` categories reach logs, metrics and read
 * models, so nothing a provider wrote may travel with them.
 */
export function categoryForStatus(status: number): RunFailureCategory {
  if (status === 401 || status === 403) return 'provider-unavailable'
  if (status === 404) return 'provider-error'
  if (status === 429) return 'provider-unavailable'
  if (status >= 500) return 'provider-unavailable'
  return 'provider-error'
}

/**
 * Sends one message request.
 *
 * Returns an outcome rather than throwing, so the pipeline's attempt loop reads
 * one shape. A thrown transport error becomes `provider-unavailable`: the call
 * did not reach a provider that answered.
 */
export async function callModel(
  request: ModelRequest,
  config: ModelClientConfig,
  signal: AbortSignal,
): Promise<ModelCallOutcome> {
  const doFetch = config.fetch ?? globalThis.fetch

  let response: Response
  try {
    response = await doFetch(MESSAGES_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': API_VERSION,
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      }),
    })
  } catch {
    /*
     * Deliberately swallows the error object. It carries provider and network
     * text, and the whole point of the bounded category is that none of that
     * reaches the record.
     */
    return { state: 'failed', category: 'provider-unavailable' }
  }

  if (!response.ok) {
    return { state: 'failed', category: categoryForStatus(response.status) }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { state: 'failed', category: 'malformed-output' }
  }

  const parsed = readMessage(body)
  return parsed
    ? { state: 'ok', response: parsed }
    : { state: 'failed', category: 'malformed-output' }
}

/** Reads the response envelope defensively; anything unexpected is malformed. */
function readMessage(body: unknown): ModelResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const message = body as Record<string, unknown>

  const model = typeof message.model === 'string' ? message.model : null
  if (!model) return null

  if (!Array.isArray(message.content)) return null
  const text = message.content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('')

  return { model, text, usage: readUsage(message.usage) }
}

/**
 * Usage where the provider reported it.
 *
 * `null` rather than zero when absent: "we did not record this" is a state,
 * and zero is a measurement. `RunUsage` draws the same line.
 */
function readUsage(value: unknown): ModelUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const usage = value as Record<string, unknown>
  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null
  return { inputTokens, outputTokens }
}
