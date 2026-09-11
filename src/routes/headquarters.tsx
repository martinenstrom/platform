import { createFileRoute, Link } from '@tanstack/react-router'
import { Inbox, Landmark, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { Panel } from '~/components/ui/Panel'
import { EmptyState } from '~/components/ui/EmptyState'
import { CommandCenter } from '~/components/commandCenter/CommandCenter'
import { StatusBadge } from '~/components/ui/StatusBadge'
import {
  ownershipText,
  STAGE_LABEL,
  STAGE_TONE,
} from '~/presentation/analysis/caseStandingText'
import { actLabel } from '~/presentation/analysis/commandCenterText'
import {
  getCaseListFn,
  getCommandCenterFn,
  getOperatorIdentitiesFn,
  startInvestmentCaseFn,
  type CaseListResponse,
  type CommandCenterResponse,
} from '~/infrastructure/analysis/serverFns'
import { getOverviewSnapshotFn } from '~/infrastructure/marketData/serverFns'
import type { OverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import type { CaseListing } from '~/application/analysis/caseListing'
import type { OperatorIdentitiesResponse } from '~/infrastructure/analysis/serverFns'
import { ConveneCommittee } from '~/components/headquarters/ConveneCommittee'

/**
 * Huvudkontoret — the investment firm, in one place.
 *
 * **This is the firm's only home.** The CIO seat, the agent personas, the
 * specialist desks, the independent control functions, the Agent Network, the
 * obligations, the institutional activity and the runs all live here and
 * nowhere else. They were briefly rendered on `/` as well; the ruling that
 * moved the market back to the home page ended that, and the duplication it
 * created is what this page's shape now prevents.
 *
 * The page reads top to bottom as the firm does: **who it is and what it is
 * doing** in the workstation band, then **what is moving through it** in the
 * case queue.
 *
 * **Merged at the information architecture, not in the domain.** `/agents`
 * showed the desks and `/cases` showed the work, under two names, one of which
 * was already "Huvudkontor" — so the destination called Headquarters was the
 * one without the desks on it. They are one place now, and the two things it
 * holds stay two things:
 *
 *   the floor   desks, managers and control functions — **who the firm is**
 *   the work    cases and where each one stands — **what is moving through it**
 *
 * Those remain separately typed and separately read: `agentDirectory` and
 * `caseListing` are untouched, and nothing here merges a desk with a case.
 * The merge is a navigation decision, and it stops at navigation.
 *
 * Desks are entrances, not applications. A desk opens into its own workspace
 * at `/agents/$departmentId`, which keeps the floor's context rather than
 * replacing it.
 */
export const Route = createFileRoute('/headquarters')({
  loader: async () => ({
    /*
     * Two reads, two read models, one page. The workstation view carries the
     * floor, the obligations and the activity; the case list carries the full
     * queue the workstation only samples. Neither is derived from the other.
     */
    center: await getCommandCenterFn(),
    /* Who the operator can act as. Offered whole; the institution decides. */
    operators: await getOperatorIdentitiesFn(),
    cases: await getCaseListFn(),
    /*
     * Market context for the rail's overview strip, and for nothing else.
     *
     * The floor and everything below it remain institutional state alone. This
     * is the same snapshot the market landing page renders, read here so a
     * glanceable strip can sit in the sidebar without a second source of market
     * truth existing in the product.
     */
    market: await getOverviewSnapshotFn(),
  }),
  component: HeadquartersRoute,
})

function HeadquartersRoute() {
  const data = Route.useLoaderData() as HeadquartersData
  return <HeadquartersPage {...data} />
}

export interface HeadquartersData {
  center: CommandCenterResponse
  cases: CaseListResponse
  operators?: OperatorIdentitiesResponse
  /**
   * Optional so the suite can render the firm without standing up market data.
   * The rail's market strip and news module simply do not appear without it,
   * which is the correct behaviour for a surface that must never invent a quote.
   */
  market?: OverviewSnapshot
}

const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
}

/**
 * Exported and prop-driven so the suite can render the floor against a fixture
 * generated from a real PostgreSQL run, rather than against hand-written desks.
 * A page that only ever renders its own loader cannot be held to what the firm
 * actually contains.
 */
export function HeadquartersPage(data: HeadquartersData) {
  if (!data.center.ok) {
    return (
      <PageShell>
        <PageHeader title="Huvudkontor" description="Kunde inte läsas." />
        <EmptyState
          icon={ServerOff}
          title="Golvet kan inte visas"
          description={
            FAILURE_TEXT[data.center.code] ?? 'Firmans golv kan inte läsas just nu.'
          }
        />
      </PageShell>
    )
  }

  /* Counted on the server. The route arranges; it does not tally. */
  const view = data.center.view
  const desks = view.floor

  const cases = data.cases.ok ? data.cases.cases : []
  const outstanding = cases.filter((entry) => !entry.standing.settled)
  const settled = cases.filter((entry) => entry.standing.settled)

  return (
    <PageShell>
      {/*
       * The page names itself for a screen reader and for nothing else.
       *
       * **The title strip is gone.** It printed `Huvudkontor · N avdelningar, N
       * registrerade körningar · N pågående, N avgjorda` above the workstation,
       * and every one of those figures already has a truthful home on the page:
       * the floor states its own composition, the run ledger its count, the
       * queue its two headings, and `Institutionellt läge` the settled share.
       * A strip that exists to repeat them costs the top of the viewport and
       * makes an institution's floor read as a document with a title on it.
       */}
      <h1 className="sr-only">Huvudkontor</h1>

      {/*
       * The act the institution starts from: the Chairman asks a question and
       * the committee that answers it is convened. It lives here rather than
       * in a room, because a room is one case and this is where a case begins.
       */}
      {data.operators?.ok && (
        <ConveneCommittee
          identities={data.operators.identities}
          onSubmit={(input) => startInvestmentCaseFn({ data: input })}
        />
      )}

      {/*
       * The workstation: the floor and its personas, what requires attention,
       * institutional activity, where the work sits, recent runs, workflow
       * coverage and the evidence the firm holds — one composition, rendered on
       * this route alone.
       *
       * The runs it lists are compact by design. A second, fuller run ledger
       * used to sit on this page; the full record with its provider and its
       * measured cost lives on `/runs/$runId` and in the desk workspace, so two
       * lists of the same eight runs on one screen said nothing the drill-down
       * did not say better.
       */}
      {desks.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Inga avdelningar att tilldela arbete"
          description="Firmans registrerade arbetsflöden tilldelar ingen avdelning arbete."
        />
      ) : (
        <CommandCenter view={view} market={data.market} />
      )}

      {/* ------------------------------------------------------- the work */}
      {!data.cases.ok ? (
        <Panel title="Ärenden">
          <EmptyState
            icon={ServerOff}
            title="Ärendena kan inte visas"
            description={
              FAILURE_TEXT[data.cases.code] ?? 'Ärendena kan inte läsas just nu.'
            }
          />
        </Panel>
      ) : cases.length === 0 ? (
        /*
         * No cases at all is a different fact from no OUTSTANDING cases, and
         * the two must not render alike. An empty `Pågående (0)` card would
         * read as a list that failed to load rather than as a firm that is
         * holding nothing.
         */
        <EmptyState
          icon={Inbox}
          title="Inga ärenden ännu"
          description="När ett ärende öppnas visas det här med var det står och vad som händer härnäst."
        />
      ) : (
        <div id="arenden" className="flex scroll-mt-4 flex-col gap-4">
          <Panel title={`Pågående (${outstanding.length})`} bodyClassName="p-0">
            {outstanding.length === 0 ? (
              <p className="p-3 text-sm text-content-muted">
                Inget ärende väntar på någon just nu.
              </p>
            ) : (
              <CaseList entries={outstanding} />
            )}
          </Panel>

          {settled.length > 0 && (
            <Panel title={`Avgjorda (${settled.length})`} bodyClassName="p-0">
              <CaseList entries={settled} />
            </Panel>
          )}
        </div>
      )}
    </PageShell>
  )
}

