/**
 * The investment floor: an organisation of AI professionals, in one room.
 *
 * ## The composition, top to bottom
 *
 *   the room          a dealing-room photograph, uninterrupted and dominant
 *   the seam          a gradient, not a rule
 *   the organisation  specialist desks, then independent control functions
 *   the connectors    stubs into a bus, and one stem to the tier below
 *   the CIO seat      the endpoint, and honest about what it holds
 *
 * **Environment above, organisation below, and nothing drawn over the
 * photograph but its own label.** The modules used to float on the room, and
 * the effect was that six of them ate the floor: the people at the terminals,
 * the desks and the wall screens were all behind glass before a reader saw any
 * of them. The room is the hero of its region and gets it outright; the firm
 * stands beneath it on its own ground.
 *
 * **The room is sized to be an environment, not a banner.** Roughly 350px of
 * clean photograph before the organisation begins, and the page is allowed to
 * scroll to afford it: fitting every module above the fold is worth less than
 * the headquarters reading as a place.
 *
 * ## Two kinds of people, never confused
 *
 * **Named personas** represent Financial OS agents. They are visual fiction —
 * the face is a representation of an agent, not a claim that a human did the
 * work — and their identity is stable, so Global Macro always looks like Global
 * Macro. Everything shown *around* a persona is institutional state read from
 * the projections.
 *
 * **The people in the photograph are nobody.** They are not agents, not
 * employees, not evidence and not state. Nothing is labelled, nothing is
 * counted, and no institutional fact is ever attached to them. The same goes
 * for the wall screens in the room: they are pixels in a photograph, and no
 * figure on them is read, quoted or implied to be the firm's data.
 *
 * ## The person leads
 *
 * A desk module reads person, then desk, then role, then state. That order is
 * the point of the surface: a firm of colleagues at desks, not a table of
 * departments with an avatar attached.
 *
 * ## The connectors are architecture, not traffic
 *
 * Every desk feeds one junction, the junction reaches each independent control
 * function, and those converge on a node above the CIO seat — which is the
 * firm's workflow: analysis, reviewed independently, arriving at one decision.
 *
 * **They encode no quantity and report no event, and neither do the pulses
 * travelling along them.** The network breathes because the firm has this
 * shape, not because work is moving through it right now. That is why the
 * modules never animate and never carry a status light: a lit path is
 * architecture, a lit card would be a claim.
 *
 * Cyan carries analysis, bronze carries authority. They run in the gutters
 * between the tiers rather than behind the modules, so the shape of the firm
 * can be read end to end instead of guessed at from the fragments that happened
 * to fall between two cards.
 *
 * ## Governance stays independent
 *
 * Control functions get the same portrait size, the same seniority and their
 * own bronze-edged tier beneath their own rule. Rendering them smaller, or
 * among the desks they review, would draw a reporting line the firm does not
 * have.
 */

import { Link } from '@tanstack/react-router'
import type { FloorDesk } from '~/application/analysis/commandCenter'
import {
  CIO_PERSONA,
  personaFor,
  type AgentPersona,
} from '~/presentation/analysis/agentPersona'
import { PersonaPlate } from './PersonaPlate'
import { cn } from '~/lib/cn'

/**
 * The environmental photograph: a dealing room.
 *
 * Decorative, institutional in no way. It replaced a financial-district
 * skyline, which gave the panel darkness but no depth — a room with people in
 * it is what the composition needed and what a skyline could not supply.
 */
const ENVIRONMENT_PHOTO = '/data/dealing-room.jpg'

export interface AgentNetworkProps {
  floor: readonly FloorDesk[]
  /** Cases whose next act the chief owns. Waiting, never decided. */
  chiefObligations: number
  /** How many CIO decisions the firm has ever recorded. */
  decisionsRecorded: number
}

