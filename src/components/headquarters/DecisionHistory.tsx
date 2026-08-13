/**
 * Everything the CIO's office did on this case, as one sequence.
 *
 * A case that was deferred, reopened and then decided has three acts on the
 * decision boundary, and a page showing only the live decision would present
 * the last of them as though it were the whole story — the wait, the condition
 * that ended it, and the fact that the firm had once chosen not to commit would
 * all disappear.
 *
 * ## What is kept and what is produced again
 *
 * A reopened case keeps its history and its revision-specific recorded
 * findings, but **no eligibility or CIO conclusion is inherited**. So a superseded
 * deferral is rendered as a real act with its own reasons — not struck through,
 * not greyed into a footnote — while carrying no implication that it approved
 * anything that followed.
 *
 * ## Ordering here is display, not judgement
 *
 * The acts are interleaved by the time they happened. Nothing about which one
 * is live, which superseded which, or what any of them concluded is worked out
 * on this side: that is read from the records as the institution wrote them.
 *
 * ## A note on where this is heading
 *
 * Each act names the office that performed it. That is written as an
 * identifiable participant rather than folded into a sentence, because the
 * institution is meant to become something a reader can move through — opening
 * a department, following work between them. Nothing here builds that; it just
 * avoids making it harder by turning participants into prose.
 */

import { CornerUpLeft, Gavel, PauseCircle } from 'lucide-react'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { cn } from '~/lib/cn'
import { toneText } from '~/lib/tone'
import { formatDateTime } from '~/lib/format'
import type { CaseDecision, CaseReconsideration } from '~/domain/analysis'
import type { Tone } from '~/types'

/**
 * One act on the decision boundary.
 *
 * A union rather than a decision with an optional reopening attached: a
 * reopening is an act of its own, performed at its own moment for its own
 * stated cause, and hanging it off a decision would make it look like a
 * property of one.
 */
type DecisionAct =
  | { kind: 'decision'; at: string; decision: CaseDecision; superseded: boolean }
  | { kind: 'reopening'; at: string; reconsideration: CaseReconsideration }

const OUTCOME_TONE: Record<string, Tone> = {
  selected: 'positive',
  declined: 'neutral',
  /* The CIO looked and chose to wait — an answer, not a commitment. */
  deferred: 'warning',
}

const OUTCOME_LABEL: Record<string, string> = {
  selected: 'Position tagen',
  declined: 'Avböjt',
  deferred: 'Bordlagt',
}

export function DecisionHistory({
  history,
  reconsiderations,
  liveDecisionId,
}: {
  history: readonly CaseDecision[]
  reconsiderations: readonly CaseReconsideration[]
  liveDecisionId: string | null
}) {
  if (history.length === 0) {
    return (
      <DashboardCard title="Beslut">
        <p className="text-sm text-content-muted">Inget beslut är fattat ännu.</p>
      </DashboardCard>
    )
  }

  const acts: DecisionAct[] = [
    ...history.map((decision): DecisionAct => ({
      kind: 'decision',
      at: decision.decidedAt,
      decision,
      /*
       * Superseded, not deleted. Read from the record rather than inferred
       * from position: the last decision is not automatically the live one,
       * and guessing would be this page forming its own view.
       */
      superseded: decision.decisionId !== liveDecisionId,
    })),
    ...reconsiderations.map((reconsideration): DecisionAct => ({
      kind: 'reopening',
      at: reconsideration.reopenedAt,
      reconsideration,
    })),
  ].sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))

  return (
    <DashboardCard
      title={acts.length > 1 ? `Beslutshistorik (${acts.length} steg)` : 'Beslut'}
    >
      <ol className="flex flex-col gap-5">
        {acts.map((act) =>
          act.kind === 'decision' ? (
            <DecisionAct key={act.decision.decisionId} act={act} />
          ) : (
            <ReopeningAct key={act.reconsideration.id} act={act} />
          ),
        )}
      </ol>
    </DashboardCard>
  )
}

