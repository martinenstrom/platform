/**
 * Why the room is sitting, placed into the room's own architecture.
 *
 * The masthead is split in two because the photographed room decides where each
 * half belongs. The QUESTION goes high on the left, over the marble and the
 * dark upper glass, where it reads as lettering in the room rather than as a
 * banner laid across it. The RAIL goes low, on the near floor, because the
 * workflow orients and must never compete with the debate.
 *
 * Nothing may sit as an opaque bar across the room. The environment is the
 * first thing a person should feel, and a header wide enough to cover the
 * committee would turn the photograph back into wallpaper behind a dashboard.
 *
 * ## The progression decides nothing
 *
 * Every state comes from `CaseStanding.steps`, already derived. This renders
 * them compactly; it does not recompute which step is complete, and a step the
 * The permanent status is two facts — how far the committee has got, and where
 * the case stands with the CIO. The eight-step checklist it replaced was an
 * audit spread across a committee table; it now lives in the Chairman Console
 * and, in full, in case-scoped Underlag.
 */

import type { CaseOverview } from '~/application/analysis/caseOverview'
import type { BoardroomSeat } from '~/application/analysis/boardroomSeating'
import {
  committeeProgress,
  executiveStandingText,
} from '~/presentation/analysis/boardroomText'

/** A case the firm opened to verify the product, not to advise anybody. */
const DEVELOPMENT_MARKER = 'UTVECKLINGSDATA'

/* ------------------------------------------------------------ the question */

export function CaseQuestion({ overview }: { overview: CaseOverview }) {
  const { investmentCase } = overview
  const isDevelopment = investmentCase.question.includes(DEVELOPMENT_MARKER)

  /*
   * The investment question alone.
   *
   * A development case carries its own warning inside the recorded question —
   * a leading marker and a trailing parenthetical — because the seeding script
   * had nowhere else to put it. Both are stripped HERE, and only for a case
   * that declares itself development data: the disclosure is not weakened, it
   * is moved to where it belongs, above the question rather than inside it.
   *
   * A real case's question is never touched. The condition is the guard.
   */
  const question = isDevelopment
    ? investmentCase.question
        .replace(/^UTVECKLINGSDATA\s*—\s*/u, '')
        .replace(/\s*\([^()]*inte verklig analys[^()]*\)\s*$/iu, '')
        .trim()
    : investmentCase.question

  return (
    <header className="flex flex-col gap-4">
      {isDevelopment && <DevelopmentMark />}
      <div className="flex flex-col gap-2.5">
        <p className="type-section text-content-subtle">
          {investmentCase.subject.displayName}
        </p>
        <h1 className="brd-question max-w-[15ch]">{question}</h1>
      </div>
    </header>
  )
}

/**
 * The disclosure, whole.
 *
 * It stays outside the question and it stays legible. A development case must
 * be impossible to mistake for advice, and equally impossible for the warning
 * to become the loudest thing in the room.
 */
function DevelopmentMark() {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-warning pl-2.5">
      <span className="type-machine tracking-[0.18em] text-warning">
        UTVECKLINGSVERIFIERING
      </span>
      <span className="type-machine text-warning/80">
        Fixturdata för Boardroom · inte verklig analys
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- the rail */

export function CaseRail({
  overview,
  chief,
}: {
  overview: CaseOverview
  /** The executive seat, carrying where the case stands with the CIO office. */
  chief?: BoardroomSeat
}) {
  const progress = committeeProgress(overview.standing)
  return (
    <dl className="brd-standing">
      {/*
       * Two facts, and deliberately only two.
       *
       * The eight-step checklist used to be spread across the room. It is
       * truthful and it is an audit, and a committee table is not where an
       * audit belongs: it made the room read as a workflow screen. The steps
       * are unchanged and unreduced — the Chairman Console carries the count
       * and Underlag carries every gate by name.
       *
       * Counted by committeeProgress, which the Console also calls. One
       * derivation, so the room and the console cannot disagree about the same
       * case.
       */}
      <div className="brd-standing-fact">
        <dt>Kommittén</dt>
        <dd>{progress.label}</dd>
      </div>
      <div className="brd-standing-fact">
        <dt>Hos CIO</dt>
        <dd>
          {chief?.executive ? executiveStandingText(chief.executive) : 'Ej inlämnat'}
        </dd>
      </div>
    </dl>
  )
}
