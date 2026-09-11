import { Link } from '@tanstack/react-router'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { RunStateBadge } from './RunStateBadge'
import {
  budgetText,
  modelText,
  PROVIDER_KIND_LABEL,
  PROVIDER_KIND_TONE,
  REJECTION_CODE_LABEL,
  RUN_FAILURE_LABEL,
  usageText,
  rejectedByText,
} from '~/presentation/analysis/runText'
import { formatDateTime } from '~/lib/format'
import type { AgentRunRecord } from '~/domain/analysis'

/**
 * One run, as the institution recorded it.
 *
 * Every value here is read off the record. Nothing is computed, inferred or
 * filled in: a run that reported no usage says so, a budget dimension nobody
 * decided says so, and a stub says it is a stub.
 *
 * ## What is deliberately absent
 *
 * **No claim count.** `AgentRunRecord.claims` is a projection of the
 * institutional claims table, so a run awaiting acceptance carries an empty
 * list — not because it produced nothing, but because what it produced is not
 * institutional yet. Rendering `0` would state the opposite of what happened.
 * Produced work is read through `runReview`, on the surface this row leads to.
 *
 * ## Two destinations, and which one is the point
 *
 * A run belongs to a case and *is* a piece of work, so both links are true. The
 * first version made the case id the visually obvious target and left the route
 * into the work on an unlabelled entry key — so the natural click from a desk
 * landed on the case overview, and the work awaiting a decision was reachable
 * only by someone who already knew where to aim. **The review is the point of
 * this row**, the case is context, and the layout now says so: an explicit call
 * to action where a decision is owed, and the case demoted to the metadata line
 * where the rest of the context lives.
 */
export function RunRow({ run }: { run: AgentRunRecord }) {
  const model = modelText(run.execution.identity)
  /*
   * Read off the record, not inferred. `awaiting-acceptance` is the one state
   * in which a person owes an act, and the only one that gets a call to action
   * — a button on settled work would invite a click on something the
   * institution would refuse.
   */
  const awaitingDecision = run.state === 'awaiting-acceptance'

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <RunStateBadge state={run.state} />
        <Link
          to="/runs/$runId"
          params={{ runId: run.id }}
          className="text-sm font-medium underline decoration-line underline-offset-4 hover:decoration-current"
        >
          {run.execution.playbookEntryKey}
        </Link>
        {/*
         * Which kind of producer, always. A replayed fixture and a live
         * institutional agent must never be indistinguishable on screen.
         */}
        <StatusBadge tone={PROVIDER_KIND_TONE[run.execution.providerKind]}>
          {PROVIDER_KIND_LABEL[run.execution.providerKind]}
        </StatusBadge>

        {awaitingDecision && (
          <Link
            to="/runs/$runId"
            params={{ runId: run.id }}
            className="hud-label ml-auto inline-flex h-8 items-center rounded-lg bg-surface-2 px-3 text-xs text-content hover:bg-surface-3"
          >
            Granska och besluta
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <time dateTime={run.startedAt} className="type-metadata tabular">
          {formatDateTime(run.startedAt)}
        </time>
        {model && <span className="type-metadata">{model}</span>}
        <span className="type-metadata">{usageText(run.usage)}</span>
        <span className="type-metadata">Tillåtet: {budgetText(run.budget).join(' · ')}</span>
        {/* Context, and labelled as such — never the row's primary target. */}
        <Link
          to="/cases/$caseId"
          params={{ caseId: run.caseId }}
          className="type-metadata hover:text-content"
        >
          Ärende: {run.caseId}
        </Link>
      </div>

      {/*
       * A failure and a rejection are different institutional facts and are
       * never rendered as one another. The record cannot carry both — the
       * domain refuses it — so at most one of these appears.
       */}
      {run.failure && (
        <p className="type-metadata text-negative">
          {RUN_FAILURE_LABEL[run.failure.category]} · försök {run.failure.attempt}
          {run.failure.retryable ? ' · kan köras om' : ' · körs inte om'}
        </p>
      )}

      {run.rejection && (
        <div className="flex flex-col gap-0.5">
          <span className="type-metadata text-warning">
            {REJECTION_CODE_LABEL[run.rejection.code]} ·{' '}
            {rejectedByText(run.rejection)}
          </span>
          {/*
           * The prose the person wrote, shown as written. It is the half of the
           * record a code cannot carry, and the reason a rejection teaches the
           * firm anything at all.
           */}
          <span className="type-metadata">{run.rejection.detail}</span>
        </div>
      )}
    </li>
  )
}
