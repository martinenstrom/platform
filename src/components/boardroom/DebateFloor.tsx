/**
 * The Boardroom: a room, not a report.
 *
 * A person entering this page should feel they walked into their investment
 * committee — not that they opened a case-management screen. It answers, in one
 * viewport: what did the Chairman ask, which desks are working on it, what
 * positions do they hold, where do they disagree, what did Research Office
 * synthesise, what is governance blocking or clearing, has the CIO received it,
 * and — if a decision exists — what did the CIO decide.
 *
 * ## What this deliberately no longer contains
 *
 * The long-form record. Measured on 2026-08-30 the page ran to 5.87 viewports,
 * of which the room was 0.94: evidence provenance, complete claims, full review
 * objects, peer-examination and challenge history, gate questions, timestamps
 * and event ids stacked below the photograph for nearly three screens.
 *
 * None of it was deleted or simplified. It moved to `/cases/$caseId/underlag`,
 * the case-scoped defensible record, reached from the Chairman Console and from
 * the foot of this page. The Boardroom simply stopped being its primary
 * surface.
 *
 * ## Everything visible projects a persisted act
 *
 * The debate in the room renders stored claims, reviews and challenges by
 * durable id. There is no synthetic dialogue, no typing indicator, no filler,
 * no invented chronology and no manufactured consensus. Presentation may
 * animate the ARRIVAL of a persisted act; it may never invent one.
 *
 * ## The overlays never navigate
 *
 * Chairman Console, desk transcript and decision panel open over the room. A
 * committee you are thrown out of to read something is not a room you are in.
 *
 * The one thing that does navigate — the door to the record — is a router
 * link, not a document load. The room is prop-driven and renders wherever it
 * is given an overview; what it must not do is tear down whatever is mounted
 * above it on the way out.
 */

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { BoardroomProjection } from '~/application/analysis/boardroomSeating'
import type { CaseOverview } from '~/application/analysis/caseOverview'
import { CaseQuestion, CaseRail } from './CaseMasthead'
import { CommitteeRoom } from './CommitteeRoom'
import { InRoomDebate } from './InRoomDebate'
import { ChairmanConsole } from './ChairmanConsole'
import { DeskTranscript } from './DeskTranscript'
import { CioDecisionPanel } from './CioDecisionPanel'

export function DebateFloor({
  overview,
  boardroom,
  onResumeConvening,
}: {
  overview: CaseOverview
  boardroom: BoardroomProjection
  /** Offered only when the committee was never convened. */
  onResumeConvening?: () => void
}) {
  const { timeline, seats } = boardroom
  const [open, setOpen] = useState<
    | { kind: 'none' }
    | { kind: 'chairman' }
    | { kind: 'desk'; departmentId: string }
    | { kind: 'decision' }
  >({ kind: 'none' })

  const chief = seats.find((seat) => seat.executive !== null)
  const selectedSeat =
    open.kind === 'desk'
      ? seats.find((seat) => seat.departmentId === open.departmentId)
      : undefined

  /*
   * A case whose playbook was never pinned is a question the firm registered
   * and a committee it never convened. Read from the case itself rather than
   * inferred from an empty timeline: a convened committee that has simply not
   * started yet is a different thing, and the two must not look alike.
   */
  const convening = overview.investmentCase.playbookId ? 'convened' : 'incomplete'

  return (
    <div className="brd-room -mx-4 flex flex-col md:-mx-6">
      <CommitteeRoom
        seats={seats}
        masthead={<CaseQuestion overview={overview} />}
        standing={<CaseRail overview={overview} chief={chief} />}
        record={
          <Link
            to="/cases/$caseId/underlag"
            params={{ caseId: overview.investmentCase.id }}
            className="brd-room-record"
          >
            Öppna underlag →
          </Link>
        }
        onOpenChairman={() => setOpen({ kind: 'chairman' })}
        onSelectDesk={(departmentId) => setOpen({ kind: 'desk', departmentId })}
        debate={
          <InRoomDebate
            timeline={timeline}
            overview={overview}
            seats={seats}
            onSelectDesk={(departmentId) => setOpen({ kind: 'desk', departmentId })}
          />
        }
      />

      {open.kind === 'chairman' && (
        <ChairmanConsole
          overview={overview}
          chief={chief}
          convening={convening}
          onClose={() => setOpen({ kind: 'none' })}
          onResume={() => onResumeConvening?.()}
          onOpenDecision={() => setOpen({ kind: 'decision' })}
        />
      )}

      {selectedSeat && (
        <DeskTranscript
          seat={selectedSeat}
          timeline={timeline}
          overview={overview}
          onClose={() => setOpen({ kind: 'none' })}
        />
      )}

      {open.kind === 'decision' && overview.decision && (
        <CioDecisionPanel
          decision={overview.decision}
          overview={overview}
          onClose={() => setOpen({ kind: 'none' })}
        />
      )}
    </div>
  )
}
