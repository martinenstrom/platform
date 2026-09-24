/**
 * What a Sentinel surface may ask the record to do: record the advisor's
 * word on a priority. The route implements it over the server function; a
 * test implements it in memory.
 */

import type { DisposeInput, DisposeResult } from '~/application/advisory/sentinel'

export interface SentinelActions {
  dispose(
    input: DisposeInput,
  ): Promise<DisposeResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }>
}
