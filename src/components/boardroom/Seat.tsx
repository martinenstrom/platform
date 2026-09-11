/**
 * A Financial OS nameplate, standing on the committee table.
 *
 * It is meant to read as an object in the photographed room — a low illuminated
 * desk plate lying on the stone, catching the ceiling cove along its top edge,
 * held in a base, and throwing a soft reflection onto the polish beneath it —
 * rather than as a card floating above a background image.
 *
 * ## Presence follows participation
 *
 * The eye must land on the case, not on the org chart. So the three states are
 * not three shades of the same object; they are three different KINDS of thing:
 *
 *   acted               a plate, lit, in its base — the case, in one glance
 *   assigned-not-acted  a plate, in its base, unlit — asked, and silent
 *   not-in-case         lettering cut into the stone, no plate at all
 *
 * A desk the case never involved keeps its position and its name, and stops
 * competing. Truthful absence does not require equal visual weight — but it
 * does require being legible, so the state is still written, just quietly.
 *
 * ## It labels a position, never a person
 *
 * The plate belongs to a POINT ON THE TABLE. Behind it the photograph may show
 * a seated figure, two figures, or an empty chair; none of that is addressed
 * here and none of it changes what the plate says. It never draws a connector
 * to a body, never sits over a face, and never carries a portrait — a face
 * beside a department name is exactly the claim the room must not make.
 *
 * ## What it may say, and what it may not
 *
 * It says: this desk exists, it is analytical or a control function or the
 * chief, and in THIS case it acted / was asked and has not answered / was not
 * involved. Every one of those comes from `BoardroomSeat`, a projection of
 * persisted acts and assignments.
 *
 * It never says what the desk concluded, how confident it was, or whether it
 * agreed. Those live on the acts, which the debate surface renders.
 *
 * ## State is written, not only lit
 *
 * A reader who cannot tell a cyan edge from a bronze one still has to know
 * whether a desk participated, so participation is text on the plate and in the
 * accessible name. Light repeats it; it never carries it alone.
 */

import {
  executiveStandingText,
  SEAT_PARTICIPATION,
} from '~/presentation/analysis/boardroomText'
import type { BoardroomSeat } from '~/application/analysis/boardroomSeating'
import { cn } from '~/lib/cn'

export function Seat({ seat, className }: { seat: BoardroomSeat; className?: string }) {
  /*
   * The chief's seat is the destination of the case, so it is worded from the
   * submission and the decision. Every other seat is worded from participation.
   * The two never mix: `executive` is set on exactly one seat, and a desk can
   * never fall into the executive wording by accident.
   */
  const state = seat.executive
    ? executiveStandingText(seat.executive)
    : SEAT_PARTICIPATION[seat.participation].label

  /*
   * How the firm refers to the office, where it names one. The head of the
   * table is the Chief Investment Officer; calling it "Executive" would put an
   * org-chart box at the end of the room instead of the authority the case is
   * travelling towards. The department name remains the fallback, and nothing
   * is invented when the organisation names nobody.
   */
  const label = seat.kind === 'chief' ? (seat.roleTitle ?? seat.name) : seat.name

  /*
   * Light means an act was recorded. For the chief that is a decision and
   * nothing else — a case merely submitted must never light the head of the
   * table, because submission is a request and not an outcome.
   */
  const acted = seat.participation === 'acted'

  /*
   * A desk outside the case recedes to lettering on the stone. The executive
   * seat is excluded even when it holds no act: it is where the case is going,
   * and the room must not engrave away the destination.
   */
  const engraved = seat.participation === 'not-in-case' && seat.executive === null

  return (
    <span
      aria-label={`${label} — ${state}`}
      role="listitem"
      className={cn(
        engraved
          ? 'brd-engraved flex flex-col items-center'
          : 'brd-plate flex flex-col items-center gap-px px-2.5 py-1',
        !engraved && seat.kind === 'governance' && 'brd-plate-governance',
        !engraved && seat.kind === 'chief' && 'brd-plate-chief',
        !engraved && acted && 'brd-plate-acted',
        !engraved && seat.participation === 'assigned-not-acted' && 'brd-plate-waiting',
        /*
         * Held by the CIO, and answered by the CIO, are each their own
         * treatment. Neither is lit and neither is the recessive wash a desk
         * outside the case gets, so the executive states stay apart at a
         * glance as well as in words.
         */
        seat.executive?.kind === 'awaiting-decision' && 'brd-plate-awaiting',
        seat.executive?.kind === 'returned' && 'brd-plate-returned',
        className,
      )}
    >
      <span className="brd-plate-name">{label}</span>
      {/* The state, in words. Never light alone. */}
      <span className="brd-plate-state">{state}</span>

      {/*
       * The plate reflected in the polish. Decorative and hidden from the
       * accessibility tree: it repeats a label that is already announced, and
       * a screen reader hearing every desk twice would be the price of a
       * lighting effect.
       */}
      {!engraved && (
        <span aria-hidden="true" className="brd-plate-mirror">
          {label}
        </span>
      )}
    </span>
  )
}
