/**
 * Row-level disclosure for market observations.
 *
 * ## The defect this exists to close
 *
 * The domain has always known what a number is: `Envelope<T>` is a
 * discriminated union — `ok | stale | fixture | error` — carrying full
 * `Provenance` with the observation's own `asOf`, its source and its quality.
 * That survived intact all the way into the application layer.
 *
 * Then every market surface read it through `dataOr`, which returns the data
 * and **throws the state and the provenance away**. What reached the screen was
 * a bare number, and the only thing left to disclose with was one boolean on
 * the whole snapshot: `hasDegradedCategory`. A reader looking at an index level
 * could be told that *something* on the page was not current, but never which
 * number, or why, or how old.
 *
 * This module is the missing step. It projects an envelope into the disclosure
 * the row itself needs, so trustworthiness is a property of the observation
 * rather than an inference from a footnote.
 *
 * ## Fixture is not stale, and the difference is the point
 *
 *   ok           a current observation from a live source
 *   delayed      a real observation, on a delayed or proxied feed
 *   stale        a real observation, served past its freshness window
 *   fixture      **not market evidence at all** — a constant in the repository
 *   unavailable  nothing could be resolved
 *
 * Stale and fixture are frequently conflated because both are "not live". They
 * are not equivalent. A stale quote is something the market really printed,
 * and its age is the disclosure. A fixture value was never observed anywhere,
 * and no age can be honestly attached to it.
 *
 * ## Why a fixture row carries no timestamp
 *
 * `fixtureProvenance` stamps `asOf: now.toISOString()` — the fixture ages its
 * timestamps but never its values, so a constant from a year ago arrives
 * carrying a timestamp of thirty seconds ago. Rendering that as an observation
 * time would restate the original defect in a more confident voice.
 *
 * So `observedAt` is **null** for fixture, by construction, and every caller
 * has to say "fixture" instead of saying "updated at". That is not a rendering
 * convention a surface may opt out of: the field it would need simply is not
 * there.
 */

import type {
  Envelope,
  Provenance,
  Quality,
  StaleReason,
} from '~/domain/shared/provenance'
import type { CanonicalSymbol, SessionState } from '~/domain/market'
import { horizonFor, observationFreshness } from '~/application/marketData/freshness'

export type DisclosureState = 'ok' | 'delayed' | 'stale' | 'fixture' | 'unavailable'

/**
 * How Financial OS obtained the observation — never how old it is.
 *
 *   fresh         a provider answered, or the cache was inside its TTL
 *   revalidating  served from cache past its TTL while a refresh runs behind
 *   degraded      no provider answered; a retained or fabricated value stood in
 *
 * Kept for inspection and telemetry, and deliberately given no marker of its
 * own. `revalidating` in particular is a statement about our request pacing:
 * the observation it carries may be seconds old, and reporting it to a reader
 * as INAKTUELL was the defect this split exists to close.
 */
export type DeliveryState = 'fresh' | 'revalidating' | 'degraded'

export interface Delivery {
  state: DeliveryState
  /** The resolver's own reason, when it had one. Diagnostics only. */
  reason: StaleReason | null
}

/** What a row needs to know about the observation it is about to render. */
export interface ObservationContext {
  /** Selects the freshness horizon. Absent falls back to the shortest one. */
  symbol?: CanonicalSymbol | null
  /**
   * The provider's own session state for this observation. `'unknown'` when
   * the provider does not say — never guessed from a local clock.
   */
  session?: SessionState
}

export interface Disclosure {
  state: DisclosureState
  /**
   * The short label a row shows beside the value. `null` when the observation
   * is current — absence of a marker is what makes presence of one meaningful.
   */
  marker: string | null
  /** One sentence for inspection: what this number is, and where it came from. */
  detail: string
  /**
   * When the market actually printed it. ISO 8601.
   *
   * `null` whenever no honest observation time exists — fixture data and
   * failures. Never the time the envelope was assembled.
   */
  observedAt: string | null
  quality: Quality | null
  sourceName: string | null
  /**
   * Delivery state, for inspection. Never drives `marker` — see `Delivery`.
   */
  delivery: Delivery
}

/** Whether a row may be read as a current market observation. */
export function isCurrent(disclosure: Disclosure): boolean {
  return disclosure.state === 'ok'
}

const attribution = (provenance: Provenance): string =>
  provenance.source.originator ?? provenance.source.providerName

