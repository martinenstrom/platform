/**
 * The committee table: two desks, a synthesis, and what was disputed.
 *
 * Composition carries the meaning. Macro and Rates sit **facing each other**,
 * equally weighted, because they reached their views independently — playbook
 * v5 blocks neither on the other, and a layout that stacked one above the other
 * would imply a sequence the record does not establish. The synthesis sits
 * below and spans both, joined by a rail that says only what the aggregation
 * says: these two readings were reconciled into that one.
 *
 * ## Hierarchy inside a seat
 *
 * The proposition is the largest thing. Then the desk. Then its epistemic
 * standing. Then, folded away, the provenance. A confidence warning that
 * outranked the position would tell a reader how much to trust a sentence they
 * had not read yet.
 *
 * ## What is drawn, and what is not
 *
 * Every position, objection and consequence is a persisted act. There is no
 * dialogue, no quotation, no "Rates responded" — the firm records claims,
 * challenges and their outcomes, and this arranges those. Where a desk raised
 * nothing, the surface says it examined and raised nothing, which is a finding
 * rather than agreement.
 */

import { personaFor, personaPortrait } from '~/presentation/analysis/agentPersona'
import {
  deskIdentity,
  examinationFinding,
  MATERIALITY,
  OBJECTION_STATUS,
} from '~/presentation/analysis/boardroomText'
import { CONFIDENCE_CAP_LABEL, CONFIDENCE_LEVEL } from '~/presentation/analysis/claimText'
import type {
  BoardroomEntry,
  BoardroomObjection,
} from '~/application/analysis/boardroomTimeline'
import type { CaseOverview } from '~/application/analysis/caseOverview'
import { Inspect } from './Inspect'
import { formatDateTime } from '~/lib/format'
import { cn } from '~/lib/cn'

type Claim = CaseOverview['claims'][number]

