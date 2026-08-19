/**
 * What the firm already knows about its own evidence, said out loud to the desk.
 *
 * ## The measured problem this fixes
 *
 * The C2-2 live acceptance recorded it: given one undescribed yield reading,
 * Global Macro produced two `supported` observations and **five
 * `insufficient-evidence` claims**, refusing to characterise the regime, the
 * policy path, a comparison, a rates view or an FX view. The desk behaved
 * correctly. What it received was
 *
 *     - id: 46e2f56…
 *       value: {"yieldPercent":"2.41","observationDate":"2026-08-15"}
 *
 * and it was never told that this was a German ten-year government bond yield
 * published by the ECB for 15 August at central-bank trust. Every one of those
 * facts was sitting on `item.ref` and `item.provenance` and none was sent. This
 * is an investment-decision-quality defect, not prompt decoration: the model was
 * asked to reason about a number whose meaning the institution held and withheld.
 *
 * ## It is a rendering of the record, never a second model of it
 *
 * Gate §0.9: **no parallel evidence schema merely for prompts.** Every field
 * below is read from the `EvidenceSet` — from `ref`, from `provenance`, from
 * the stored payload — and nothing is computed, inferred, prettified or looked
 * up in a table of display names. There is no mapping from `rate:us10y` to
 * "US 10-year Treasury" here, because the institution does not hold one; what
 * it holds is a subject, a kind, a source, a methodology, a series id and a
 * reference period, and all of those are stated.
 *
 * **Citation identity is untouched.** The observation id the desk is shown is
 * the canonical one, and it is the only string it may cite by. `citeFrom` still
 * refuses anything not in the set, so the wider description cannot widen what
 * can be cited.
 *
 * ## What it deliberately does not do
 *
 * It does not derive. A spread the firm computed is a **member of the set**, put
 * there by `AssembleEvidenceSet` and read from the store like any other
 * observation, and this module renders its inputs so the desk can see the
 * lineage rather than recomputing the arithmetic. Gate §0.5 forbids a prompt
 * computing one, and the way to make that hold is to give the desk the derived
 * fact and its inputs.
 */

import type { EvidenceItem, EvidenceSet, TemporalSpread } from '~/domain/analysis'
import { effectiveTrust } from '~/domain/shared/provenance'

/**
 * The payload fields that name a unit, per observation kind.
 *
 * Not new information: these are the projected field names the identity module
 * already hashes, read back as what they say they are. `yieldPercent` is a
 * percent, `slopeBasisPoints` is basis points, and stating so is transcription
 * rather than interpretation.
 *
 * A kind absent here renders its payload verbatim. That is the honest fallback:
 * an unrecognised kind must not be described in units nobody declared.
 */
const MEASURES: Record<string, { field: string; unit: string }> = {
  yield: { field: 'yieldPercent', unit: 'percent per annum' },
  'derived-spread': { field: 'slopeBasisPoints', unit: 'basis points' },
  quote: { field: 'value', unit: 'price' },
  'policy-state': { field: 'ratePercent', unit: 'percent per annum' },
}

/** One input a derived observation was computed from, as the payload states it. */
export interface DerivedInput {
  role: string
  observationId: string
  contentHash: string
}

/** One observation, with the institutional semantics the firm holds for it. */
export interface ObservationBriefing {
  /** The canonical citation identity. The only string a claim may cite by. */
  observationId: string
  subjectKind: string
  subject: string
  kind: string
  /** The measured figure, where the kind declares which field carries it. */
  measure: string | null
  unit: string | null
  /** The whole payload, always — so nothing is hidden by the measure shortcut. */
  value: string
  sourceId: string
  sourceName: string
  /** Who actually produced the numbers, when it differs from the route. */
  originator?: string
  /** The weaker of route and originator, as `effectiveTrust` already rules. */
  trust: string
  quality: string
  /** What the figure DESCRIBES. Absent on a v1 observation, and said to be. */
  referencePeriod?: string
  /** When the source PUBLISHED it. */
  observedAt: string
  /** As-of, and how precisely the source pinned it. */
  asOf: string
  asOfPrecision: string
  seriesId?: string
  methodology?: string
  /** Present exactly when the firm derived this fact from others. */
  derivedFrom?: readonly DerivedInput[]
}

export interface EvidenceBriefing {
  evidenceSetId: string
  assembledAt: string
  observations: readonly ObservationBriefing[]
  /** Both axes, because for macro evidence they differ and the second matters. */
  coTemporality: { publication: string; reference: string }
  /** Two different sources describing the same period differently. */
  disagreements: readonly string[]
  /** One source restating the same period. Never folded into the above. */
  revisions: readonly string[]
}

/** `2026-08-14` / `mixed 2026-08-12..2026-08-14` / `unstated`. Never invented. */
function describeSpread(spread: TemporalSpread): string {
  switch (spread.kind) {
    case 'empty':
      return 'no observations'
    case 'aligned':
      return `aligned at ${spread.at}`
    case 'mixed':
      return `mixed, ${spread.earliest} to ${spread.latest}`
    case 'unstated':
      return 'unstated for at least one observation'
  }
}

/** The payload's `inputs`, exactly as `deriveObservations` wrote them. */
function derivedInputs(value: unknown): readonly DerivedInput[] | undefined {
  const inputs = (value as { inputs?: unknown }).inputs
  if (!Array.isArray(inputs)) return undefined
  const out: DerivedInput[] = []
  for (const entry of inputs) {
    if (!Array.isArray(entry) || entry.length < 3) continue
    const [role, observationId, contentHash] = entry as unknown[]
    if (
      typeof role !== 'string' ||
      typeof observationId !== 'string' ||
      typeof contentHash !== 'string'
    ) {
      continue
    }
    out.push({ role, observationId, contentHash })
  }
  return out.length > 0 ? out : undefined
}