/**
 * How the envelope was delivered. Never how old its observation is.
 *
 * `no-fresh-source` under stale-while-revalidate is the case worth naming: it
 * means the cache passed its TTL and a refresh is running behind the response.
 * That is request pacing, so it reports `revalidating` and produces no marker.
 * Every other stale reason names a genuine failure — rate limits, an open
 * circuit, a dead network — and reports `degraded`.
 */
export function deliveryOf(envelope: Envelope<unknown>): Delivery {
  switch (envelope.state) {
    case 'ok':
      return { state: 'fresh', reason: null }
    case 'stale':
      return {
        state: envelope.staleReason === 'no-fresh-source' ? 'revalidating' : 'degraded',
        reason: envelope.staleReason,
      }
    case 'fixture':
    case 'error':
      return { state: 'degraded', reason: null }
    case 'loading':
      return { state: 'revalidating', reason: null }
  }
}

/**
 * The disclosure for one envelope, with no observation context.
 *
 * Used where there is no single observation to describe — a panel that
 * resolved to nothing, or a value with no session and no symbol. It still
 * reports envelope state directly, which is correct for `fixture` and `error`
 * and coarse for `stale`.
 *
 * **Not for a market row.** A row has an observation, and an observation has
 * an age and a session; `discloseObservation` is the function that judges
 * those. Routing a row through here reintroduces exactly the conflation this
 * module was split to remove. `marketDisclosure.test.ts` enforces it.
 */
export function disclose(envelope: Envelope<unknown>): Disclosure {
  switch (envelope.state) {
    case 'ok': {
      const source = attribution(envelope.provenance)
      /*
       * An `ok` envelope is not automatically a live one: a delayed venue feed
       * or a proxied instrument resolves successfully and is still not what a
       * reader assumes an unmarked number to be.
       */
      const degraded = envelope.provenance.isDelayed || envelope.provenance.isProxy
      return {
        state: degraded ? 'delayed' : 'ok',
        marker: degraded ? 'Fördröjd' : null,
        detail: degraded
          ? `Fördröjd notering från ${source}.`
          : `Aktuell notering från ${source}.`,
        observedAt: envelope.provenance.asOf,
        quality: envelope.provenance.quality,
        sourceName: source,
        delivery: deliveryOf(envelope),
      }
    }

    case 'stale': {
      const source = attribution(envelope.provenance)
      return {
        state: 'stale',
        marker: 'Inaktuell',
        detail: `Inaktuell notering från ${source}. Ingen färsk källa vid hämtningen.`,
        observedAt: envelope.provenance.asOf,
        quality: envelope.provenance.quality,
        sourceName: source,
        delivery: deliveryOf(envelope),
      }
    }

    case 'fixture':
      return {
        state: 'fixture',
        marker: 'Ej marknadsdata',
        /*
         * No source and no time. The value is a constant in the repository;
         * naming a provider for it would attribute a number to somebody who
         * never published it.
         */
        detail: 'Fixturdata. Ingen marknadsobservation ligger bakom värdet.',
        observedAt: null,
        quality: 'fixture',
        sourceName: null,
        delivery: deliveryOf(envelope),
      }

    case 'error':
      return {
        state: 'unavailable',
        marker: 'Otillgänglig',
        detail: 'Kunde inte hämtas.',
        observedAt: null,
        quality: null,
        sourceName: null,
        delivery: deliveryOf(envelope),
      }

    case 'loading':
      return {
        state: 'unavailable',
        marker: null,
        detail: 'Hämtas.',
        observedAt: null,
        quality: null,
        sourceName: null,
        delivery: deliveryOf(envelope),
      }
  }
}