export function DebateTable({
  overview,
  analyses,
  synthesis,
  examinations,
}: {
  overview: CaseOverview
  analyses: readonly BoardroomEntry[]
  synthesis: readonly BoardroomEntry[]
  examinations: readonly BoardroomEntry[]
}) {
  const claims = new Map(overview.claims.map((claim) => [claim.id, claim]))
  const desk = (id: string) => deskIdentity(id, overview.departments)

  /*
   * The desk that synthesised is shown in the synthesis role, not as a third
   * equal voice. Read from the aggregation's own department — the projection
   * carries it — rather than by assuming Research Office.
   */
  const synthesisDesks = new Set(synthesis.map((entry) => entry.byDepartmentId))
  const independent = analyses.filter((e) => !synthesisDesks.has(e.byDepartmentId))

  return (
    <section className="flex flex-col">
      <Label>Oberoende bedömningar · samma fråga</Label>

      <div
        className={cn(
          'grid gap-5',
          independent.length > 1 ? 'md:grid-cols-2' : 'md:grid-cols-1',
        )}
      >
        {independent.map((entry) => (
          <DeskSeat
            key={entry.id}
            entry={entry}
            name={desk(entry.byDepartmentId).name}
            claims={(entry.claimIds ?? [])
              .map((id) => claims.get(id))
              .filter((claim): claim is Claim => Boolean(claim))}
          />
        ))}
      </div>

      {/* ---- the join, and the synthesis that received both ------------- */}
      {synthesis.map((entry) => {
        const revision = overview.revisions.find(
          (candidate) => candidate.revisionId === entry.revisionId,
        )
        return (
          <div key={entry.id} className="flex flex-col items-center">
            <Join spans={independent.length > 1} />
            <article className="brd-seat brd-seat-synthesis w-full px-7 py-6">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
                <span className="type-section text-institution">Sammanvägning</span>
                <span className="type-inst-sub">{desk(entry.byDepartmentId).name}</span>
                <span className="type-machine">{formatDateTime(entry.at)}</span>
              </div>
              {revision && (
                <p className="type-position max-w-3xl text-[19px]">{revision.statement}</p>
              )}
              <RetainedDisagreements overview={overview} claims={claims} />
              <Inspect className="mt-4">{entry.revisionId ?? entry.id}</Inspect>
            </article>
          </div>
        )
      })}

      {/* ---- what a peer then disputed ---------------------------------- */}
      {examinations.length > 0 && (
        <div className="mt-10 flex flex-col">
          <Label>Kollegial granskning av sammanvägningen</Label>
          <div className="flex flex-col gap-4">
            {examinations.map((entry) => (
              <ExaminationRow
                key={entry.id}
                entry={entry}
                examiner={desk(entry.byDepartmentId).name}
                examined={desk(entry.examinedDepartmentId ?? '').name}
                claims={claims}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------- one desk seat */

function DeskSeat({
  entry,
  name,
  claims,
}: {
  entry: BoardroomEntry
  name: string
  claims: readonly Claim[]
}) {
  const persona = personaFor(entry.byDepartmentId)
  const portrait = persona ? personaPortrait(persona) : null

  return (
    <article className="brd-seat flex flex-col gap-5 px-6 py-5">
      <header className="flex items-center gap-3">
        {/*
         * A portrait where the firm has one. Rates has none, and its seat is
         * named by the organisation rather than filled with a placeholder face
         * that would invent an identity nobody assigned.
         */}
        {portrait ? (
          <img src={portrait} alt="" aria-hidden="true" className="ref-portrait h-9 w-9" />
        ) : (
          <span className="ref-portrait grid h-9 w-9 place-items-center type-machine text-content-subtle">
            {name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <div className="type-section truncate text-accent">{name}</div>
          {persona && <div className="type-machine truncate">{persona.roleTitle}</div>}
        </div>
      </header>

      {claims.length === 0 ? (
        <p className="type-inst-sub">Inga påståenden registrerade.</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {claims.map((claim) => (
            <li key={claim.id} className="flex flex-col gap-3">
              {/* The position, first and largest. */}
              <p className="type-position">{claim.statement}</p>
              <Standing claim={claim} />
              <Inspect>{claim.id}</Inspect>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

/**
 * The epistemic standing of a position, after the position itself.
 *
 * Preserved in full — "Otillräcklig — får inte publiceras" is an institutional
 * fact and is not softened. It is a rule, so it reads as a rule: a hairline
 * bar and the firm's own words, beneath the sentence it qualifies rather than
 * above it.
 */
function Standing({ claim }: { claim: Claim }) {
  const level = CONFIDENCE_LEVEL[claim.confidence.level]
  const blocked = claim.confidence.level === 'insufficient'
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 border-l-2 pl-3',
        blocked ? 'border-negative/60' : 'border-line-strong',
      )}
    >
      <span
        className={cn(
          'type-machine tracking-[0.1em]',
          blocked ? 'text-negative' : 'text-content-muted',
        )}
      >
        {level.label.toUpperCase()}
      </span>
      {claim.confidence.cappedBy && (
        <span className="type-machine">
          {CONFIDENCE_CAP_LABEL[claim.confidence.cappedBy]}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------- one examination row */

function ExaminationRow({
  entry,
  examiner,
  examined,
  claims,
}: {
  entry: BoardroomEntry
  examiner: string
  examined: string
  claims: Map<string, Claim>
}) {
  const objections = entry.objections ?? []
  const open = objections.filter((o) => o.outcome === 'open')

  return (
    <article
      className={cn(
        'brd-seat flex flex-col gap-4 px-6 py-5',
        /* Superseded, and still readable. History recedes; it is not deleted. */
        entry.superseded && 'opacity-70',
      )}
    >
      <header className="flex flex-wrap items-baseline gap-x-3">
        <span className="type-section text-accent">{examiner}</span>
        <span className="type-inst-sub">granskade {examined}</span>
        <span className="type-machine">{formatDateTime(entry.at)}</span>
        {entry.superseded && (
          <span className="type-machine text-content-subtle">· ersatt av senare granskning</span>
        )}
      </header>

      <p className="type-inst-lg">{examinationFinding(objections)}</p>

      {objections.map((objection) => (
        <ObjectionBlock
          key={objection.challengeId}
          objection={objection}
          contested={claims.get(objection.contests)}
        />
      ))}

      {/*
       * The institutional consequence, where it happened. Not a computed
       * verdict — an open objection is what the record holds, and the firm's
       * own answer lives in the gate report at the decision boundary.
       */}
      {open.length > 0 ? (
        <Consequence tone="blocked">Ärendet stoppades</Consequence>
      ) : objections.length > 0 ? (
        <Consequence tone="settled">Invändningen bemött</Consequence>
      ) : null}

      <Inspect>{entry.id}</Inspect>
    </article>
  )
}

function ObjectionBlock({
  objection,
  contested,
}: {
  objection: BoardroomObjection
  contested: Claim | undefined
}) {
  return (
    <div className="flex flex-col gap-2 border-l-2 border-negative/45 pl-4">
      {contested && (
        <p className="type-inst-sub">
          Invänder mot: <span className="text-content">{contested.statement}</span>
        </p>
      )}
      <p className="type-position text-[15px]">{objection.argument}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="type-machine tracking-[0.1em] text-warning">
          {MATERIALITY[objection.materiality].label.toUpperCase()}
        </span>
        <span className="type-machine tracking-[0.1em]">
          {OBJECTION_STATUS[objection.outcome].label.toUpperCase()}
        </span>
        <span className="type-machine">
          {objection.counterEvidenceCount > 0
            ? `${objection.counterEvidenceCount} motbelägg`
            : 'invändning mot resonemanget'}
        </span>
        {objection.resolvedBy && (
          <span className="type-machine">bemött av {objection.resolvedBy}</span>
        )}
      </div>
      <Inspect>{objection.challengeId}</Inspect>
    </div>
  )
}

/* -------------------------------------------------- retained disagreements */

function RetainedDisagreements({
  overview,
  claims,
}: {
  overview: CaseOverview
  claims: Map<string, Claim>
}) {
  const retained = overview.aggregations
    .flatMap((aggregation) => aggregation.dispositions)
    .filter((record) => record.disposition === 'retained-unresolved')
  if (retained.length === 0) return null

  return (
    <div className="mt-6 border-t border-line pt-5">
      <span className="type-section text-warning">Oförlöst oenighet · behållen</span>
      <div className="mt-3 flex flex-col gap-3 border-l-2 border-warning/45 pl-4">
        {retained.map((record) => (
          <div key={record.claimId} className="flex flex-col gap-1">
            {/* The dissenting position stays as legible as the synthesis. */}
            <p className="type-position text-[15px]">
              {claims.get(record.claimId)?.statement}
            </p>
            {record.explanation && (
              <p className="type-inst-sub">{record.explanation}</p>
            )}
            <Inspect>{record.claimId}</Inspect>
          </div>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- small parts */

function Consequence({ tone, children }: { tone: 'blocked' | 'settled'; children: string }) {
  return (
    <p
      className={cn(
        'brd-consequence py-2.5 pl-3 type-machine tracking-[0.18em]',
        tone === 'blocked'
          ? 'brd-consequence-blocked text-negative'
          : 'brd-consequence-settled text-positive',
      )}
    >
      {children.toUpperCase()}
    </p>
  )
}

/** The join from the desks into what reconciled them. Not a flowchart. */
function Join({ spans }: { spans: boolean }) {
  return (
    <span aria-hidden="true" className="flex w-full flex-col items-center">
      {spans && <span className="brd-join-rail w-1/2" />}
      <span className="brd-join" />
    </span>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="type-section mb-4 text-content-subtle">{children}</h2>
}
