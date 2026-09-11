/**
 * The room the committee sits in, and the institution laid onto its table.
 *
 * The room is a photograph. The institution is not. Those are two layers with
 * NO mapping between them, and the separation is the reason the surface can be
 * both warm and truthful:
 *
 *   the photograph says   *I am inside a working investment institution*
 *   Financial OS says     *these desks worked on this case*
 *
 * Only the second is derived from anything the firm stored.
 *
 * ## The photographed people represent nobody
 *
 * Not Global Macro, not Rates, not the CIO, not any employee. They carry no
 * participation, no activity, no agreement and no disagreement, and they are no
 * more semantically meaningful than the skyline, the chairs, the glasses or the
 * marble. A nameplate may happen to sit in front of a figure; that is geometry,
 * not identity. Nothing here attaches a label to a body, draws a ring round a
 * face, or lets a figure's presence change a desk's state — an inactive desk
 * stays dark whoever is sitting behind its chair, the executive seat included.
 *
 * ## What varies is light, not architecture
 *
 * One plate serves every case. A case with three desks and a case with nine use
 * the same photograph, because the institutional layer carries the variation:
 * `boardroomSeating` says who acted, who was asked, and who the case never
 * involved, and the anchors say where each desk sits. Positions are fixed, so
 * the room is learned once instead of re-read per case.
 *
 * ## The firm is larger than the table
 *
 * The table seats the standing committee. A desk outside it that actually TOOK
 * PART is listed beneath the room, because a desk that acted and then vanished
 * from the surface would be the room lying about the case.
 *
 * Desks with no part in this case are NOT listed. They keep their seats and
 * their uninvolved nameplates at the table and read as architecture. Truthful
 * absence does not require equal visual representation, and the firm as a whole
 * belongs to Headquarters rather than to one meeting.
 *
 * ## Fallbacks
 *
 * If the plate cannot load, the constructed room renders instead: built
 * architecture, a table in `rotateX` perspective, the same anchored plates. It
 * is never drawn underneath the photograph — one room at a time. Below `md` the
 * perspective collapses to a roster, because a committee table at 375px is a
 * diagram nobody can read and the seats matter more than the geometry.
 */

import { useState } from 'react'
import { Seat } from './Seat'
import {
  anchorFor,
  BOARDROOM_PLATE,
  CHAIRMAN_ANCHOR,
} from '~/presentation/analysis/boardroomAnchors'
import type { BoardroomSeat } from '~/application/analysis/boardroomSeating'

