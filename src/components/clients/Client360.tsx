import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Client360 as Client360View } from '~/application/advisory/client360'
import { AskJarvisClient } from './AskJarvisClient'
import type { ClientActions } from './clientActions'
import { ClientContextPanel } from './ClientContextPanel'
import { ClientHero } from './ClientHero'
import { ClientUpdateFlow } from './ClientUpdateFlow'
import { CommitmentsPanel } from './CommitmentsPanel'
import { EntityListCard } from './dossier/EntityListCard'
import { InsightCard } from './dossier/InsightCard'
import { MeetingCard } from './dossier/MeetingCard'
import { PrioritiesCard } from './dossier/PrioritiesCard'
import { RelationshipCard } from './dossier/RelationshipCard'
import { SectionBand } from './dossier/SectionBand'
import { DOSSIER_SECTIONS } from './dossier/sections'
import { EventsPanel } from './EventsPanel'
import { ClientActionsMenu } from './lifecycle/ClientActionsMenu'
import { LifecycleActPanel } from './lifecycle/LifecycleActPanel'
import type { LifecycleAct, LifecycleActions } from './lifecycle/lifecycleActions'
import {
  FormerClientModule,
  LifecycleHistoryModule,
  OnboardingModule,
} from './lifecycle/LifecycleModules'
import { FinancialStrip } from './FinancialStrip'
import { FinancingPanel } from './FinancingPanel'
import { GoalsPanel } from './GoalsPanel'
import { LargestHoldings } from './LargestHoldings'
import { MarketImpactPanel } from './MarketImpactPanel'
import { OpportunitiesPanel } from './OpportunitiesPanel'
import { AllocationCard, PerformanceCard, PortfolioHoldingsCard } from './PortfolioPanel'
import { RelationshipTimeline } from './RelationshipTimeline'
import { WealthStructure } from './WealthStructure'

/**
 * Client 360 — one relationship, understood in ten seconds, composed as a
 * dossier rather than a dashboard.
 *
 * The cover stands on the room itself; a band beneath it names the
 * dossier's sections. Then three clusters, each a row or two of modules
 * cut to different widths: what matters now (the metrics, JARVIS's one
 * insight, the three priorities, the next meeting); the financial picture
 * (the wealth snapshot, the portfolio against its mandate, the performance,
 * the holdings, the lending); and the relationship in context (its health,
 * its timeline, the promises, what the firm knows, what is coming, the
 * household, the market, the goals, the openings). Add what happened opens
 * under the cover, never on a separate page; the question to the memory
 * closes the dossier.
 *
 * Everything rendered arrives as typed state from the server; the surface
 * derives nothing.
 */
