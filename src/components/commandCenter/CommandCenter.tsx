/**
 * The investment firm, as one workstation.
 *
 * ## Where this lives, and why it moved
 *
 * Built as the product's home page, and now the body of Huvudkontoret. The
 * ruling that followed the v1 gate put the market on `/` and gave the firm its
 * own destination — so this composition, unchanged, became the top band of
 * `/headquarters` with the case queue beneath it. It is rendered on exactly one
 * route: the floor, the personas and the CIO seat appear once in the product,
 * and the home page carries no institutional state at all.
 *
 * ## Reference-matched composition, truthful contents
 *
 * The geometry follows the approved reference image region for region:
 *
 *   left rail ~17%    institutional context — attention, holdings, entrances
 *   centre ~63%       the investment floor, dominant
 *   right rail ~20%   live institutional activity
 *   lower band        four compact analytical modules
 *
 * What differs is what fills each region, and only where the firm cannot
 * truthfully populate the reference's:
 *
 *   CIO message           → the firm's open obligations
 *   market overview       → what the institution holds and has settled
 *   quick links           → entrances to real surfaces
 *   floor photograph      → the real organisation, lit rather than peopled
 *   agent network         → real desks and real control functions
 *   CIO decision panel    → the seat, marked inactive, stating no decision exists
 *   live activity feed    → persisted transition events only
 *   sentiment gauge       → obligations by owner, counted
 *   investment decisions  → the firm's recent runs
 *   scenario analysis     → workflow coverage, and what it cannot answer
 *   portfolio exposure    → evidence the firm holds
 *
 * Nothing on this screen is invented. Where the reference shows a capability
 * the firm lacks, the region keeps its shape and states the absence — deleting
 * the region would collapse the composition, and filling it would be a lie.
 */

