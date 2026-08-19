/**
 * Evidence fixtures that cannot be internally inconsistent.
 *
 * Fixtures used to pair a declared observation kind with whatever payload was
 * convenient — `kind: 'yield'` beside `{ value }`, which is the *quote*
 * projection's field. Nothing verified the relationship, so nothing noticed.
 * TD61-3C added the verification, and 71 fixtures failed it.
 *
 * These helpers construct the payload, the natural key, the reference and the
 * item **together**, from one kind-specific argument, so the mismatch is not
 * expressible. That is the point: a fixture that can only be built correctly is
 * worth more than a fixture that was checked once.
 *
 * A deliberately inconsistent fixture is still available — see
 * `buildInconsistentEvidenceFixture` — but it is named to say so and belongs to
 * negative tests only.
 */

import { observationRef } from '~/domain/analysis'
import type { EvidenceItem, ObservationRef } from '~/domain/analysis'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'

const AT = '2026-07-28T00:00:00.000Z'

const provenance = (providerId: string) =>
  ({ source: { providerId }, quality: 'ok' }) as never

/* --------------------------------------------------------------- yield */

export interface YieldFixture {
  subject?: string
  sourceId?: string
  observedAt?: string
  seriesId?: string
  methodology?: string
  /** Canonical decimal string, as the market boundary supplies. */
  yieldPercent: string
  changeBasisPoints?: string | null
  observationDate?: string
  /** Extra payload fields outside the projection, to prove they are ignored. */
  metadata?: Record<string, CanonicalValue>
}

export function yieldPayload(fixture: YieldFixture): CanonicalValue {
  return {
    yieldPercent: fixture.yieldPercent,
    changeBasisPoints: fixture.changeBasisPoints ?? null,
    observationDate: fixture.observationDate ?? '2026-07-28',
    ...(fixture.metadata ?? {}),
  }
}

export function yieldRefFixture(fixture: YieldFixture): ObservationRef {
  return observationRef(
    {
      subjectKind: 'instrument',
      subject: fixture.subject ?? 'US10Y',
      kind: 'yield',
      observedAt: fixture.observedAt ?? AT,
      /* Mirrors `yieldRef`: the source's own observation date. */
      referencePeriod: fixture.observationDate ?? '2026-07-28',
      sourceId: fixture.sourceId ?? 'treasury',
      ...(fixture.seriesId === undefined ? {} : { seriesId: fixture.seriesId }),
      ...(fixture.methodology === undefined ? {} : { methodology: fixture.methodology }),
    },
    // The projection, which for this kind is the payload minus any metadata.
    {
      yieldPercent: fixture.yieldPercent,
      changeBasisPoints: fixture.changeBasisPoints ?? null,
      observationDate: fixture.observationDate ?? '2026-07-28',
    },
  )
}

export function buildYieldEvidenceFixture(fixture: YieldFixture): EvidenceItem {
  return {
    ref: yieldRefFixture(fixture),
    value: yieldPayload(fixture),
    provenance: provenance(fixture.sourceId ?? 'treasury'),
  }
}

/* --------------------------------------------------------------- quote */

export interface QuoteFixture {
  subject?: string
  sourceId?: string
  observedAt?: string
  value: string
  absoluteChange?: string | null
  percentageChange?: string | null
  previousClose?: string | null
  metadata?: Record<string, CanonicalValue>
}

const quoteProjection = (fixture: QuoteFixture): CanonicalValue => ({
  value: fixture.value,
  absoluteChange: fixture.absoluteChange ?? null,
  percentageChange: fixture.percentageChange ?? null,
  previousClose: fixture.previousClose ?? null,
})

export function buildQuoteEvidenceFixture(fixture: QuoteFixture): EvidenceItem {
  return {
    ref: observationRef(
      {
        subjectKind: 'instrument',
        subject: fixture.subject ?? 'AAPL',
        kind: 'quote',
        observedAt: fixture.observedAt ?? AT,
        /* Mirrors `quoteRef`: a quote describes the instant it was taken. */
        referencePeriod: fixture.observedAt ?? AT,
        sourceId: fixture.sourceId ?? 'avanza',
      },
      quoteProjection(fixture),
    ),
    value: {
      ...(quoteProjection(fixture) as Record<string, CanonicalValue>),
      ...(fixture.metadata ?? {}),
    },
    provenance: provenance(fixture.sourceId ?? 'avanza'),
  }
}

/* -------------------------------------------------------- policy state */

export interface PolicyStateFixture {
  centralBank?: string
  sourceId?: string
  observedAt?: string
  seriesId?: string
  rateType?: string
  level: CanonicalValue
  effectiveDate?: string | null
  effectiveDateConfidence?: string
  change?: CanonicalValue
  effectiveFedFundsRate?: string
  metadata?: Record<string, CanonicalValue>
}

export function buildPolicyStateEvidenceFixture(
  fixture: PolicyStateFixture,
): EvidenceItem {
  const regime = {
    level: fixture.level,
    effectiveDate: fixture.effectiveDate ?? '2026-06-15',
    effectiveDateConfidence: fixture.effectiveDateConfidence ?? 'exact',
    change: fixture.change ?? null,
  }
  const rate = fixture.effectiveFedFundsRate
  /*
   * Mirrors `policyStateRef`, including its refusal: a regime with no effective
   * date describes no period the firm knows, and a fixture that quietly keyed
   * on the confirmation date instead would test a shape production refuses.
   */
  if (regime.effectiveDate === null) {
    throw new Error(
      'buildPolicyStateEvidenceFixture: a policy state with no effective date ' +
        'has no reference period, and production refuses it. A test that needs ' +
        'that shape wants the refusal, not an observation.',
    )
  }

  return {
    ref: observationRef(
      {
        subjectKind: 'central-bank',
        subject: fixture.centralBank ?? 'riksbank',
        kind: 'policy-state',
        observedAt: fixture.observedAt ?? AT,
        referencePeriod: regime.effectiveDate,
        sourceId: fixture.sourceId ?? 'riksbank',
        ...(fixture.seriesId === undefined ? {} : { seriesId: fixture.seriesId }),
        ...(fixture.rateType === undefined ? {} : { methodology: fixture.rateType }),
      },
      { ...regime, ...(rate === undefined ? {} : { effectiveFedFundsRate: rate }) },
    ),
    value: {
      regime,
      ...(rate === undefined ? {} : { effectiveFedFundsRate: { ratePercent: rate } }),
      ...(fixture.metadata ?? {}),
    },
    provenance: provenance(fixture.sourceId ?? 'riksbank'),
  }
}

/* ------------------------------------------------------------ negative */

/**
 * A deliberately inconsistent item, for tests that need one.
 *
 * Named so it cannot be mistaken for an ordinary fixture, and used only where
 * the inconsistency is the subject of the test. Everything else uses the typed
 * builders above, which cannot express this.
 */
export function buildInconsistentEvidenceFixture(args: {
  ref: ObservationRef
  value: CanonicalValue
}): EvidenceItem {
  return { ref: args.ref, value: args.value, provenance: provenance('fixture') }
}