function briefItem(item: EvidenceItem): ObservationBriefing {
  const measure = MEASURES[item.ref.kind]
  const raw = item.value as Record<string, unknown>
  const figure = measure ? raw[measure.field] : undefined
  const source = item.provenance.source

  return {
    observationId: item.ref.id,
    subjectKind: item.ref.subjectKind,
    subject: item.ref.subject,
    kind: item.ref.kind,
    measure: typeof figure === 'string' || typeof figure === 'number' ? String(figure) : null,
    unit: measure && figure !== undefined ? measure.unit : null,
    value: JSON.stringify(item.value),
    sourceId: source.providerId,
    sourceName: source.providerName,
    ...(source.originator === undefined ? {} : { originator: source.originator }),
    /*
     * The weaker of route and originator, through the domain's own function. A
     * briefing that reported the route's trust would tell a desk a Refinitiv
     * series republished by a central bank is central-bank grade, which is the
     * laundering `effectiveTrust` exists to prevent.
     */
    trust: effectiveTrust(source.trust ?? 'aggregator', source.originatorTrust),
    quality: item.provenance.quality,
    ...(item.ref.referencePeriod === undefined
      ? {}
      : { referencePeriod: item.ref.referencePeriod }),
    observedAt: item.ref.observedAt,
    asOf: item.provenance.asOf,
    asOfPrecision: item.provenance.asOfPrecision,
    ...(item.ref.seriesId === undefined ? {} : { seriesId: item.ref.seriesId }),
    ...(item.ref.methodology === undefined ? {} : { methodology: item.ref.methodology }),
    ...(derivedInputs(item.value) === undefined
      ? {}
      : { derivedFrom: derivedInputs(item.value) }),
  }
}

/** The set, as the institution describes it. Typed, so nothing is stringly-known. */
export function briefEvidenceSet(set: EvidenceSet): EvidenceBriefing {
  return {
    evidenceSetId: set.id,
    assembledAt: set.assembledAt,
    observations: set.items.map(briefItem),
    coTemporality: {
      publication: describeSpread(set.coTemporality.publication),
      reference: describeSpread(set.coTemporality.reference),
    },
    disagreements: set.disagreements.map(
      (disagreement) =>
        `${disagreement.subject} (${disagreement.kind}) for ` +
        `${disagreement.referencePeriod ?? 'an unstated period'}: sources ` +
        `${[...new Set(disagreement.sourceIds)].join(', ')} do not agree`,
    ),
    revisions: set.revisions.map(
      (revision) =>
        `${revision.subject} (${revision.kind}) for ` +
        `${revision.referencePeriod ?? 'an unstated period'}: ${revision.sourceId} ` +
        `restated it ${revision.versions.length} times, latest published ` +
        `${revision.versions[revision.versions.length - 1]!.observedAt}`,
    ),
  }
}

/** One observation as prompt text. Every line is a field the firm holds. */
function renderObservation(observation: ObservationBriefing): string {
  const lines = [
    `- id: ${observation.observationId}`,
    `  subject: ${observation.subject} (${observation.subjectKind})`,
    `  kind: ${observation.kind}`,
  ]
  if (observation.measure !== null) {
    lines.push(`  measure: ${observation.measure} ${observation.unit}`)
  }
  lines.push(`  value: ${observation.value}`)
  if (observation.referencePeriod !== undefined) {
    lines.push(`  reference period (what it describes): ${observation.referencePeriod}`)
  } else {
    lines.push('  reference period: not stated by this observation')
  }
  lines.push(`  published by source at: ${observation.observedAt}`)
  lines.push(`  as of: ${observation.asOf} (precision: ${observation.asOfPrecision})`)
  lines.push(
    `  source: ${observation.sourceName} (${observation.sourceId})` +
      (observation.originator === undefined
        ? ''
        : `, originator ${observation.originator}`),
  )
  lines.push(`  trust: ${observation.trust}; quality: ${observation.quality}`)
  if (observation.seriesId !== undefined) lines.push(`  series: ${observation.seriesId}`)
  if (observation.methodology !== undefined) {
    lines.push(`  methodology: ${observation.methodology}`)
  }
  if (observation.derivedFrom !== undefined) {
    lines.push(
      '  derived by the firm from: ' +
        observation.derivedFrom
          .map((input) => `${input.role}=${input.observationId}`)
          .join(', '),
    )
  }
  return lines.join('\n')
}

/**
 * The briefing as prompt text.
 *
 * Rendered from the typed briefing rather than from the set, so what a test
 * asserts and what a desk reads cannot diverge.
 */
export function renderEvidenceBriefing(briefing: EvidenceBriefing): string {
  const sections = [
    `Evidence set ${briefing.evidenceSetId}, assembled ${briefing.assembledAt}.`,
    `Co-temporality — publication: ${briefing.coTemporality.publication}; ` +
      `reference period: ${briefing.coTemporality.reference}.`,
  ]
  if (briefing.disagreements.length > 0) {
    sections.push(
      ['Source disagreements the firm recorded:', ...briefing.disagreements.map(bullet)].join(
        '\n',
      ),
    )
  }
  if (briefing.revisions.length > 0) {
    sections.push(
      ['Revisions the firm recorded:', ...briefing.revisions.map(bullet)].join('\n'),
    )
  }
  sections.push(
    [
      `Observations (${briefing.observations.length}):`,
      ...briefing.observations.map(renderObservation),
    ].join('\n'),
  )
  return sections.join('\n\n')
}

const bullet = (line: string) => `- ${line}`