import { Link } from '@tanstack/react-router'
import { Activity, ArrowDown, Inbox, Library, type LucideIcon } from 'lucide-react'
import { primaryNav, utilityNav } from '~/lib/navigation'
import type {
  CommandCenterView,
  ObligationGroup,
  OwnerLoad,
  RunLine,
  StepCoverage,
} from '~/application/analysis/commandCenter'
import type { ActivityItem } from '~/domain/analysis'
import {
  toActivityLines,
  type DepartmentNames,
} from '~/presentation/analysis/activityText'
import {
  actIsReachable,
  actLabel,
  STEP_ABSENCE,
  stepLabel,
} from '~/presentation/analysis/commandCenterText'
import {
  PROVIDER_KIND_LABEL,
  RUN_STATE_LABEL,
  usageText,
} from '~/presentation/analysis/runText'
import type { OverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import {
  dataOr,
  toQuoteViewModel,
  toYieldViewModel,
} from '~/presentation/marketData/viewModels'
import {
  disclosedRows,
  discloseObservation,
  disclosureTitle,
  type Disclosure,
} from '~/presentation/marketData/disclosure'
import { formatPercent } from '~/lib/format'
import { Panel as BasePanel } from '~/components/ui/Panel'
import { AgentNetwork } from './AgentNetwork'
import { PersonaPlate } from './PersonaPlate'
import { CIO_PERSONA, personaFor } from '~/presentation/analysis/agentPersona'
import { cn } from '~/lib/cn'

/** The workstation panel, named locally so every region reads the same. */
const Panel = BasePanel

export interface CommandCenterProps {
  view: CommandCenterView
  /**
   * Market context for the rail alone. Absent in tests and wherever the
   * snapshot could not be read — the strip then does not render, because a
   * market module with nothing behind it is the one thing it must never be.
   */
  market?: OverviewSnapshot
}

export function CommandCenter({ view, market }: CommandCenterProps) {
  const names: DepartmentNames = Object.fromEntries(
    view.floor.map((desk) => [desk.departmentId, desk.name]),
  )
  const decisions =
    view.stepCoverage.find((entry) => entry.step === 'cio-decision')?.complete ?? 0
  return (
    /*
     * The workstation fills the screen it is given.
     *
     * A fixed tall band rather than `100vh`: the firm's floor still reads as
     * one instrument at a glance, but Huvudkontoret continues below it with the
     * case queue, and a workstation that claimed the whole viewport would hide
     * the firm's own work behind a scroll.
     */
    <div className="flex min-h-0 flex-col gap-2 xl:min-h-[52rem]">
      {/*
       * The three rails, at the reference's proportions. They hold from `xl`
       * up; below that the composition unstacks in order of dependence — the
       * activity rail drops first, because a feed reads perfectly well as a
       * full-width strip and a floor does not.
       */}
      <div className="grid min-h-0 flex-1 grid-cols-1 items-start gap-2 xl:grid-cols-[17fr_63fr] 2xl:grid-cols-[17fr_63fr_20fr]">
        <ContextRail view={view} market={market} />

        {/*
         * No panel around the floor. The dominant element of the screen cannot
         * be a card with a head band on it — the reference gives its centre to
         * the room, and the room carries its own label.
         */}
        <div className="flex min-h-[32rem] min-w-0 flex-col">
          <AgentNetwork
            floor={view.floor}
            chiefObligations={view.chiefObligations}
            decisionsRecorded={decisions}
          />
        </div>

        <ActivityRail activity={view.activity} names={names} />
      </div>

      {/* The lower band: four compact instruments, horizontally aligned. */}
      {/*
       * Sized by content, never by a fixed height. A `10.5rem` band cut the run
       * ledger mid-row at 1536px — truthful institutional state clipped because
       * a number in a class name said the row was that tall.
       */}
      <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <OwnerLoadModule load={view.ownerLoad} total={view.obligations.length} />
        <RecentRunsModule runs={view.recentRuns} names={names} />
        <CoverageModule coverage={view.stepCoverage} />
        <EvidenceModule view={view} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ left rail */

/**
 * The executive rail.
 *
 * ## One surface, not a stack of cards
 *
 * Every section used to be a `Panel`: same border, same radius, same head band,
 * repeated six times down the column. That reads as an admin screen no matter
 * how good the contents are, because repetition at that scale reads as a list
 * of widgets rather than as a designed object.
 *
 * So the rail is **one glass surface** with bands inside it, separated by
 * hairlines rather than by borders and gaps. Hierarchy comes from depth, tone
 * and type instead:
 *
 *   wordmark    no chrome at all, generous air, the identity anchor
 *   CIO         raised ground, a bronze leading edge, the largest portrait
 *   attention   plain ground, one figure carrying the weight
 *   market      recessed ground — a tape sits *in* the surface, not on it
 *   firm        the same recess, quieter type, a reference strip
 *   doors       navigation rows that light along their leading edge
 *   atmosphere  the slot the column ends on
 *   news        the quietest band, last
 *
 * Nothing here changes what is displayed or where it comes from. Every figure
 * is the same read model and the same market snapshot as before.
 */
const ATMOSPHERE: string | null = null
const OBLIGATION_ROWS = 5

function ContextRail({
  view,
  market,
}: {
  view: CommandCenterView
  market?: OverviewSnapshot
}) {
  const decisions =
    view.stepCoverage.find((entry) => entry.step === 'cio-decision')?.complete ?? 0

  return (
    <div className="ref-rail flex min-h-0 min-w-0 flex-col">
      <Wordmark />
      <ChiefBand chiefObligations={view.chiefObligations} decisionsRecorded={decisions} />
      <AttentionBand view={view} />
      <MarketBand market={market} />
      <FirmBand view={view} />
      <DoorsBand />
      <Atmosphere />
      <NewsBand market={market} />
    </div>
  )
}

/**
 * The house wordmark, and the page's home affordance.
 *
 * Serif, bronze, and given more air than anything else on the rail — an
 * identity anchor earns its space by having none of the density around it.
 * There is deliberately no second wordmark on this screen; the horizontal band
 * gave this up rather than duplicating it.
 */
function Wordmark() {
  return (
    <Link
      to="/"
      aria-label="Handelsbanken — till kommandocentralen"
      className="block shrink-0 px-4 pb-4 pt-[18px] font-serif text-[25px] leading-none tracking-[-0.012em] text-institution transition-opacity duration-200 hover:opacity-75"
    >
      Handelsbanken
    </Link>
  )
}

/* -------------------------------------------------------------------- CIO */

/**
 * The head of the house — the rail's hero.
 *
 * The reference prints a quotation here. **The firm has no view to quote**, so
 * the band carries the identity at full presence and states the absence
 * beneath it, in that order and with that weight: the person is the subject,
 * the institutional state is the caption. An invented sentence in this seat
 * would be the firm appearing to hold an opinion, which is the single most
 * damaging fabrication available on this page.
 */
function ChiefBand({
  chiefObligations,
  decisionsRecorded,
}: {
  chiefObligations: number
  decisionsRecorded: number
}) {
  return (
    <section className="ref-rail-band ref-rail-cio px-4 pb-4 pt-[18px]">
      {/*
       * Named for the document outline from the canonical persona, not from a
       * string that happens to match it. A hard-coded title here would survive
       * a change to the roster and leave the outline saying something the plate
       * below no longer does.
       */}
      <h2 className="sr-only">{CIO_PERSONA.roleTitle}</h2>
      <div className="flex items-center gap-4">
        <PersonaPlate persona={CIO_PERSONA} size="xl" chief />
        <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span className="truncate text-[16.5px] font-medium leading-[1.4rem] tracking-[-0.014em] text-content">
            {CIO_PERSONA.displayName}
          </span>
          <span className="text-[11.5px] leading-[1rem] tracking-[0.005em] text-institution/85">
            {CIO_PERSONA.roleTitle}
          </span>
        </div>
      </div>

      <div className="ref-rail-hairline mt-4 pt-3.5">
        <p className="text-[13px] font-normal leading-[1.15rem] text-content-muted">
          Ingen sammanvägd uppfattning ännu.
        </p>
        <p className="type-machine mt-1.5">
          {decisionsRecorded === 0
            ? 'Inget CIO-beslut är registrerat'
            : `${decisionsRecorded} registrerade beslut`}
          {chiefObligations > 0 && ` · ${chiefObligations} väntar`}
        </p>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- attention */

/**
 * What the firm is answerable for.
 *
 * One figure carries the weight and the rows beneath it are how you start
 * acting on it. **No case is singled out** — the firm records no priority, so
 * the groups appear in the order the projection produced and nothing here
 * calls the visible ones important. The whole queue is on this page, below the
 * floor, and the link says how many it holds.
 */
function AttentionBand({ view }: { view: CommandCenterView }) {
  const owed = view.obligations.length

  return (
    <section className="ref-rail-band ref-rail-primary px-4 py-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="ref-rail-label">Kräver uppmärksamhet</h2>
        <span className="type-machine">
          {owed}/{view.totalCases}
        </span>
      </header>

      {owed === 0 ? (
        <p className="mt-2 text-[12px] leading-[1.05rem] text-content-muted">
          {view.totalCases === 0
            ? 'Firman håller inga ärenden ännu.'
            : `Alla ${view.totalCases} ärenden är avgjorda.`}
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold leading-[1.8rem] tracking-[-0.03em] tabular-nums text-content">
              {owed}
            </span>
            <span className="text-[12px] leading-[1.05rem] text-content-muted">
              {owed === 1 ? 'ärende väntar på någon' : 'ärenden väntar på någon'}
            </span>
          </div>

          <ul className="mt-2.5 flex flex-col gap-2">
            {view.obligationGroups.slice(0, OBLIGATION_ROWS).map((group) => (
              <ObligationGroupRow
                key={`${group.act}-${group.owningDepartmentId}`}
                group={group}
              />
            ))}
          </ul>

          {/* A refined interaction, not a dashboard footer bar. */}
          <a
            href="#arenden"
            className="ref-rail-more mt-3 inline-flex items-center gap-1.5"
          >
            Visa alla {owed} ärenden
            <ArrowDown className="h-[11px] w-[11px]" aria-hidden="true" />
          </a>
        </>
      )}
    </section>
  )
}

function ObligationGroupRow({ group }: { group: ObligationGroup }) {
  const count = group.caseIds.length
  return (
    <li>
      <Link
        to="/cases/$caseId"
        params={{ caseId: group.caseIds[0]! }}
        className="ref-rail-row group flex flex-col gap-[3px] py-0.5"
      >
        <div className="flex items-baseline justify-between gap-2">
          {/* The act first: what is owed reads before which case owes it. */}
          <span className="truncate text-[12.5px] font-medium leading-[1.1rem] text-institution">
            {actLabel(group.act)}
          </span>
          <span className="text-[12.5px] font-medium leading-[1.1rem] tabular-nums text-content-muted">
            {count}
          </span>
        </div>
        <span className="truncate text-[11.5px] leading-[1rem] text-content-muted/80">
          {group.exampleQuestion}
        </span>
        <span className="type-machine truncate">
          {group.owningDepartmentId ??
            (group.ownershipKind === 'chief' ? 'CIO' : 'ingen angiven')}
          {/*
           * Stated, not hidden. The firm owes this act whether or not a screen
           * exists for it, and an obligation quietly dropped because it is
           * inconvenient to act on is the failure the product exists to prevent.
           */}
          {!actIsReachable(group.act) && ' · ingen yta ännu'}
          {group.hasBlocker && ' · blockerat'}
        </span>
      </Link>
    </li>
  )
}

/* ----------------------------------------------------------------- market */

interface TapeRow {
  id: string
  label: string
  value: string
  change: string
  negative: boolean
  /** What this number is, and whether it may be read as current. */
  disclosure: Disclosure
}

/**
 * The market tape.
 *
 * Recessed into the surface rather than raised on it, because a tape is
 * something you read *in* an instrument. Three precisely aligned columns,
 * tabular figures throughout, and restrained sign colour — a private bank's
 * tape does not shout at its reader.
 *
 * **Every figure is read from the same snapshot the market landing page
 * renders**, and every figure carries its own disclosure. A row does not
 * appear when its category came back without data.
 *
 * The panel used to close with one sentence — *vissa kategorier ej aktuella* —
 * standing in for all six rows at once. It was true and useless: a reader
 * looking at an index level could tell that something on the page was not
 * current, never which number. Disclosure belongs to the specific number, so
 * the sentence is gone and each row states its own case.
 */
function MarketBand({ market }: { market?: OverviewSnapshot }) {
  if (!market) return null

  const rows: TapeRow[] = []

  /*
   * A category that resolved to nothing must say so.
   *
   * `disclosedRows` returns no rows for an `error` envelope, and the first
   * version of this band simply rendered fewer rows — so a failed category
   * disappeared from the tape without a word. Silence is the one disclosure a
   * market surface may never use: a reader cannot distinguish "we could not
   * fetch this" from "this was never here".
   */
  const unavailable = (label: string, disclosure: Disclosure): TapeRow => ({
    id: `unavailable-${label}`,
    label,
    value: '—',
    change: '',
    negative: false,
    disclosure,
  })

  const indices = disclosedRows(market.indices)
  if (indices.rows.length === 0) rows.push(unavailable('Index', indices.disclosure))
  for (const quote of indices.rows.slice(0, 3)) {
    const model = toQuoteViewModel(quote)
    const percent = quote.percentageChange
    rows.push({
      id: model.id,
      label: model.label,
      value: model.value,
      change: percent === null ? '—' : formatPercent(percent),
      negative: (percent ?? 0) < 0,
      disclosure: discloseObservation(quote.provenance, market.indices, {
        symbol: quote.symbol,
        session: quote.session,
      }),
    })
  }

  const fx = disclosedRows(market.fx)
  if (fx.rows.length === 0) rows.push(unavailable('Valuta', fx.disclosure))
  for (const quote of fx.rows.slice(0, 1)) {
    const model = toQuoteViewModel(quote)
    const percent = quote.percentageChange
    rows.push({
      id: model.id,
      label: model.label,
      value: model.value,
      change: percent === null ? '—' : formatPercent(percent),
      negative: (percent ?? 0) < 0,
      disclosure: discloseObservation(quote.provenance, market.fx, {
        symbol: quote.symbol,
        session: quote.session,
      }),
    })
  }

  const yields = disclosedRows(market.yields)
  if (yields.rows.length === 0) rows.push(unavailable('Statsräntor', yields.disclosure))
  for (const governmentYield of yields.rows.slice(0, 2)) {
    const model = toYieldViewModel(governmentYield)
    rows.push({
      id: `yield-${model.label}`,
      label: model.label,
      value: model.value,
      change: model.change,
      negative: model.negative,
      /* A published daily figure: no session, and quality governs its horizon. */
      disclosure: discloseObservation(governmentYield.provenance, market.yields, {
        symbol: governmentYield.symbol,
      }),
    })
  }

  if (rows.length === 0) return null

  return (
    <section className="ref-rail-band ref-rail-recessed px-4 py-3.5">
      <h2 className="ref-rail-label">Marknadsöversikt</h2>

      <ul className="mt-2.5 flex flex-col gap-[7px]">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col"
            title={disclosureTitle(row.disclosure)}
          >
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="min-w-0 flex-1 truncate text-[12px] leading-[1.05rem] text-content-muted">
                {row.label}
              </span>
              <span className="shrink-0 text-[12.5px] font-medium leading-[1.05rem] text-content">
                {row.value}
              </span>
              <span
                className={cn(
                  'w-[4.1rem] shrink-0 whitespace-nowrap text-right text-[11.5px] leading-[1.05rem]',
                  row.change === ''
                    ? 'text-content-subtle'
                    : row.negative
                      ? 'ref-tape-down'
                      : 'ref-tape-up',
                )}
              >
                {row.change}
              </span>
            </div>
            {/*
             * The marker sits under the number it governs and nowhere else. A
             * current observation shows nothing, which is what makes a marker
             * mean something when it appears.
             */}
            {row.disclosure.marker !== null && (
              <span
                className={cn(
                  'ref-disclosure',
                  row.disclosure.state === 'fixture' && 'ref-disclosure-fixture',
                )}
              >
                {row.disclosure.marker}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------- firm */

/** The firm's own figures, in the same recess as the tape and quieter than it. */
function FirmBand({ view }: { view: CommandCenterView }) {
  return (
    <section className="ref-rail-band ref-rail-quiet px-4 py-3">
      <h2 className="ref-rail-label">Institutionellt läge</h2>
      <dl className="mt-2 flex flex-col gap-[5px]">
        <Figure
          label="Ärenden"
          value={view.totalCases}
          note={`${view.settledCases} avgjorda`}
        />
        <Figure label="Underlag" value={view.evidenceSetCount} note="sammanställda" />
        <Figure
          label="Väntar på CIO"
          value={view.chiefObligations}
          note="ingen yta ännu"
        />
      </dl>
    </section>
  )
}

function Figure({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="flex items-baseline gap-2 tabular-nums">
      <dt className="min-w-0 flex-1 truncate text-[12px] leading-[1.05rem] text-content-muted">
        {label}
      </dt>
      <dd className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-[12.5px] font-medium leading-[1.05rem] text-content">
          {value}
        </span>
        <span className="type-machine w-[5.75rem] whitespace-nowrap text-right">
          {note}
        </span>
      </dd>
    </div>
  )
}

/* ------------------------------------------------------------------ doors */

/**
 * Doors into the firm.
 *
 * The reference lists six quick links: a new investment idea, a report, a
 * company analysis, a scenario, a portfolio view, a knowledge base. **Five of
 * those are capabilities this firm does not have**, and a rail full of links
 * that go nowhere is worse than a short one — it teaches the reader that the
 * product's own navigation is decorative.
 *
 * So these are the destinations that exist, read from the product's one
 * definition of them (`~/lib/navigation`) rather than listed again here. The
 * wordmark above is already the home affordance; Kommandocentral appears here
 * too, because a reader looking for a named destination should not have to
 * know that. This page is left out of its own doors.
 */
const DOOR_NOTES: Record<string, string> = {
  '/': 'Marknadsläget',
  '/sentinel': 'Klienter · Sentinel · Marknadspåverkan',
  '/evidence': 'Vad firman håller',
  '/settings': 'Miljö och konto',
}

function DoorsBand() {
  const doors = primaryNav.filter((item) => item.to !== '/headquarters')
  return (
    <section className="ref-rail-band px-2 py-2.5">
      <h2 className="ref-rail-label px-2">Institutionella ytor</h2>
      <ul className="mt-1.5 flex flex-col">
        {doors.map((item) => (
          <RailLink
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            note={DOOR_NOTES[item.to] ?? ''}
          />
        ))}
        <RailLink to="#arenden" icon={Inbox} label="Ärenden" note="Hela kön" anchor />
        {utilityNav.map((item) => (
          <RailLink
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            note={DOOR_NOTES[item.to] ?? ''}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * One door: icon, title, and what is behind it.
 *
 * `anchor` covers a destination on this page rather than a route — the case
 * queue sits below the floor, and routing to the page you are already on would
 * be a worse answer than scrolling to the part of it you asked for.
 */
function RailLink({
  to,
  icon: Icon,
  label,
  note,
  anchor = false,
}: {
  to: string
  icon: LucideIcon
  label: string
  note: string
  anchor?: boolean
}) {
  const inner = (
    <>
      <Icon
        className="h-[15px] w-[15px] shrink-0 text-institution/70 transition-colors duration-200 group-hover:text-institution"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-[1.1rem] text-content">
        {label}
      </span>
      <span className="type-machine shrink-0 truncate">{note}</span>
    </>
  )
  const className = 'ref-rail-door group flex items-center gap-2.5 px-2 py-[9px]'

  return (
    <li>
      {anchor ? (
        <a href={to} className={className}>
          {inner}
        </a>
      ) : (
        <Link to={to} className={className}>
          {inner}
        </Link>
      )}
    </li>
  )
}

/* ------------------------------------------------------------- atmosphere */

/**
 * The band the column ends on, structurally prepared and deliberately empty.
 *
 * The reference closes its rail with a photograph of the city. Huvudkontoret
 * has no environmental asset of its own: the dealing room belongs to the floor,
 * and Kommandocentral's approved image is Kommandocentral's — borrowing it
 * would put another surface's asset on this one and alter something frozen.
 *
 * So the slot exists and renders nothing. Point `ATMOSPHERE` at a dedicated
 * Headquarters photograph when one is commissioned and the band appears in
 * place, framed and scrimmed, with no other change required.
 */
function Atmosphere() {
  if (ATMOSPHERE === null) return null
  return (
    <div
      aria-hidden="true"
      className="ref-rail-band ref-rail-atmosphere h-[9rem] shrink-0"
      style={{ backgroundImage: `url(${ATMOSPHERE})` }}
    />
  )
}

/* ------------------------------------------------------------------- news */

/**
 * Senaste nytt — the quietest band, and last.
 *
 * Market news out of the same snapshot the tape reads. Publication time is
 * absolute rather than "för 42 minuter sedan": a relative stamp computed at
 * render disagrees between the server and the browser, and the reference prints
 * clock times anyway.
 *
 * This is market data and is labelled as such. It is **not** institutional
 * activity — that is the right-hand rail, which reads persisted transition
 * events — and no headline here is evidence of anything the firm did.
 */
function NewsBand({ market }: { market?: OverviewSnapshot }) {
  if (!market) return null
  const items = dataOr(market.news, []).slice(0, 3)
  if (items.length === 0) return null

  return (
    <section className="ref-rail-band px-4 py-3.5">
      <h2 className="ref-rail-label">Senaste nytt</h2>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item.id} className="flex gap-2.5">
            <span className="type-machine shrink-0 pt-[1px]">
              {clock(item.publishedAt)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="line-clamp-2 text-[12px] leading-[1.05rem] text-content-muted">
                {item.headline}
              </span>
              <span className="type-machine truncate">{item.outlet}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ----------------------------------------------------------- right rail */

function ActivityRail({
  activity,
  names,
}: {
  activity: readonly ActivityItem[]
  names: DepartmentNames
}) {
  const lines = toActivityLines(activity, names)
  return (
    <Panel
      title="Institutionell aktivitet"
      meta={lines.length > 0 ? String(lines.length) : undefined}
      bodyClassName="min-h-0 p-0"
      className="min-h-0 2xl:col-start-3 2xl:row-start-1 2xl:max-h-[52rem]"
    >
      {lines.length === 0 ? (
        <Empty
          icon={Activity}
          title="Ingen aktivitet"
          body="Ingen körning och ingen ärendeövergång finns registrerad."
        />
      ) : (
        <ul className="h-full divide-y divide-line overflow-y-auto">
          {lines.map((line, index) => {
            /*
             * The face of the desk the event belongs to, where the firm has one.
             * It identifies WHO the record says acted; it is not a status light
             * and it appears only because an event exists to attach it to.
             */
            const persona = personaFor(line.departmentId)
            return (
              <li key={`${line.at}-${index}`}>
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: line.caseId }}
                  className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-surface-2"
                >
                  {persona ? (
                    <PersonaPlate persona={persona} size="sm" />
                  ) : (
                    <span aria-hidden="true" className="ref-portrait h-8 w-8 shrink-0" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="type-inst truncate">{line.departmentName}</span>
                    <span className="type-inst-sub truncate">{line.text}</span>
                  </span>
                  <span className="type-machine shrink-0">{clock(line.at)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* ----------------------------------------------------------- lower band */

/** Where the firm's obligations sit. The reference's gauge, filled with counting. */
function OwnerLoadModule({ load, total }: { load: readonly OwnerLoad[]; total: number }) {
  const max = load[0]?.count ?? 0
  return (
    <Panel title="Var arbetet ligger" meta={`${total} utestående`}>
      {load.length === 0 ? (
        <p className="type-inst-sub">Inget arbete väntar på någon.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {load.slice(0, 5).map((owner) => (
            <li key={owner.label} className="flex items-center gap-2">
              <span className="type-inst-sub w-24 shrink-0 truncate">{owner.label}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    owner.isChief ? 'bg-institution' : 'bg-accent-solid',
                  )}
                  style={{ width: `${max === 0 ? 0 : (owner.count / max) * 100}%` }}
                />
              </span>
              <span className="type-machine w-4 shrink-0 text-right">{owner.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * The firm's recent runs. The reference's decisions table, filled with what
 * exists.
 *
 * **Provider and cost travel with every row**, at the width to show them. A
 * fuller ledger used to sit further down Huvudkontoret carrying exactly these
 * two facts; folding them in here keeps one run list on the page instead of
 * two, and keeps the rule they exist for: a stub must never read as live
 * analysis, and a cost nobody measured must never render as a number.
 */
function RecentRunsModule({
  runs,
  names,
}: {
  runs: readonly RunLine[]
  names: DepartmentNames
}) {
  return (
    <Panel
      title="Senaste körningar"
      meta={runs.length > 0 ? String(runs.length) : undefined}
    >
      {runs.length === 0 ? (
        <p className="type-inst-sub">Ingen körning är registrerad ännu.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {runs.map((run) => (
            <li key={run.runId}>
              <Link
                to="/runs/$runId"
                params={{ runId: run.runId }}
                className="flex items-baseline gap-2 rounded-[3px] px-1 py-0.5 transition-colors hover:bg-surface-2"
              >
                <span className="type-machine w-[4.5rem] shrink-0 whitespace-nowrap">
                  {clock(run.startedAt)}
                </span>
                <span className="type-inst-sub min-w-0 flex-1 truncate">
                  {names[run.departmentId] ?? run.departmentId}
                </span>
                <span className="type-machine hidden shrink-0 min-[1700px]:inline">
                  {PROVIDER_KIND_LABEL[run.providerKind]}
                </span>
                <span className="type-machine hidden shrink-0 min-[1900px]:inline">
                  {usageText(run.usage)}
                </span>
                <span className={cn('type-machine shrink-0', runTone(run.state))}>
                  {RUN_STATE_LABEL[run.state as keyof typeof RUN_STATE_LABEL] ??
                    run.state}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * Green and red mean settled and failed, and nothing else.
 *
 * `awaiting-acceptance` is deliberately neither: work waiting on a person has
 * not succeeded, and colouring it green would tell a reader the firm accepted
 * something nobody has looked at.
 */
function runTone(state: string): string {
  if (state === 'completed') return 'text-positive'
  if (state === 'failed' || state === 'timed-out' || state === 'rejected')
    return 'text-negative'
  if (state === 'awaiting-acceptance') return 'text-warning'
  if (state === 'running') return 'text-accent'
  return ''
}

/** What the workflow has and has not reached. The reference's scenario bars. */
function CoverageModule({ coverage }: { coverage: readonly StepCoverage[] }) {
  const reachedCount = coverage.filter((entry) => entry.complete > 0).length
  return (
    <Panel
      title="Vad firman kan svara på"
      meta={`${reachedCount}/${coverage.length} steg`}
    >
      <ul className="flex flex-col gap-1">
        {coverage.map((entry) => {
          const reached = entry.complete > 0
          return (
            <li key={entry.step} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  reached ? 'bg-positive' : 'bg-line-strong',
                )}
              />
              <span
                className={cn(
                  'type-inst-sub min-w-0 flex-1 truncate',
                  !reached && 'text-content-subtle',
                )}
                title={reached ? undefined : STEP_ABSENCE[entry.step]}
              >
                {stepLabel(entry.step)}
              </span>
              <span className="type-machine shrink-0">
                {reached ? String(entry.complete) : 'saknas'}
              </span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** Evidence the firm holds. The reference's exposure donut, filled with truth. */
function EvidenceModule({ view }: { view: CommandCenterView }) {
  return (
    <Panel title="Underlag firman håller">
      <div className="flex h-full flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="type-figure">{view.evidenceSetCount}</span>
          <span className="type-inst-sub">
            sammanställda underlag, bokförda som handlingar
          </span>
        </div>
        <p className="type-machine">
          {view.latestAssemblyAt === null
            ? 'Ingen sammanställning bokförd'
            : `Senast ${clock(view.latestAssemblyAt)}`}
        </p>
        <Link
          to="/evidence"
          className="type-machine mt-auto inline-flex items-center gap-1.5 text-institution hover:underline"
        >
          <Library className="h-3 w-3" aria-hidden="true" />
          Öppna underlagsvyn
        </Link>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------ primitives */

function Empty({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Activity
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
      <Icon className="h-3.5 w-3.5 text-content-subtle" aria-hidden="true" />
      <span className="type-inst">{title}</span>
      <span className="type-inst-sub">{body}</span>
    </div>
  )
}

/** `08-20 17:09`. Fixed, never relative — this feed links to records. */
function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