export function Client360({
  view,
  actions,
  lifecycle,
  onChanged,
}: {
  view: Client360View
  actions: ClientActions
  /** The lifecycle doors, where the route provides them; without them the cover carries no menu. */
  lifecycle?: LifecycleActions
  /** Called after the record changed, so the route re-reads the view. */
  onChanged: () => Promise<void>
}) {
  const [updating, setUpdating] = useState(false)
  const [act, setAct] = useState<LifecycleAct | null>(null)
  const status = view.client.lifecycle.status
  const flow = useRef<HTMLDivElement>(null)

  /* The door is on the cover; the flow opens under it. Bring it into view when the two are apart. */
  useEffect(() => {
    if (!updating) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    flow.current?.scrollIntoView?.({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [updating])

  const advisorNames: Record<string, string> = view.advisor
    ? { [view.advisor.id]: view.advisor.displayName }
    : {}

  async function completeCommitment(commitmentId: string) {
    const result = await actions.completeCommitment(commitmentId)
    if (result.ok) await onChanged()
  }

  /* The band names only the sections this relationship has. */
  const sections = DOSSIER_SECTIONS.filter(
    (section) =>
      (section.id !== 'finansiering' || view.liabilities.length > 0) &&
      (section.id !== 'portfolj' || view.portfolio !== null),
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ClientHero
        view={view}
        onAddUpdate={() => setUpdating((v) => !v)}
        updating={updating}
        menu={
          lifecycle ? <ClientActionsMenu status={status} onChoose={setAct} /> : undefined
        }
      />
      <SectionBand sections={sections} />

      {act && lifecycle && (
        <LifecycleActPanel
          act={act}
          view={view}
          actions={lifecycle}
          onDone={async () => onChanged()}
          onClose={() => setAct(null)}
        />
      )}

      {updating && (
        <div ref={flow}>
          <ClientUpdateFlow
            today={view.today}
            actions={actions}
            onConfirmed={async () => onChanged()}
            onClose={() => setUpdating(false)}
          />
        </div>
      )}

      {/* ---- what matters now ---- */}
      <div id="oversikt" className="dossier-target flex flex-col gap-3">
        <FinancialStrip view={view} />
        {/* What matters now depends on where the relationship stands: a former client is history, an onboarding one is being taken in. */}
        {status === 'former' ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)]">
            <FormerClientModule view={view} className="md:col-span-2 xl:col-span-1" />
            <MeetingCard view={view} />
          </div>
        ) : status === 'onboarding' ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)]">
            <OnboardingModule
              view={view}
              onActivate={lifecycle ? () => setAct('activate') : null}
              className="md:col-span-2 xl:col-span-1"
            />
            <MeetingCard view={view} />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <InsightCard view={view} className="md:col-span-2 xl:col-span-1" />
            <PrioritiesCard view={view} />
            <MeetingCard view={view} />
          </div>
        )}
      </div>

      {/* ---- the financial picture ---- */}
      <Cluster>Finansiell bild</Cluster>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <WealthStructure view={view} className="md:col-span-2 xl:col-span-1" />
        <AllocationCard view={view} />
        <PerformanceCard view={view} />
      </div>
      {view.portfolio && (
        <div className="grid gap-3 xl:grid-cols-2">
          <LargestHoldings view={view} />
          <PortfolioHoldingsCard view={view} />
        </div>
      )}
      {!view.portfolio && <LargestHoldings view={view} />}
      {/* No lending, no lending module: the strip already says "Skulder 0". */}
      {view.liabilities.length > 0 && <FinancingPanel view={view} />}

      {/* ---- the relationship in context ---- */}
      <Cluster>Relation och kontext</Cluster>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
        <RelationshipCard view={view} />
        <RelationshipTimeline
          interactions={view.interactions}
          advisorNames={advisorNames}
          className="md:col-span-2 xl:col-span-1"
        />
        <CommitmentsPanel view={view} onComplete={completeCommitment} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ClientContextPanel facts={view.contextFacts} />
        <EventsPanel view={view} />
        <EntityListCard view={view} className="md:col-span-2 xl:col-span-1" />
      </div>
      {view.lifecycleEvents.length > 0 && <LifecycleHistoryModule view={view} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <MarketImpactPanel
          impacts={view.marketImpacts}
          history={view.recentMarketHistory}
          className="md:col-span-2 xl:col-span-1"
        />
        <GoalsPanel goals={view.goals} />
        <OpportunitiesPanel
          opportunities={view.opportunities}
          advisorNames={advisorNames}
        />
      </div>

      <AskJarvisClient actions={actions} />

      <p className="type-machine px-1 pb-2">
        Syntetisk relation · derivat per {view.today} · {view.method} · relationsminnet
        hålls i serverprocessen och är inte beständig lagring
      </p>
    </div>
  )
}

/** A cluster's name: one quiet line with a short gold rule, so the rows beneath it read as a chapter. */
function Cluster({ children }: { children: ReactNode }) {
  return (
    <p className="type-section mt-2 flex items-center gap-3 px-1 text-content">
      <span>{children}</span>
      <span aria-hidden="true" className="h-px w-8 bg-institution/70" />
    </p>
  )
}
