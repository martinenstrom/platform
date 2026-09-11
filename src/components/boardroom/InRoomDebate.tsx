/**
 * The debate, in the room, spatially attached to the desks that made it.
 *
 * ## Every statement is a persisted act
 *
 * Nothing here is dialogue. Each card projects one institutional object — a
 * claim a desk recorded, or an objection a review filed — and carries that
 * object's durable id. There is no synthetic speech, no typing indicator, no
 * filler, no invented ordering and no manufactured agreement. If the firm
 * stored nothing, the room shows nothing.
 *
 * ## Restrained on purpose
 *
 * At most two acts are in focus at once. The photograph is the room and has to
 * stay legible as one; a wall of cards over it would be a chat log with a
 * picture behind it, which is the thing this design exists not to be.
 *
 * Salience is "latest", read off the timeline the projection already ordered.
 * It is not an importance ranking — the firm does not record one, and inventing
 * one here would be a judgement the institution never made. Everything not in
 * focus is still reachable: clicking a desk opens its own persisted history.
 *
 * ## The arc
 *
 * An objection draws a thin arc between two institutional ANCHORS — table
 * positions, never photographed people. It encodes one persisted fact: this
 * review contests that desk's work. An open objection carries amber tension;
 * a settled one recedes to a dim trace rather than vanishing, because it
 * happened and the record keeps it. The whole objection stays on the desk's
 * transcript and in Underlag either way.
 */

import type { BoardroomEntry, BoardroomTimeline } from '~/application/analysis/boardroomTimeline'
import type { BoardroomSeat } from '~/application/analysis/boardroomSeating'
import type { CaseOverview } from '~/application/analysis/caseOverview'
import { anchorFor } from '~/presentation/analysis/boardroomAnchors'
import { cn } from '~/lib/cn'

/** One thing a desk actually put on the record. */
interface Utterance {
  /** The durable id of the persisted object this renders. */
  id: string
  departmentId: string
  deskName: string
  text: string
  /** Set when this is an objection, naming the desk whose work was read. */
  contestsDepartmentId?: string
  kind: 'position' | 'synthesis' | 'objection'
}

const nameOf = (seats: readonly BoardroomSeat[], departmentId: string) =>
  seats.find((seat) => seat.departmentId === departmentId)?.name ?? departmentId

/** What kind of act this is, in the institution's own vocabulary. */
const KIND_LABEL: Record<Utterance['kind'], string> = {
  position: 'position',
  synthesis: 'sammanvägning',
  objection: 'invändning',
}

/**
 * How much of a statement fits on a plate.
 *
 * Presentation only, and only ever a cut: the words are the persisted ones and
 * are never rewritten, shortened editorially or turned into conversation. The
 * whole text is one click away on the desk's own transcript, which is what the
 * plate opens.
 */
const PLATE_LIMIT = 128
function clamp(text: string): string {
  if (text.length <= PLATE_LIMIT) return text
  const cut = text.slice(0, PLATE_LIMIT)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * What each entry put on the record, as words.
 *
 * A claim's statement is the desk's position. An objection's argument is the
 * objection. Neither is paraphrased, and an entry that produced neither
 * contributes nothing here rather than being narrated.
 */
function utterancesOf(
  entry: BoardroomEntry,
  overview: CaseOverview,
  seats: readonly BoardroomSeat[],
): Utterance[] {
  const deskName = nameOf(seats, entry.byDepartmentId)

  if (entry.objections?.length) {
    return entry.objections.map((objection) => ({
      id: objection.challengeId,
      departmentId: entry.byDepartmentId,
      deskName,
      text: objection.argument,
      contestsDepartmentId: entry.examinedDepartmentId,
      kind: 'objection' as const,
    }))
  }

  const claims = (entry.claimIds ?? [])
    .map((id) => overview.claims.find((claim) => claim.id === id))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))

  return claims.map((claim) => ({
    id: claim.id,
    departmentId: entry.byDepartmentId,
    deskName,
    text: claim.statement,
    kind: entry.kind === 'synthesis-produced' ? ('synthesis' as const) : ('position' as const),
  }))
}

/**
 * The acts in focus.
 *
 * Latest first, at most one per desk, so two desks are on screen rather than
 * one desk twice.
 *
 * **When the latest act is an objection, the position it contests comes with
 * it.** A disagreement is a relationship between two recorded things, and
 * showing only the objection puts a rebuttal on screen with nothing to rebut —
 * the reader sees that somebody disagreed but not what with. Both halves are
 * persisted and the pairing is the challenge's own `examinedDepartmentId`, so
 * nothing is inferred: the record already says who was read by whom.
 *
 * The contested position is placed first, because it happened first.
 */