export function CommitteeRoom({
  seats,
  masthead,
  standing,
  debate,
  onOpenChairman,
  onSelectDesk,
  record,
}: {
  seats: readonly BoardroomSeat[]
  /** The investment question, placed into the room's upper architecture. */
  masthead?: React.ReactNode
  /** The workflow rail: secondary, and kept out of the room's centre. */
  standing?: React.ReactNode
  /**
   * The persisted debate, drawn onto the table.
   *
   * Passed in rather than derived here: the room knows where desks sit, not
   * what they said, and a room that read the timeline would be a second place
   * the debate could be assembled.
   */
  debate?: React.ReactNode
  /** Opens the Chairman's own console. Never navigates. */
  onOpenChairman?: () => void
  /** Opens one desk's persisted contributions to this case. */
  onSelectDesk?: (departmentId: string) => void
  /**
   * The way out to the case's full record.
   *
   * On the near floor opposite the standing, inside the room rather than on a
   * strip beneath it: leaving for the audit is something you do FROM the
   * meeting, and a link stranded below the photograph read as page furniture.
   */
  record?: React.ReactNode
}) {
  const [plateFailed, setPlateFailed] = useState(false)

  /* A seat is at the table when the room architecture holds a chair for it. */
  const seated = seats.flatMap((seat) => {
    const anchor = anchorFor(seat.departmentId)
    return anchor ? [{ seat, anchor }] : []
  })
  const offTable = seats.filter((seat) => !anchorFor(seat.departmentId))
  const offTableInCase = offTable.filter((seat) => seat.participation !== 'not-in-case')

  return (
    <section aria-label="Investeringskommitténs bord" className="flex flex-col">
      {/* ------------------------------------------------- the room, ≥ md -- */}
      <div className="brd-hall relative hidden aspect-[16/9] w-full md:block">
        {plateFailed ? (
          <ConstructedRoom />
        ) : (
          <img
            src={BOARDROOM_PLATE}
            alt=""
            aria-hidden="true"
            /*
             * The container carries the plate's own 16:9, so this never crops.
             * Anchors are percentages measured against the asset, and a crop
             * would slide every nameplate off the table it was measured on.
             */
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setPlateFailed(true)}
          />
        )}

        {/*
         * Controlled contrast, under the plates. It darkens the left of the
         * room so the question can be read off the stone, and deepens the
         * corners so the frame closes. It is not a panel: the room stays
         * visible through it everywhere.
         */}
        <span aria-hidden="true" className="brd-hall-scrim" />

        {masthead && (
          <div className="absolute top-[10%] left-[4%] z-20 w-[40%]">{masthead}</div>
        )}

        {/* ---------------------------------- the institution, on the table */}
        <div role="list" className="absolute inset-0 z-10">
          {seated.map(({ seat, anchor }) => (
            <span
              key={seat.departmentId}
              className="absolute"
              style={{
                left: `${anchor.x}%`,
                top: `${anchor.y}%`,
                transform: `translate(-50%,-50%) scale(${anchor.scale})`,
              }}
            >
              {/*
               * A desk that took part can be opened; one the case never
               * involved cannot, because there would be nothing behind it and
               * a clickable empty seat suggests otherwise.
               */}
              {onSelectDesk && seat.participation !== 'not-in-case' ? (
                <button
                  type="button"
                  onClick={() => onSelectDesk(seat.departmentId)}
                  className="brd-seat-button"
                >
                  <Seat seat={seat} />
                </button>
              ) : (
                <Seat seat={seat} />
              )}
            </span>
          ))}
        </div>

        {/* The persisted debate, over the table and under the overlays. */}
        {debate}

        {/*
         * The reader's own position, on the foreground chair. No portrait and
         * no name: inventing a face for the reader would be the same
         * fabrication as inventing one for a desk.
         */}
        {/*
         * The Chairman's position is the primary interaction point of the
         * room: it is where the question is asked from and where the answer
         * comes back. It opens a console over the room rather than navigating,
         * because leaving the room to act in it would defeat the premise.
         */}
        {onOpenChairman ? (
          <button
            type="button"
            onClick={onOpenChairman}
            aria-label="Öppna ordförandens konsol"
            className="brd-chairman-mark brd-chairman-button absolute z-20"
            style={{ left: `${CHAIRMAN_ANCHOR.x}%`, top: `${CHAIRMAN_ANCHOR.y}%` }}
          >
            DU · ORDFÖRANDE
          </button>
        ) : (
          <span
            className="brd-chairman-mark absolute z-10"
            style={{ left: `${CHAIRMAN_ANCHOR.x}%`, top: `${CHAIRMAN_ANCHOR.y}%` }}
          >
            DU · ORDFÖRANDE
          </span>
        )}

        {standing && (
          <div className="absolute bottom-[6%] left-[4%] z-20 w-[34%]">{standing}</div>
        )}

        {record && <div className="absolute right-[4%] bottom-[6%] z-20">{record}</div>}

        {/* The room becoming the record. A gradient, never a rule. */}
        <span
          aria-hidden="true"
          className="brd-room-seam absolute inset-x-0 bottom-0 z-[15] h-[14%]"
        />
      </div>

      {/* --------------------------- desks in the case but not at the table */}
      {offTableInCase.length > 0 && (
        <div className="hidden px-10 pt-12 md:block">
          <p className="type-machine mb-2 text-content-subtle/80">
            Ytterligare desk i ärendet · utanför kommitténs bord
          </p>
          <div role="list" className="flex flex-wrap gap-3">
            {offTableInCase.map((seat) => (
              <Seat key={seat.departmentId} seat={seat} />
            ))}
          </div>
        </div>
      )}

      {/*
       * The rest of the firm is NOT listed here.
       *
       * It used to be: every desk with no part in this case, named beneath
       * the room. It was truthful and it was the wrong surface — this is the
       * meeting for one question, and a roster of everybody not in it made
       * the eye work through the firm before reaching the two desks that
       * actually disagree. Truthful absence does not require equal visual
       * representation.
       *
       * Nothing is concealed. Those desks keep their seats and their
       * uninvolved nameplates at the table, recessive and architectural, and
       * Headquarters is where the firm as a whole is read.
       */}
      {/* ---------------------------------------- the roster, below md ----- */}
      <div role="list" className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:hidden">
        {seats.map((seat) => (
          <Seat key={seat.departmentId} seat={seat} className="w-full" />
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------ the fallback room -- */

/**
 * The room as it was built before the plate existed, kept whole.
 *
 * Ceiling cove, window wall, columns, and a table laid down in real perspective
 * with thickness and a rim. None of it carries meaning, and it renders only
 * when the photograph cannot — never behind it, because a second table under
 * the real one would be exactly the artificial room the plate replaced.
 */
function ConstructedRoom() {
  return (
    <span aria-hidden="true" className="brd-built absolute inset-0">
      <span className="brd-window-wall" />
      <span className="brd-mullions" />
      <span className="brd-ceiling" />
      <span className="brd-columns" />
      <span className="brd-table-edge absolute inset-x-[19%] top-[60%] h-[22%]" />
      <span className="brd-table-plane absolute inset-x-[18%] top-[38%] h-[46%]" />
      <span className="brd-chairman-3d absolute bottom-[1%] left-1/2 h-16 w-[20rem] -translate-x-1/2" />
    </span>
  )
}
