/**
 * Canonical symbol → Avanza order book id.
 *
 * ## Why this table is committed rather than searched
 *
 * Avanza's `search_instruments` is a fuzzy relevance search, and it is not
 * safe for identity. Probed live on 2026-07-26 with `instrument_type: 'stock'`:
 *
 *  - `"Atlas Copco A"` → **Atlas Copco B (5235) ranked first**, Atlas Copco A
 *    (5234) second. The wrong share class outranks the exact name it was asked
 *    for.
 *  - `"Investor B"` → Investor B first, then four leveraged BEAR/BULL
 *    certificates written on it.
 *  - `"Evolution"` → Evolution first, then Salmon Evolution (Oslo), Evolution
 *    Petroleum (NYSE American), Helium Evolution (TSXV), Evolution Metals
 *    (NASDAQ) — four different companies on four other venues.
 *  - `"Avanza Bank"` → the share, then customer-support FAQ articles carrying
 *    no `orderBookId` at all.
 *
 * Any of those could become rank one after a relevance-tuning change on
 * Avanza's side, silently swapping a share class or a company underneath a
 * price the UI presents as ours. So identity is fixed here, in review, and
 * `orderBookIdFor` throws on anything it does not know. There is no fallback
 * to search — not on a miss, not on an error, not ever.
 *
 * ## Detecting drift operationally
 *
 * An order book id can be retired or reassigned by Avanza; the deterministic
 * suite cannot see that, because it must not touch the network. Two layers
 * cover it:
 *
 *  1. `avanza.smoke.test.ts` verifies every id still resolves to the expected
 *     ISIN, ticker and name. It is skipped unless `AVANZA_SMOKE=1`, so it never
 *     runs in CI, and is meant for release checks and after a data incident.
 *  2. In production the failure is loud without any extra machinery. A retired
 *     id returns no `last`/`timeOfLast`, the adapter raises a `schema` error
 *     rather than inventing a value, and that surfaces as a provider error on
 *     the category — visible in the health endpoint and the provider error
 *     metric. A *reassigned* id is the dangerous case, and `expectedIsin` is
 *     what makes it detectable: the smoke test compares against the ISIN, not
 *     just the display name.
 *
 * Every field below was read from `get_stock_info` on 2026-07-26.
 */

import {
  SYM_ATCO_A,
  SYM_AZA,
  SYM_EVO,
  SYM_INVE_B,
  SYM_OMXS30,
  SYM_SEB_A,
  SYM_VOLV_B,
  type CanonicalSymbol,
} from '~/domain/market'

export interface AvanzaInstrument {
  symbol: CanonicalSymbol
  orderBookId: string
  /** Avanza's `listing.tickerSymbol`. Asserted by the smoke test. */
  expectedTicker: string
  /** Avanza's `name`. Asserted by the smoke test. */
  expectedName: string
  /** The identity check that survives a rename. */
  expectedIsin: string
  /**
   * ISO 10383 MIC, or `null` when Avanza does not attribute the instrument to
   * a venue. OMXS30 comes back as `XXXX` / "Inofficiella (beQuoted)", which is
   * the placeholder for "no market applicable" — so it gets `null` rather than
   * an XSTO we would be asserting on Avanza's behalf.
   */
  venueMic: string | null
}

/** The seven instruments visible on the Overview. Nothing else is in scope. */
export const AVANZA_INSTRUMENTS: readonly AvanzaInstrument[] = Object.freeze([
  {
    symbol: SYM_OMXS30,
    orderBookId: '19002',
    expectedTicker: 'OMXS30',
    expectedName: 'OMX Stockholm 30',
    expectedIsin: 'SE0000337842',
    venueMic: null,
  },
  {
    symbol: SYM_INVE_B,
    orderBookId: '5247',
    expectedTicker: 'INVE B',
    expectedName: 'Investor B',
    expectedIsin: 'SE0015811963',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_VOLV_B,
    orderBookId: '5269',
    expectedTicker: 'VOLV B',
    expectedName: 'Volvo B',
    expectedIsin: 'SE0000115446',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_EVO,
    orderBookId: '549768',
    expectedTicker: 'EVO',
    expectedName: 'Evolution',
    expectedIsin: 'SE0012673267',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_AZA,
    orderBookId: '5361',
    expectedTicker: 'AZA',
    expectedName: 'Avanza Bank Holding',
    expectedIsin: 'SE0012454072',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_ATCO_A,
    orderBookId: '5234',
    expectedTicker: 'ATCO A',
    expectedName: 'Atlas Copco A',
    expectedIsin: 'SE0017486889',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_SEB_A,
    orderBookId: '5255',
    expectedTicker: 'SEB A',
    expectedName: 'SEB A',
    expectedIsin: 'SE0000148884',
    venueMic: 'XSTO',
  },
])

const BY_SYMBOL: ReadonlyMap<CanonicalSymbol, AvanzaInstrument> = new Map(
  AVANZA_INSTRUMENTS.map((instrument) => [instrument.symbol, instrument]),
)

/**
 * Throws on an unmapped symbol. A miss is a wiring mistake, and the only safe
 * responses are to fail or to guess — guessing is how "Atlas Copco A" becomes
 * Atlas Copco B.
 */
export function orderBookIdFor(symbol: CanonicalSymbol): AvanzaInstrument {
  const instrument = BY_SYMBOL.get(symbol)
  if (!instrument) {
    throw new Error(
      `Avanza has no reviewed order book id for ${symbol}. Add one to ` +
        `AVANZA_INSTRUMENTS with its ISIN — never resolve it by search.`,
    )
  }
  return instrument
}

export function avanzaCovers(symbol: CanonicalSymbol): boolean {
  return BY_SYMBOL.has(symbol)
}
