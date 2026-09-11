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
  SYM_BRENT,
  SYM_DAX,
  SYM_GOLD,
  SYM_EVO,
  SYM_INVE_B,
  SYM_NASDAQ100,
  SYM_NIKKEI225,
  SYM_OMXS30,
  SYM_SEB_A,
  SYM_VOLV_B,
  type CanonicalSymbol,
} from '~/domain/market'

/**
 * How strongly a binding can prove it fetched what it meant to fetch.
 *
 * The two classes are **not** equivalent, and the model says so rather than
 * leaving a reader to infer it from the field names.
 *
 * `strong` rests on a securities identifier issued by somebody other than
 * Avanza. `DE0008469008` is the DAX and nothing else, whatever the instrument
 * is called this quarter and whichever order book id points at it — so a
 * reassigned id is caught by a single field that Avanza did not choose.
 *
 * `composite` has no such anchor. Avanza's commodity spot quotes carry
 * `isin: "GC"` and `isin: "BRENT"` — placeholders in the ISIN field, not ISINs,
 * and they prove nothing on their own. What stands in for the anchor is
 * agreement across several independent fields at once, all of which would have
 * to change together for a wrong instrument to pass. That is real evidence and
 * it fails closed exactly as `strong` does, but it is weaker evidence, and it
 * must never be described as ISIN-equivalent.
 */
export type AvanzaIdentity =
  | {
      class: 'strong'
      /** A genuine ISIN, issued outside Avanza. */
      isin: string
    }
  | {
      class: 'composite'
      /**
       * Whatever Avanza puts in the `isin` field for this instrument. A stable
       * placeholder such as `"GC"` or `"BRENT"` — checked by exact match
       * because a change in it is a signal, NOT because it identifies the
       * instrument the way an ISIN would.
       */
      identifier: string
      /**
       * Avanza's `subType`, recorded from `search_instruments`.
       *
       * **Not verifiable at fetch time.** `get_stock_info` does not return
       * `subType`, so this documents what was reviewed rather than something
       * the adapter asserts on every response. Verifying it would mean a
       * second call to the fuzzy search endpoint, which the top of this file
       * rules out as an identity source.
       */
      reviewedSubType: string
    }

/**
 * Where an instrument's trading session comes from.
 *
 * `venue` trusts Avanza's own `marketPlace.currentStatus` for the instrument.
 * Correct for the indices: each carries its own venue schedule.
 *
 * `unknown` is for instruments where Avanza's schedule describes **its own
 * quoting window rather than the market**. Gold and Brent come back with a
 * 09:00-17:30 Stockholm beQuoted schedule; the underlying commodity markets
 * trade nearly around the clock, so reporting `closed` at 18:00 CET would be a
 * statement about Avanza's opening hours dressed as a statement about the gold
 * market — and it would hand a stalled feed the multi-day closed-session
 * freshness allowance overnight.
 *
 * Saying `unknown` is the honest answer and the conservative one: the frozen
 * freshness policy gives an unknown session the intraday horizon.
 */
export type AvanzaSessionModel = 'venue' | 'unknown'

export interface AvanzaInstrument {
  symbol: CanonicalSymbol
  orderBookId: string
  /** Avanza's `listing.tickerSymbol`. Asserted by the smoke test. */
  expectedTicker: string
  /** Avanza's `name`. Asserted by the smoke test. */
  expectedName: string
  /** What this binding can and cannot prove about what it fetched. */
  identity: AvanzaIdentity
  /** Whose schedule the observation's session comes from. */
  sessionModel: AvanzaSessionModel
  /**
   * Avanza's own `type` discriminator, asserted at fetch time.
   *
   * The one field separating an index from the wall of instruments written on
   * it. Avanza lists `BULL DAX X20`, `BEAR DAX X20`, 746 DAX certificates,
   * 2249 DAX warrants and eight DAX ETFs beside the index itself, and every
   * one of them returns a plausible number. A binding that checked only an
   * order book id would serve whichever of those the id points at tomorrow.
   */
  expectedType: 'INDEX' | 'STOCK'
  /**
   * Which Avanza call this binding is fetched with.
   *
   * `info` uses `get_stock_info`, which returns the ISIN and the type
   * alongside the price and so lets the fetch verify its own identity. `quote`
   * uses `get_stock_quote`, which does not.
   *
   * **OMXS30 stays on `quote` deliberately.** It is a working production path
   * with its own recorded payload fixtures, and moving it would rewrite tests
   * that assert against real captured responses without making the number any
   * more correct. Migrating it to `info` is a worthwhile follow-up — it would
   * gain the same identity verification the new bindings have — but it is not
   * part of adding them.
   */
  fetchWith: 'quote' | 'info'
  /**
   * ISO 10383 MIC, or `null` when Avanza does not attribute the instrument to
   * a venue. OMXS30 comes back as `XXXX` / "Inofficiella (beQuoted)", which is
   * the placeholder for "no market applicable" — so it gets `null` rather than
   * an XSTO we would be asserting on Avanza's behalf.
   */
  venueMic: string | null
}