/**
 * One case in the queue.
 *
 * Ported unchanged from the page this floor replaced, because every field on it
 * is load-bearing: a settled case says so **in words** rather than leaving the
 * owner blank, which on a complete row reads as missing data. The act is always
 * shown — including `Inget utestående — ärendet är avgjort` — so a decided case
 * and a waiting one can never be mistaken for one another.
 */
function CaseList({ entries }: { entries: readonly CaseListing[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {entries.map((entry) => (
        <CaseRow key={entry.investmentCase.id} entry={entry} />
      ))}
    </ul>
  )
}

function CaseRow({ entry }: { entry: CaseListing }) {
  const { investmentCase, standing } = entry
  const owner = ownershipText(standing.ownership)
  const outstanding = standing.steps.filter((step) => step.status === 'outstanding')

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <Link
        to="/cases/$caseId"
        params={{ caseId: investmentCase.id }}
        className="flex flex-col gap-2 rounded-lg px-2 py-2 hover:bg-surface-2"
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={STAGE_TONE[standing.stage]}>
            {STAGE_LABEL[standing.stage]}
          </StatusBadge>
          <span className="text-sm font-medium">{investmentCase.question}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="type-metadata">
            {owner === null ? 'Ingen ansvarig — avgjort' : `Ansvarig: ${owner}`}
          </span>
          {/* The domain's own next act, read through, never re-derived here. */}
          <span className="type-metadata text-institution">
            {actLabel(standing.nextAct.act)}
          </span>
          {outstanding.length > 0 && (
            <span className="type-metadata">{outstanding.length} utestående steg</span>
          )}
          {standing.blockers.length > 0 && (
            <span className="type-metadata text-warning">
              {standing.blockers.length} blockerande
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}