export function AgentNetwork({
  floor,
  chiefObligations,
  decisionsRecorded,
}: AgentNetworkProps) {
  const desks = floor.filter((desk) => !desk.isGovernance)
  const governance = floor.filter((desk) => desk.isGovernance)

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-line">
      {/*
       * The room, uninterrupted.
       *
       * **Nothing is drawn over the photograph but its own label.** The
       * organisation used to sit on top of it, and the effect was that six
       * modules ate the floor: the people at the terminals, the desks and the
       * wall screens were all behind glass before a reader saw any of them. The
       * environment is the hero of this region and gets it outright.
       */}
      <div
        className="ref-environment ref-environment-hero relative h-[25rem] shrink-0"
        style={
          { '--environment-photo': `url(${ENVIRONMENT_PHOTO})` } as React.CSSProperties
        }
      >
        {/*
         * The room's own name, and almost nothing else.
         *
         * It read `GOLVET` in bronze, which is how an internal build labels a
         * region rather than how an institution names its floor. Set quietly
         * now — no accent colour, wide tracking, the counts trailing as machine
         * metadata — so the photograph carries the environment and the label
         * merely says what you are looking at.
         *
         * Set at the foot of the room rather than over its head: the top of
         * the photograph is where its own wall screens carry text, and a label
         * there collided with them.
         */}
        <div className="absolute bottom-3 left-4 z-20 flex items-baseline gap-3">
          <h2 className="ref-floor-label">Investment Floor</h2>
          <span className="type-machine">
            {desks.length} deskar · {governance.length} kontrollfunktioner
          </span>
        </div>

        {/*
         * The seam. A gradient rather than a rule: the organisation stands on
         * the floor it belongs to, and a hard line would make the room a
         * picture hung above a widget.
         */}
        <div
          aria-hidden="true"
          className="ref-environment-seam pointer-events-none absolute inset-x-0 bottom-0 h-12"
        />
      </div>

      {/*
       * The organisation, below the room and on its own ground: specialist
       * desks, then the independent control functions, converging on the seat.
       */}
      <div className="ref-organisation-ground relative flex shrink-0 flex-col px-3 pb-3 pt-2.5">
        <Tier label="Specialistdeskar" count={desks.length}>
          <PersonaRow desks={desks} />
        </Tier>

        <NetworkGap count={desks.length} tone="analysis" mode="redistribute" />

        {governance.length > 0 && (
          <>
            <Tier
              label="Oberoende kontrollfunktioner"
              count={governance.length}
              governance
              note="Oberoende av deskarna de granskar"
            >
              <PersonaRow desks={governance} governance />
            </Tier>
            <NetworkGap count={governance.length} tone="authority" mode="terminate" />
          </>
        )}

        <ChiefSeat
          chiefObligations={chiefObligations}
          decisionsRecorded={decisionsRecorded}
        />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ connectors */

/**
 * The stream bundles, per source.
 *
 * **Deliberately not mirrored.** A bundle spread symmetrically about its spine
 * makes every desk draw the same lens shape and the network reads as a graphic
 * rather than as routing. These lanes are irregular and differ per source, so
 * the fabric has the slight asymmetry real routing has.
 */
const CYAN_LANES = [
  [0, -7, 12],
  [0, 10, -14],
  [0, -12, 6],
] as const

/** Control runs narrower: a spine and one companion, no fan. */
const BRONZE_LANES = [
  [0, 9],
  [0, -11],
  [0, 7],
] as const

/**
 * Packet cadence, and the node cadence derived from it.
 *
 * One spine per source carries a packet. With `n` spines arriving at a node and
 * their phases spread evenly across one period, an arrival lands every
 * `period / n` seconds — so that is exactly what the node's bloom is given as
 * its own duration. The node is not on a decorative timer: it answers the
 * traffic, which is what makes a convergence read as convergence.
 *
 * Bronze is slower and heavier than cyan by design. Analysis streams; control
 * does not.
 */
const CYAN_PACKET_PERIOD = 6.9
const BRONZE_PACKET_PERIOD = 9.4

/** Small per-lane detune, so no two streams stay in step. */
const LANE_DETUNE = [1, 1.27, 0.84] as const

interface Stream {
  d: string
  spine: boolean
  period: number
  phase: number
}

/**
 * The gap between two tiers, drawn as an information fabric.
 *
 * ## The geometry
 *
 * `redistribute` fans every module in the tier above into one junction and back
 * out to every module below: the desks' analysis reaching each independent
 * control function. `terminate` fans a tier into the synthesis node above the
 * CIO and stems into the seat.
 *
 * Positions come from the row layout rather than from measuring the DOM: the
 * rows are evenly divided grids, so a module's centre is a fraction of the
 * width. Every path is normalised with `pathLength`, so a packet is the same
 * size and speed on a short path and a long one.
 *
 * ## Restraint is the design
 *
 * The paths are calm and the motion carries the life. A permanent field of
 * particles reads as decoration; a small number of distinct packets, moving
 * slowly against a quiet ground, reads as a system. So dust is one faint mote
 * per spine rather than a stream of them, packets are slow and few, and the
 * only bright things on the screen are the heads and the two nodes.
 *
 * ## None of it claims anything
 *
 * **This is ambient architecture, not telemetry.** The fabric moves because the
 * firm has this shape, not because work is running: no packet is emitted by an
 * event, none is counted, none is timed to one, and none may be read as an
 * agent doing something. That is precisely why the modules never animate and
 * never carry a status light — a lit path is a diagram, a lit card would be a
 * claim.
 *
 * Motion stops entirely under `prefers-reduced-motion`; the paths stay lit.
 */
function NetworkGap({
  count,
  tone,
  mode,
}: {
  count: number
  tone: 'analysis' | 'authority'
  mode: 'redistribute' | 'terminate'
}) {
  if (count === 0) return null

  const analysis = tone === 'analysis'
  const centres = Array.from(
    { length: count },
    (_, index) => ((index + 0.5) / count) * 100,
  )
  const stroke = analysis ? 'var(--color-accent)' : 'var(--color-institution)'
  const junction = mode === 'redistribute' ? 52 : 74
  const lanes = analysis ? CYAN_LANES : BRONZE_LANES
  const period = analysis ? CYAN_PACKET_PERIOD : BRONZE_PACKET_PERIOD
  /* One arrival per spine per period — see the constants above. */
  const nodeCadence = period / count

  const inbound = (x: number, spread: number): string =>
    `M ${x} 0 C ${x + spread * 0.4} ${junction * 0.42}, ${50 + spread} ${junction * 0.74}, 50 ${junction}`
  const outbound = (x: number, spread: number): string => {
    const run = 100 - junction
    return `M 50 ${junction} C ${50 + spread} ${junction + run * 0.3}, ${x + spread * 0.4} ${junction + run * 0.72}, ${x} 100`
  }

  const streams: Stream[] = []
  const emit = (draw: (x: number, spread: number) => string) => {
    centres.forEach((x, source) => {
      const lane = lanes[source % lanes.length]!
      lane.forEach((spread, index) => {
        streams.push({
          d: draw(x, spread),
          spine: index === 0,
          period: period * (LANE_DETUNE[index % LANE_DETUNE.length] ?? 1),
          /* Spines phase-spread across one period; companions offset off them. */
          phase: -((source * period) / count) - index * 1.6,
        })
      })
    })
  }

  emit(inbound)
  if (mode === 'redistribute') {
    emit(outbound)
  } else {
    streams.push({ d: `M 50 ${junction} L 50 100`, spine: false, period, phase: 0 })
  }

  return (
    <div className="relative w-full shrink-0">
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        /*
         * The analytical gap is the taller of the two. The packets converge,
         * bloom and disperse there, and at the previous height that whole
         * moment happened inside sixty-four pixels — legible, but hurried.
         * Authority keeps its own proportion: fewer streams, a shorter run,
         * more weight.
         */
        className={cn(
          'w-full shrink-0',
          mode === 'redistribute' ? 'h-[5.25rem]' : 'h-16',
        )}
        style={{ '--signal': stroke } as React.CSSProperties}
      >
        {streams.map((stream, index) => {
          const shared = {
            d: stream.d,
            pathLength: 100,
            fill: 'none' as const,
            stroke,
            vectorEffect: 'non-scaling-stroke' as const,
          }
          return (
            <g key={index}>
              {/* The path itself. Calm, continuous, never bright. */}
              <path
                {...shared}
                className={cn(
                  'ref-net-base',
                  stream.spine && 'ref-net-breathe',
                  !analysis && 'ref-net-heavy',
                )}
                strokeWidth={stream.spine ? (analysis ? 1 : 1.3) : analysis ? 0.7 : 0.9}
                strokeOpacity={stream.spine ? (analysis ? 0.26 : 0.34) : 0.13}
              />

              {stream.spine && (
                <>
                  {/* Slow ambient energy: a long soft swell drifting the path. */}
                  <path
                    {...shared}
                    className="ref-net-wave"
                    strokeWidth={analysis ? 1.4 : 1.8}
                    style={{
                      animationDuration: `${stream.period * 2.6}s`,
                      animationDelay: `${stream.phase * 1.9}s`,
                    }}
                  />

                  {/*
                   * One faint mote per spine. Analysis only — control does not
                   * stream, and giving both the same texture would say the two
                   * kinds of work are the same kind of work.
                   */}
                  {analysis && (
                    <path
                      {...shared}
                      className="ref-net-drift"
                      strokeWidth={1}
                      style={{
                        animationDuration: `${stream.period * 1.5}s`,
                        animationDelay: `${stream.phase * 0.8}s`,
                      }}
                    />
                  )}

                  {/*
                   * The streak, and the head that rides at its front. The head
                   * lags its own trail by a fraction of a period, which is what
                   * makes one read as the wake of the other rather than as two
                   * dashes travelling together.
                   */}
                  <path
                    {...shared}
                    className={cn('ref-net-trail', !analysis && 'ref-net-trail-heavy')}
                    strokeWidth={analysis ? 2.4 : 3.2}
                    style={{
                      animationDuration: `${stream.period}s`,
                      animationDelay: `${stream.phase - 0.3}s`,
                    }}
                  />
                  <path
                    {...shared}
                    className={cn('ref-net-packet', !analysis && 'ref-net-packet-heavy')}
                    strokeWidth={analysis ? 1.5 : 2}
                    style={{
                      animationDuration: `${stream.period}s`,
                      animationDelay: `${stream.phase}s`,
                    }}
                  />
                </>
              )}
            </g>
          )
        })}
      </svg>

      {mode === 'redistribute' ? (
        /*
         * Where the desks' streams cross before being routed on. Two faint
         * concentric rings and a core, blooming on the cadence at which packets
         * actually reach it.
         */
        <span
          aria-hidden="true"
          className="ref-node ref-node-analysis absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={
            { top: `${junction}%`, '--cadence': `${nodeCadence}s` } as React.CSSProperties
          }
        >
          <span className="ref-node-ring" />
          <span className="ref-node-ring ref-node-ring-outer" />
          <span className="ref-node-arrival" />
          <span className="ref-node-core" />
        </span>
      ) : (
        /*
         * The synthesis node: where every independent line the firm draws
         * arrives, immediately above the seat that would act on them. The
         * heaviest, warmest point in the composition and the end of every
         * path — and it reports nothing. The sentence in the seat below is
         * what states where the firm actually stands.
         */
        <span
          aria-hidden="true"
          className="ref-node ref-node-synthesis absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={
            { top: `${junction}%`, '--cadence': `${nodeCadence}s` } as React.CSSProperties
          }
        >
          <span className="ref-node-ring" />
          <span className="ref-node-ring ref-node-ring-outer" />
          <span className="ref-node-ring ref-node-ring-far" />
          <span className="ref-node-arrival" />
          <span className="ref-node-core" />
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ tiers */

function Tier({
  label,
  count,
  note,
  governance = false,
  children,
}: {
  label: string
  count: number
  note?: string
  governance?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={cn('type-section shrink-0', governance && 'text-institution')}>
          {label}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'h-px flex-1',
            governance ? 'ref-rule-institution' : 'bg-white/[0.07]',
          )}
        />
        {note && <span className="type-machine hidden shrink-0 2xl:inline">{note}</span>}
        <span className="type-machine shrink-0">{count}</span>
      </div>
      {children}
    </section>
  )
}

function PersonaRow({
  desks,
  governance = false,
}: {
  desks: readonly FloorDesk[]
  governance?: boolean
}) {
  if (desks.length === 0) return null
  return (
    <ul
      className="grid w-full gap-2"
      style={{
        /*
         * One row, always. The column count follows the firm rather than a
         * breakpoint, so the floor reads as a rank of colleagues at one bench
         * instead of reflowing into a card grid at the first narrow viewport.
         */
        gridTemplateColumns: `repeat(${desks.length}, minmax(0, 1fr))`,
      }}
    >
      {desks.map((desk) => (
        <li key={desk.departmentId} className="min-w-0">
          <DeskModule desk={desk} governance={governance} />
        </li>
      ))}
    </ul>
  )
}

/**
 * One AI professional at their desk.
 *
 * Person, name, desk, role, state — in that order, and with the portrait large
 * enough to be the thing the module *is* rather than an icon it carries.
 *
 * **The accountability paragraph is gone from this surface.** It is real
 * institutional state and it still reads in full on the desk's own workspace;
 * here it was three lines of prose per module competing with six faces, which
 * is what made a floor of colleagues read as six database records. An overview
 * of an organisation should show who it is, not recite what each of them does.
 *
 * There is no activity light, because whether an agent is *working* is not
 * something the firm records — the reference's row of green AKTIV pills is
 * exactly the fabrication this surface exists to avoid.
 */
function DeskModule({ desk, governance }: { desk: FloorDesk; governance: boolean }) {
  const persona = personaFor(desk.departmentId)
  const attention = desk.awaitingAcceptance > 0

  return (
    <Link
      to="/agents/$departmentId"
      params={{ departmentId: desk.departmentId }}
      className={cn(
        'ref-plate group flex min-w-0 items-center gap-2.5 px-2.5 py-2 transition-colors duration-200',
        governance && 'ref-plate-governance',
      )}
    >
      <div className="relative shrink-0">
        {persona ? (
          <PersonaPlate persona={persona} size="xl" governance={governance} />
        ) : (
          <span aria-hidden="true" className="ref-portrait h-[4.5rem] w-[4.5rem]" />
        )}
        {attention && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning shadow-[0_0_10px_2px_var(--color-warning)]"
          />
        )}
      </div>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {persona && <span className="type-inst-lg truncate">{persona.displayName}</span>}
        <span
          className={cn(
            'type-inst truncate',
            governance ? 'text-institution/90' : 'text-accent/85',
          )}
        >
          {desk.name}
        </span>
        {/*
         * The seat, and whether this discipline yields a reading rather than a
         * measurement. `interpretive` travels with the desk wherever it appears,
         * so it survives everything else being moved off the floor.
         */}
        <span className="type-machine truncate">
          {desk.managerDisplayName}
          {desk.interpretive && ' · tolkande'}
        </span>
      </span>

      {/*
       * The one fact that stays on the floor: what this desk owes.
       *
       * Run history, acceptance dates and provider detail moved to the desk's
       * own workspace — a floor is for seeing who the firm is and where the work
       * has piled up, not for reading six execution logs at once. A desk owing
       * nothing says nothing here rather than printing a zero, and work waiting
       * on a person still lights the marker on the portrait, because that is the
       * one thing a reader must not have to open a page to discover.
       */}
      {desk.obligationsOwed > 0 && (
        <span className="flex shrink-0 flex-col items-end">
          <span className="type-figure text-[17px] leading-5">
            {desk.obligationsOwed}
          </span>
          <span className="type-machine">
            {desk.obligationsOwed === 1 ? 'ärende' : 'ärenden'}
          </span>
        </span>
      )}
    </Link>
  )
}