/** The instruments visible on the Overview. Nothing else is in scope. */
export const AVANZA_INSTRUMENTS: readonly AvanzaInstrument[] = Object.freeze([
  {
    symbol: SYM_OMXS30,
    orderBookId: '19002',
    expectedTicker: 'OMXS30',
    expectedName: 'OMX Stockholm 30',
    identity: { class: 'strong', isin: 'SE0000337842' },
    sessionModel: 'venue',
    expectedType: 'INDEX',
    fetchWith: 'quote',
    venueMic: null,
  },
  {
    symbol: SYM_INVE_B,
    orderBookId: '5247',
    expectedTicker: 'INVE B',
    expectedName: 'Investor B',
    identity: { class: 'strong', isin: 'SE0015811963' },
    sessionModel: 'venue',
    expectedType: 'STOCK',
    fetchWith: 'quote',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_VOLV_B,
    orderBookId: '5269',
    expectedTicker: 'VOLV B',
    expectedName: 'Volvo B',
    identity: { class: 'strong', isin: 'SE0000115446' },
    sessionModel: 'venue',
    expectedType: 'STOCK',
    fetchWith: 'quote',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_EVO,
    orderBookId: '549768',
    expectedTicker: 'EVO',
    expectedName: 'Evolution',
    identity: { class: 'strong', isin: 'SE0012673267' },
    sessionModel: 'venue',
    expectedType: 'STOCK',
    fetchWith: 'quote',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_AZA,
    orderBookId: '5361',
    expectedTicker: 'AZA',
    expectedName: 'Avanza Bank Holding',
    identity: { class: 'strong', isin: 'SE0012454072' },
    sessionModel: 'venue',
    expectedType: 'STOCK',
    fetchWith: 'quote',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_ATCO_A,
    orderBookId: '5234',
    expectedTicker: 'ATCO A',
    expectedName: 'Atlas Copco A',
    identity: { class: 'strong', isin: 'SE0017486889' },
    sessionModel: 'venue',
    expectedType: 'STOCK',
    fetchWith: 'quote',
    venueMic: 'XSTO',
  },
  {
    symbol: SYM_SEB_A,
    orderBookId: '5255',
    expectedTicker: 'SEB A',
    expectedName: 'SEB A',
    identity: { class: 'strong', isin: 'SE0000148884' },
    sessionModel: 'venue',
    expectedType: 'STOCK',
    fetchWith: 'quote',
    venueMic: 'XSTO',
  },

  /* ------------------------------------------- international index levels */

  /*
   * Discovered by probing Avanza on 2026-08-24 and reviewed before being
   * written down, exactly as the Swedish instruments were. Each returned
   * `type: "INDEX"` with an ISIN from `get_stock_info`.
   *
   * **S&P 500 and FTSE 100 are deliberately absent.** Neither exists as an
   * index in Avanza's corpus: `"S&P 500"` and `"SPX"` returned 110 and 297
   * hits between them with not one of type INDEX, and `"FTSE 100"` returned
   * eight results, all exchange-traded funds. They stay fixture-backed rather
   * than being served by a fund that tracks them.
   *
   * `venueMic` is null throughout: Avanza reports `XXXX` / "Inofficiella
   * (beQuoted)" for index levels, which is the placeholder for "no market
   * applicable" and not a venue we may assert on its behalf.
   */
  {
    symbol: SYM_DAX,
    orderBookId: '18981',
    expectedTicker: 'DAX',
    expectedName: 'DAX',
    identity: { class: 'strong', isin: 'DE0008469008' },
    sessionModel: 'venue',
    expectedType: 'INDEX',
    fetchWith: 'info',
    venueMic: null,
  },
  {
    symbol: SYM_NASDAQ100,
    orderBookId: '155541',
    expectedTicker: 'NDX',
    expectedName: 'Nasdaq 100',
    identity: { class: 'strong', isin: 'US6311011026' },
    sessionModel: 'venue',
    expectedType: 'INDEX',
    fetchWith: 'info',
    /*
     * Avanza also lists `Nasdaq 100 Pre market` (2115331) and `Nasdaq 100 Post
     * market` (2115339) as separate INDEX instruments with their own levels.
     * This binding is the regular-session index; the other two are different
     * observations and must never be substituted for it.
     */
    venueMic: null,
  },
  {
    symbol: SYM_NIKKEI225,
    orderBookId: '18997',
    expectedTicker: 'NI225',
    expectedName: 'Nikkei',
    identity: { class: 'strong', isin: 'JP9010C00002' },
    sessionModel: 'venue',
    expectedType: 'INDEX',
    fetchWith: 'info',
    venueMic: null,
  },

  /* ------------------------------------------------ commodity spot quotes */

  /*
   * Probed on 2026-08-25. Both are `type: "INDEX"`, `subType: "Råvara"`, quoted
   * through beQuoted with `currency: null` in search results — the same shape
   * as the international index levels above, and emphatically NOT the
   * certificates and warrants that dominate a search for either name (744
   * gold certificates and 1084 gold warrants sit beside this one instrument).
   *
   * ## Spot, not futures — what the evidence actually shows
   *
   * **Gold is well evidenced.** Avanza quoted 4 664,97 against an LBMA PM
   * auction of 4 663,70 the previous day (0,03 % apart) while the COMEX
   * December contract stood at 4 725,10 — 1,3 % higher. That ~60-dollar carry
   * is exactly what a futures proxy would show, and it is absent.
   *
   * **Brent is weaker, and is recorded as weaker.** Avanza quoted 85,69
   * against `BZ=F` at 85,49, 0,23 % apart. The Brent Last Day Financial future
   * settles against the Brent index and tracks it closely, so proximity alone
   * cannot separate the two. What supports the binding is Avanza's own
   * identity — the instrument is named `Brent Spot` and typed as a commodity
   * INDEX — and the fact that Financial OS does not present it as a futures
   * contract. **Numerical proximity to BZ=F is not proof of spot identity and
   * must not be cited as though it were.**
   *
   * ## What these are not
   *
   * Neither is the LBMA Gold Price. That benchmark is administered by ICE
   * Benchmark Administration and requires a licence to obtain, use or
   * redistribute; its public JSON endpoint is deliberately never consulted.
   * A continuously quoted OTC spot observation redistributed by a broker is a
   * different thing from an auction benchmark, and only the former is here.
   *
   * ## Units come from the catalog, never from the payload
   *
   * `listing.currency` is `"SEK"` for both — the same artefact the index
   * bindings ignore. Unlike an index these instruments genuinely have units,
   * and the domain already holds them: USD per troy ounce and USD per barrel.
   * The adapter reads neither field.
   */
  {
    symbol: SYM_GOLD,
    orderBookId: '18986',
    expectedTicker: 'GOLDSP',
    expectedName: 'Guld',
    identity: { class: 'composite', identifier: 'GC', reviewedSubType: 'Råvara' },
    /* Avanza's beQuoted window is not the gold market's session. */
    sessionModel: 'unknown',
    expectedType: 'INDEX',
    fetchWith: 'info',
    venueMic: null,
  },
  {
    symbol: SYM_BRENT,
    orderBookId: '155722',
    /*
     * `listing.tickerSymbol` really is the string `"Brent Spot"`, and `isin`
     * really is `"BRENT"`. Both read from `get_stock_info` on 2026-08-25.
     */
    expectedTicker: 'Brent Spot',
    expectedName: 'Olja',
    identity: { class: 'composite', identifier: 'BRENT', reviewedSubType: 'Råvara' },
    sessionModel: 'unknown',
    expectedType: 'INDEX',
    fetchWith: 'info',
    venueMic: null,
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
        `AVANZA_INSTRUMENTS with its reviewed identity — never resolve it by search.`,
    )
  }
  return instrument
}

export function avanzaCovers(symbol: CanonicalSymbol): boolean {
  return BY_SYMBOL.has(symbol)
}
