/**
 * Where each institutional position sits on the photographed committee table.
 *
 * These coordinates are measured against ONE asset — `/data/boardroom-plate.webp`
 * — and mean nothing without it. They are presentation geometry and nothing
 * else: no domain type, no read model and no organisation rule refers to them,
 * and changing one moves a nameplate without changing a single fact.
 *
 * ## They identify table positions, never people
 *
 * The plate contains photographed figures. An anchor is a point on the STONE in
 * front of a chair, not a person, and the doctrine behind that is absolute: a
 * figure in the photograph represents nobody. It is not Global Macro, not the
 * CIO, not an employee. It carries no participation, no verdict and no opinion,
 * and it is no more meaningful than the skyline behind it or the marble under
 * it. A plate may land in front of a photographed figure, between two of them,
 * or in front of an empty chair; none of those arrangements says anything.
 *
 * The room is therefore two layers with no mapping between them. The photograph
 * says *this is a working institution*. The plates say *these desks worked on
 * this case*, and only the second is derived from what the firm stored.
 *
 * ## The room architecture is fixed; the case is not
 *
 * A desk occupies the same chair in every case, so a reader learns the room once
 * rather than re-reading it per case. What changes is illumination, and that
 * comes wholly from `BoardroomSeat.participation`. One plate serves a case with
 * three desks and a case with nine.
 *
 * ## The geometry
 *
 * The table in the plate is an ellipse centred at (50%, 61.5%) with semi-axes of
 * 47% and 12.5%, measured off the asset. Each anchor sits just inside the far
 * edge at its own x, and `scale` grows toward the near ends because those chairs
 * are closer to the camera. Percentages, so the anchors hold at any width.
 */

/**
 * The asset these coordinates were measured against.
 *
 * ## Replacing it
 *
 * A higher-resolution plate OF THE SAME COMPOSITION is a file swap and nothing
 * else: overwrite `public/data/boardroom-plate.webp` and every anchor below
 * still lands, because they are percentages of the frame rather than pixels.
 * The room renders it at its intrinsic aspect with no crop, so resolution is
 * free to change and the institution above it does not move.
 *
 * What is NOT free is a change of composition. If the table, the camera height
 * or the horizon moves, these coordinates describe a table that is no longer
 * there and must be re-measured against the new asset — nothing else in the
 * codebase needs touching, because nothing else knows where the chairs are.
 */
export const BOARDROOM_PLATE = '/data/boardroom-plate.webp'

export interface BoardroomAnchor {
  departmentId: string
  /** Percent from the left of the plate, at the centre of the nameplate. */
  x: number
  /** Percent from the top of the plate. */
  y: number
  /** Perspective size. Near chairs are larger; it encodes nothing else. */
  scale: number
}

/**
 * The standing committee, left to right as the room is seen from the chair.
 *
 * Analytical desks hold the left arc, the desk that synthesises them sits
 * beside the head, and the control functions hold the right — the same
 * separation the debate surface draws, made spatial. The order is architecture,
 * not seniority, and no consumer may read precedence from it.
 *
 * The executive seat is the far apex, opposite the reader. It is a position in
 * the room and not a claim: it lights only when a decision is recorded.
 */
export const BOARDROOM_ANCHORS: readonly BoardroomAnchor[] = Object.freeze([
  { departmentId: 'quant-technical', x: 6.5, y: 62.8, scale: 1.08 },
  { departmentId: 'equity-research', x: 15.5, y: 57.7, scale: 0.97 },
  { departmentId: 'global-macro', x: 24.0, y: 55.1, scale: 0.92 },
  { departmentId: 'rates', x: 32.5, y: 53.5, scale: 0.89 },
  { departmentId: 'research-office', x: 40.5, y: 52.6, scale: 0.87 },
  /*
   * The head of the table, and deliberately NOT on the ring with the desks.
   *
   * It sits at the far edge itself — higher on the frame, and smaller because
   * it is further from the reader — with the two nearest desks pushed wide to
   * leave the apex clear. The authority is carried by position and material,
   * never by light: the seat is dark until a decision exists, and a case merely
   * submitted must never make the room look decided.
   */
  { departmentId: 'executive', x: 50.0, y: 49.4, scale: 0.8 },
  { departmentId: 'risk', x: 59.5, y: 52.6, scale: 0.87 },
  { departmentId: 'devils-advocate', x: 68.5, y: 53.7, scale: 0.89 },
  { departmentId: 'verification', x: 79.0, y: 55.9, scale: 0.94 },
  { departmentId: 'portfolio-strategy', x: 89.5, y: 60.0, scale: 1.02 },
])

/** Where the reader sits: the foreground chair, cropped by the frame. */
export const CHAIRMAN_ANCHOR = Object.freeze({ x: 50, y: 88.5 })

const BY_DEPARTMENT: ReadonlyMap<string, BoardroomAnchor> = new Map(
  BOARDROOM_ANCHORS.map((anchor) => [anchor.departmentId, anchor]),
)

/**
 * The chair this desk occupies, or `undefined` if the room has none for it.
 *
 * The firm holds more desks than the table seats, and that is deliberate: a
 * sixteen-chair table would be a diagram. A desk without an anchor is not
 * hidden — the caller must still render it, because a desk that ACTED and then
 * vanished from the surface would be the room lying about the case.
 */
export function anchorFor(departmentId: string): BoardroomAnchor | undefined {
  return BY_DEPARTMENT.get(departmentId)
}
