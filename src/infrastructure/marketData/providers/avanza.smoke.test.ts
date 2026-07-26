/**
 * Order book id drift check. **Not part of CI.**
 *
 * This is the only test in the repository that touches the network, and it is
 * skipped unless `AVANZA_SMOKE=1`. Deterministic CI must stay offline, so the
 * committed identity table is verified against recorded payloads there and
 * against Avanza itself only here.
 *
 * Run it before a release, after a data incident, or whenever a price looks
 * wrong for one instrument but right for the others:
 *
 *     AVANZA_SMOKE=1 npx vitest run src/infrastructure/marketData/providers/avanza.smoke.test.ts
 *
 * It needs `uvx` on PATH or `AVANZA_MCP_UVX_PATH` pointing at it.
 *
 * ## What it is actually looking for
 *
 * A *retired* id is already loud in production: the payload arrives without
 * `last` or `timeOfLast`, the adapter raises a schema error rather than
 * inventing a value, and the category degrades visibly. A **reassigned** id is
 * the silent one — a plausible price for the wrong company — and that is why
 * the ISIN is asserted rather than the display name. Avanza can rename an
 * instrument; the ISIN identifies the security itself.
 */

import { describe, expect, it } from 'vitest'
import { AVANZA_INSTRUMENTS } from './avanza/map'

const ENABLED = process.env.AVANZA_SMOKE === '1'

interface StockInfo {
  name?: string
  isin?: string
  listing?: { tickerSymbol?: string; marketPlaceCode?: string }
}

describe.skipIf(!ENABLED)(
  'order book ids still resolve to the expected instruments',
  () => {
    it.each(AVANZA_INSTRUMENTS.map((i) => [i.expectedTicker, i] as const))(
      '%s',
      async (_ticker, instrument) => {
        const { callAvanzaTool } = await import('~/services/avanzaMcp/client')
        const info = await callAvanzaTool<StockInfo>('get_stock_info', {
          instrument_id: instrument.orderBookId,
        })

        // The identity that survives a rename.
        expect(info?.isin).toBe(instrument.expectedIsin)
        expect(info?.listing?.tickerSymbol).toBe(instrument.expectedTicker)
        expect(info?.name).toBe(instrument.expectedName)

        // And the venue attribution the adapter copies rather than assumes.
        const mic = info?.listing?.marketPlaceCode
        expect(mic === 'XXXX' ? null : (mic ?? null)).toBe(instrument.venueMic)
      },
      30_000,
    )
  },
)