function DecisionAct({ act }: { act: Extract<DecisionAct, { kind: 'decision' }> }) {
  const { decision, superseded } = act
  const kind = decision.outcome.kind

  return (
    <li className="flex gap-3">
      <Mark
        icon={kind === 'deferred' ? PauseCircle : Gavel}
        tone={OUTCOME_TONE[kind] ?? 'neutral'}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge tone={OUTCOME_TONE[kind] ?? 'neutral'}>
            {OUTCOME_LABEL[kind] ?? kind}
          </StatusBadge>
          {superseded && (
            /*
             * Said in words, not by striking the text out. The firm did decide
             * this, and it stayed decided until something replaced it —
             * crossing it out would read as a mistake being corrected.
             */
            <span className="type-metadata">Ersatt av ett senare beslut</span>
          )}
          <span className="type-metadata">{formatDateTime(decision.decidedAt)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="type-metadata">
            Beslutad av{' '}
            <span className="font-medium">{decision.decidedByEmployeeId}</span>
          </span>
          <span className="type-metadata">Mandat: {decision.authorizationBasis}</span>
        </div>

        <p className="text-sm">{decision.rationale}</p>

        {/*
         * The conditions that would bring it back. On a deferral these are the
         * whole point: a wait with no stated end is an indefinite silence, and
         * the firm refuses to record one.
         */}
        {decision.reconsiderationTriggers.length > 0 && (
          <div className="rounded-lg bg-surface-2 p-3">
            <span className="type-label">Villkor för omprövning</span>
            <ul className="mt-2 flex flex-col gap-1">
              {decision.reconsiderationTriggers.map((trigger) => (
                <li key={trigger.id} className="text-sm">
                  {trigger.qualitativeCondition ?? trigger.rationale}
                  {trigger.expectedSource && (
                    <span className="type-metadata"> · {trigger.expectedSource}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
         * Dissent is part of the record, not a comment on it. The firm decided
         * KNOWING somebody disagreed, and omitting it would describe an
         * agreement that never happened.
         */}
        {decision.unresolvedDissent.length > 0 && (
          <div className="rounded-lg bg-warning-soft p-3">
            <span className="type-label">Kvarstående avvikande mening</span>
            <ul className="mt-2 flex flex-col gap-2">
              {decision.unresolvedDissent.map((dissent, index) => (
                <li key={index} className="text-sm">
                  {dissent.raisedByDepartmentId && (
                    <span className="font-medium">{dissent.raisedByDepartmentId}: </span>
                  )}
                  {dissent.rationale}
                  <code className="ml-2 font-mono text-xs">{dissent.materiality}</code>
                  {dissent.acknowledgement && (
                    <span className="mt-1 block text-content-muted">
                      Bemötande: {dissent.acknowledgement}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  )
}

function ReopeningAct({ act }: { act: Extract<DecisionAct, { kind: 'reopening' }> }) {
  const { reconsideration } = act
  return (
    <li className="flex gap-3">
      <Mark icon={CornerUpLeft} tone="accent" />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge tone="accent">Återupptaget</StatusBadge>
          <span className="type-metadata">
            {formatDateTime(reconsideration.reopenedAt)}
          </span>
        </div>

        <span className="type-metadata">
          Återupptaget av{' '}
          <span className="font-medium">{reconsideration.reopenedByEmployeeId}</span> ·
          Mandat: {reconsideration.authorizationBasis}
        </span>

        {/*
         * Why it came back. Without this the reopening reads as the CIO
         * changing their mind, which is a legitimate act but a different one —
         * and would make the stored conditions decorative.
         */}
        <div className="rounded-lg bg-accent-soft p-3">
          <span className="type-label">Villkor som uppfylldes</span>
          <ul className="mt-2 flex flex-col gap-1">
            {reconsideration.firedTriggers.map((fired) => (
              <li key={fired.triggerId} className="text-sm">
                {fired.observation}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  )
}

function Mark({ icon: Icon, tone }: { icon: typeof Gavel; tone: Tone }) {
  return (
    <span className="mt-0.5 shrink-0">
      <Icon className={cn('h-4 w-4', toneText[tone])} aria-hidden="true" />
    </span>
  )
}