/**
 * The disclosure for one observation.
 *
 * ## Why this exists as well as `disclose`
 *
 * Some categories are assembled from more than one source. The Overview's
 * index panel is the case that forced it: Swedish indices come from Avanza,
 * international ones from Yahoo, and `combineBySymbol` merges them reporting
 * **the worst state of the parts**. Right for a panel, wrong for a row — it
 * labels a real Avanza quote by whatever happened to its neighbour.
 *
 * ## The precedence, and why age outranks delay
 *
 *   1. fixture       not market evidence at all
 *   2. unavailable   nothing resolved
 *   3. stale         the observation is too old for its own session
 *   4. delayed       real and current, on a feed with no realtime guarantee
 *   5. current       no marker
 *
 * Age sits above delay deliberately. Every Yahoo observation carries
 * `isDelayed`, so if delay won, a Yahoo row could never be reported stale
 * however old it got, and a level from before lunch would still read FÖRDRÖJD
 * at the close. The two words answer different questions and both must stay
 * reachable:
 *
 *   FÖRDRÖJD    a real observation, current enough for this session, from a
 *               source that guarantees no realtime
 *   INAKTUELL   the observation itself is now too old for this session
 *
 * ## What the envelope no longer decides
 *
 * `Envelope.state` is not consulted for the marker beyond distinguishing "has
 * an observation" from "has none". Its `stale` is a delivery fact — the cache
 * passed its TTL, or no provider answered — and it lands in `delivery` where
 * an operator can see it. The defect that prompted the split: a seven-second
 * S&P observation in an open session, served under stale-while-revalidate,
 * rendered INAKTUELL. Nothing about the market had changed; only our cache had.
 */
export function discloseObservation(
  provenance: Provenance,
  envelope: Envelope<unknown>,
  context: ObservationContext = {},
): Disclosure {
  const delivery = deliveryOf(envelope)

  /* Not market evidence, whatever the rest of the panel managed to resolve. */
  if (provenance.quality === 'fixture') {
    return {
      state: 'fixture',
      marker: 'Ej marknadsdata',
      detail: 'Fixturdata. Ingen marknadsobservation ligger bakom värdet.',
      observedAt: null,
      quality: 'fixture',
      sourceName: null,
      delivery,
    }
  }

  /* No observation to describe: the envelope is the only fact available. */
  if (envelope.state === 'error' || envelope.state === 'loading') {
    return disclose(envelope)
  }

  const source = attribution(provenance)
  const base = {
    observedAt: provenance.asOf,
    quality: provenance.quality,
    sourceName: source,
    delivery,
  }

  const freshness = observationFreshness({
    quality: provenance.quality,
    session: context.session ?? 'unknown',
    ageMs: provenance.ageMs,
    horizon: horizonFor(context.symbol),
  })

  if (freshness === 'stale') {
    return {
      ...base,
      state: 'stale',
      marker: 'Inaktuell',
      detail: `Inaktuell notering från ${source}. Observationen är för gammal för marknadsläget.`,
    }
  }

  if (provenance.isDelayed || provenance.isProxy) {
    return {
      ...base,
      state: 'delayed',
      marker: 'Fördröjd',
      detail: `Fördröjd notering från ${source}.`,
    }
  }

  return {
    ...base,
    state: 'ok',
    marker: null,
    detail: `Aktuell notering från ${source}.`,
  }
}

/**
 * The disclosure for an envelope that carries a single observation.
 *
 * The bridge for panels whose value is one observation rather than a list —
 * sentiment is the case. It judges the observation when there is one and falls
 * back to envelope state when there is not, so a panel gets the same
 * age-before-delivery treatment a row does.
 */
export function discloseEnvelope(
  envelope: Envelope<unknown>,
  context: ObservationContext = {},
): Disclosure {
  if (envelope.state === 'error' || envelope.state === 'loading')
    return disclose(envelope)
  return discloseObservation(envelope.provenance, envelope, context)
}

/**
 * An envelope's rows together with the disclosure that governs them.
 *
 * The replacement for `dataOr` on any surface presenting a number as current
 * market context. It returns the same rows, and it makes the state impossible
 * to drop on the floor: a caller that wants the data has the disclosure in the
 * same object.
 */
export function disclosedRows<T>(envelope: Envelope<T[]>): {
  rows: readonly T[]
  disclosure: Disclosure
} {
  const disclosure = disclose(envelope)
  const rows =
    envelope.state === 'ok' || envelope.state === 'stale' || envelope.state === 'fixture'
      ? envelope.data
      : []
  return { rows, disclosure }
}

/**
 * `HH:MM` for an observation time.
 *
 * Takes `observedAt`, which is `null` exactly where no honest time exists — so
 * a fixture row cannot be given one by reaching for a different field.
 */
export function observedClock(observedAt: string | null): string | null {
  if (observedAt === null) return null
  const date = new Date(observedAt)
  if (Number.isNaN(date.getTime())) return null
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The inspection string a row hangs on `title`: what it is, and when. */
export function disclosureTitle(disclosure: Disclosure): string {
  const clock = observedClock(disclosure.observedAt)
  return clock === null ? disclosure.detail : `${disclosure.detail} Observerad ${clock}.`
}