export function inFocus(
  timeline: BoardroomTimeline,
  overview: CaseOverview,
  seats: readonly BoardroomSeat[],
  limit = 2,
): Utterance[] {
  const latest = [...timeline.entries].reverse()

  const all: Utterance[] = []
  for (const entry of latest) all.push(...utterancesOf(entry, overview, seats))
  if (all.length === 0) return []

  const first = all[0]!
  if (first.kind === 'objection' && first.contestsDepartmentId) {
    const contested = all.find(
      (utterance) =>
        utterance.departmentId === first.contestsDepartmentId &&
        utterance.kind !== 'objection',
    )
    if (contested) return [contested, first]
  }

  const spoken: Utterance[] = []
  const desks = new Set<string>()
  for (const utterance of all) {
    if (desks.has(utterance.departmentId)) continue
    desks.add(utterance.departmentId)
    spoken.push(utterance)
    if (spoken.length === limit) break
  }
  return spoken
}

/**
 * Desk-to-desk objections, open and settled alike.
 *
 * Both are drawn, and they are drawn differently. An open objection carries
 * amber tension because the disagreement still stands; a settled one recedes
 * to a dim trace because it happened and was answered. **Settled is not
 * erased** — the relationship stays visible here, the objection stays on the
 * desk's transcript, and the whole record stays in Underlag.
 *
 * The pairing is the review's own `examinedDepartmentId`. Nothing is inferred
 * from text, and no relationship exists here that the record does not hold.
 */
interface ObjectionArc {
  from: string
  to: string
  open: boolean
  id: string
}

function objectionArcs(timeline: BoardroomTimeline): ObjectionArc[] {
  const arcs: ObjectionArc[] = []
  for (const entry of timeline.entries) {
    if (!entry.examinedDepartmentId) continue
    for (const objection of entry.objections ?? []) {
      arcs.push({
        from: entry.byDepartmentId,
        to: entry.examinedDepartmentId,
        open: objection.outcome === 'open',
        id: objection.challengeId,
      })
    }
  }
  return arcs
}

export function InRoomDebate({
  timeline,
  overview,
  seats,
  onSelectDesk,
}: {
  timeline: BoardroomTimeline
  overview: CaseOverview
  seats: readonly BoardroomSeat[]
  onSelectDesk: (departmentId: string) => void
}) {
  const focus = inFocus(timeline, overview, seats)
  const arcs = objectionArcs(timeline)

  return (
    <>
      {/* -------------------------------------- who contested whose work -- */}
      {/*
       * A thin arc between two institutional anchors. It connects TABLE
       * POSITIONS and never photographed people, and it exists only because a
       * review named the desk whose work it read.
       */}
      {arcs.length > 0 && (
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 z-[9]"
        >
          {arcs.map((arc) => {
            const a = anchorFor(arc.from)
            const b = anchorFor(arc.to)
            if (!a || !b) return null
            /*
             * Bowed away from the table's centre so the arc reads as a
             * relationship over the stone rather than a chord through the
             * middle of the room.
             */
            const midX = (a.x + b.x) / 2
            const midY = Math.min(a.y, b.y) - Math.abs(a.x - b.x) * 0.18 - 2
            return (
              <path
                key={arc.id}
                d={`M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`}
                className={cn(
                  'brd-objection-arc',
                  arc.open ? 'brd-objection-open' : 'brd-objection-settled',
                )}
              />
            )
          })}
        </svg>
      )}

      {/* ------------------------------------------ the acts in focus ----- */}
      {focus.map((utterance, index) => {
        const anchor = anchorFor(utterance.departmentId)
        if (!anchor) return null
        /* A plate on the left half opens rightward and vice versa, so it never
         * leaves the frame the anchor was measured in. */
        const leftHalf = anchor.x < 50
        /*
         * Staggered, and lifted clear of the table.
         *
         * Adjacent desks sit as little as 8% apart while a plate is wider than
         * that, so two anchored to neighbours would overlap. The earlier act
         * sits higher — the order the record already established, not an
         * arrangement invented here. The lift also keeps the plates off the
         * seated figures' faces and out of the centre sightline the CIO seat
         * and the Chairman's chair share.
         */
        const lift = index === 0 ? 36 : 24
        return (
          <button
            key={utterance.id}
            type="button"
            onClick={() => onSelectDesk(utterance.departmentId)}
            aria-label={`${utterance.deskName}, ${KIND_LABEL[utterance.kind]}: ${utterance.text}`}
            className={cn(
              'brd-statement absolute text-left',
              utterance.kind === 'objection' && 'brd-statement-objection',
              utterance.kind === 'synthesis' && 'brd-statement-synthesis',
            )}
            style={{
              left: leftHalf ? `${anchor.x}%` : undefined,
              right: leftHalf ? undefined : `${100 - anchor.x}%`,
              top: `${anchor.y - lift}%`,
              zIndex: 20 - index,
            }}
          >
            <span className="brd-statement-head">
              <span className="brd-statement-desk">{utterance.deskName}</span>
              <span className="brd-statement-kind">
                {utterance.kind === 'objection' && utterance.contestsDepartmentId
                  ? `· invändning mot ${nameOf(seats, utterance.contestsDepartmentId)}`
                  : `· ${KIND_LABEL[utterance.kind]}`}
              </span>
            </span>
            {/*
             * The persisted statement, in the institution's own words. Long
             * ones are cut for the plate ONLY — the desk's transcript carries
             * the whole text, which is what the plate opens.
             */}
            <span className="brd-statement-text">{clamp(utterance.text)}</span>
          </button>
        )
      })}
    </>
  )
}