/* -------------------------------------------------------------- the chief */

function ChiefSeat({
  chiefObligations,
  decisionsRecorded,
}: {
  chiefObligations: number
  decisionsRecorded: number
}) {
  const undecided = decisionsRecorded === 0
  return (
    <div className="flex justify-center">
      <div className="ref-glass ref-glass-chief flex min-w-0 max-w-2xl flex-1 items-center gap-3.5 px-4 py-3">
        <PersonaPlate persona={CIO_PERSONA} size="2xl" chief />

        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="type-section text-institution">CIO-syntes</span>
          <span className="type-inst-lg truncate">{CIO_PERSONA.displayName}</span>
          <span className="type-inst truncate">{CIO_PERSONA.roleTitle}</span>

          {undecided ? (
            <>
              {/*
               * The seat exists; the act has not happened. Said in words rather
               * than implied by an empty panel — and deliberately not dressed as
               * "coming soon", which would promise something nobody has decided
               * to build next. This component fills with real state the moment
               * the workflow reaches a decision.
               *
               * The seat is drawn as the endpoint of the whole composition, and
               * that prominence is a statement about the organisation, not about
               * its output. Nothing about it may soften this sentence.
               */}
              <span className="type-inst-sub">
                Inget CIO-beslut är fattat. Firman håller ingen sammanvägd uppfattning.
              </span>
              <span className="type-machine">
                {chiefObligations > 0
                  ? `${chiefObligations} ärenden väntar på CIO · ingen yta för handlingen ännu`
                  : 'Inga ärenden väntar på CIO'}
              </span>
            </>
          ) : (
            <span className="type-inst-sub">
              {decisionsRecorded} registrerade beslut · {chiefObligations} väntar
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

export type { AgentPersona }
