/**
 * The Chairman's own panel, opened from the chair at the foot of the table.
 *
 * Everything here is read off persisted state. The console reports where the
 * case is; it does not decide anything, and it never offers an action the
 * institution cannot actually perform.
 *
 * ## What it deliberately does not have
 *
 * No follow-up action. "Ask a follow-up" is not one thing: a NEW QUESTION opens
 * another investment case, and REQUESTING RECONSIDERATION reopens a decision
 * under explicit reconsideration semantics. They are different institutional
 * acts and the firm has not been asked to conflate them, so rather than show a
 * disabled fiction there is nothing here at all.
 *
 * ## BESLUT KLART is never decoration
 *
 * It appears only when `overview.decision` is a persisted decision. With no
 * decision the CIO seat stays dark and this offers nothing — which, as of
 * 2026-09-01, is what every case in the firm looks like: `case_decisions` holds
 * zero rows. That emptiness is correct and is not filled with a fixture.
 */

import { Link } from '@tanstack/react-router'
import type { CaseOverview } from '~/application/analysis/caseOverview'
import type { BoardroomSeat } from '~/application/analysis/boardroomSeating'
import {
  committeeProgress,
  executiveStandingText,
} from '~/presentation/analysis/boardroomText'
import { StatusBadge } from '~/components/ui/StatusBadge'

export function ChairmanConsole({
  overview,
  chief,
  convening,
  onClose,
  onResume,
  onOpenDecision,
}: {
  overview: CaseOverview
  /** The executive seat, carrying the standing the CIO office is in. */
  chief: BoardroomSeat | undefined
  /**
   * Set when the committee was never convened: the question is registered and
   * the case exists, but no desk has been asked for anything.
   */
  convening: 'convened' | 'incomplete'
  onClose: () => void
  onResume: () => void
  onOpenDecision: () => void
}) {
  const { standing, investmentCase } = overview
  const caseId = investmentCase.id
  const decided = overview.decision !== null

  /*
   * The same count the room's status line shows, from the same function. Two
   * surfaces deriving it separately is how they come to disagree about one case.
   */
  const progress = committeeProgress(standing)

  return (
    <aside className="brd-console" aria-label="Ordförandens konsol">
      <header className="brd-console-head">
        <span className="type-section">Ordföranden</span>
        <button type="button" onClick={onClose} className="brd-console-close">
          Stäng
        </button>
      </header>

      <p className="brd-console-question">{investmentCase.question}</p>
      <p className="type-metadata">{investmentCase.subject.displayName}</p>

      {convening === 'incomplete' ? (
        <>
          {/*
           * The honest reading of a case whose first commit landed and whose
           * second did not: the question is registered, the committee is not
           * convened, and no institutional work has begun.
           */}
          <p className="brd-console-warning">Kommittén kunde inte sammankallas.</p>
          <button type="button" onClick={onResume} className="brd-console-action">
            Återuppta sammankallning
          </button>
        </>
      ) : (
        <dl className="brd-console-progress">
          <dt>Kommittén</dt>
          <dd>{progress.label}</dd>
          <dt>Hos CIO</dt>
          <dd>
            {chief?.executive ? executiveStandingText(chief.executive) : 'Ej inlämnat'}
          </dd>
        </dl>
      )}

      {decided && (
        <div className="brd-console-decided">
          <StatusBadge tone="positive">BESLUT KLART</StatusBadge>
          <button
            type="button"
            onClick={onOpenDecision}
            className="brd-console-link brd-console-decision"
          >
            Visa beslut →
          </button>
        </div>
      )}

      <Link to="/cases/$caseId/underlag" params={{ caseId }} className="brd-console-link">
        Öppna underlag →
      </Link>
    </aside>
  )
}
