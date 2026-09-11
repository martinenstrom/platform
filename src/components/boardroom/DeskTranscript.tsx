/**
 * One desk's persisted contributions to this case.
 *
 * Opened by clicking a seat. It is the answer to "what has this desk actually
 * said here", and it is assembled from the same timeline the room draws — every
 * line resolves to a stored claim, review or challenge by durable id.
 *
 * Deliberately not the full record. The complete defensible material lives at
 * the case-scoped Underlag route; this is the desk's own voice, so a reader can
 * follow one participant without leaving the room.
 */

import type {
  BoardroomEntry,
  BoardroomTimeline,
} from '~/application/analysis/boardroomTimeline'
import type { BoardroomSeat } from '~/application/analysis/boardroomSeating'
import type { CaseOverview } from '~/application/analysis/caseOverview'
import { ENTRY_LABEL, OBJECTION_STATUS } from '~/presentation/analysis/boardroomText'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { Inspect } from './Inspect'
import { formatDateTime } from '~/lib/format'

export function DeskTranscript({
  seat,
  timeline,
  overview,
  onClose,
}: {
  seat: BoardroomSeat
  timeline: BoardroomTimeline
  overview: CaseOverview
  onClose: () => void
}) {
  const mine: BoardroomEntry[] = timeline.entries.filter(
    (entry) => entry.byDepartmentId === seat.departmentId,
  )

  return (
    <aside className="brd-transcript" aria-label={`${seat.name} i det här ärendet`}>
      <header className="brd-console-head">
        <span className="type-section">{seat.name}</span>
        <button type="button" onClick={onClose} className="brd-console-close">
          Stäng
        </button>
      </header>

      {mine.length === 0 ? (
        /*
         * An absence, reported as one. A desk with no acts has not agreed,
         * approved or declined — it has not spoken, and the room says only that.
         */
        <p className="brd-transcript-empty">Inget registrerat i det här ärendet.</p>
      ) : (
        <ol className="brd-transcript-list">
          {mine.map((entry) => {
            const claims = (entry.claimIds ?? [])
              .map((id) => overview.claims.find((claim) => claim.id === id))
              .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))

            return (
              <li key={entry.id} className="brd-transcript-entry">
                <div className="brd-transcript-meta">
                  <span className="type-section">{ENTRY_LABEL[entry.kind]}</span>
                  <span className="type-metadata">{formatDateTime(entry.at)}</span>
                  {entry.superseded && (
                    /* Preserved, never removed: the desk did say this. */
                    <StatusBadge tone="neutral">ersatt av senare</StatusBadge>
                  )}
                </div>

                {claims.map((claim) => (
                  <p key={claim.id} className="brd-transcript-text">
                    {claim.statement}
                  </p>
                ))}

                {(entry.objections ?? []).map((objection) => (
                  <div key={objection.challengeId} className="brd-transcript-objection">
                    <p className="brd-transcript-text">{objection.argument}</p>
                    <StatusBadge tone={OBJECTION_STATUS[objection.outcome].tone}>
                      {OBJECTION_STATUS[objection.outcome].label}
                    </StatusBadge>
                    <Inspect>{objection.challengeId}</Inspect>
                  </div>
                ))}

                {entry.status && <StatusBadge tone="neutral">{entry.status}</StatusBadge>}
                <Inspect>{entry.id}</Inspect>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
