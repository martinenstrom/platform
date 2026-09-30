import { useEffect, useRef, useState } from 'react'
import type { Client360 as Client360View } from '~/application/advisory/client360'
import { AskJarvisClient } from './AskJarvisClient'
import type { ClientActions } from './clientActions'
import { ClientContextPanel } from './ClientContextPanel'
import { ClientHero } from './ClientHero'
import { ClientUpdateFlow } from './ClientUpdateFlow'
import { CommitmentsPanel } from './CommitmentsPanel'
import { EventsPanel } from './EventsPanel'
import { FinancialStrip } from './FinancialStrip'
import { FinancingPanel } from './FinancingPanel'
import { GoalsPanel } from './GoalsPanel'
import { HouseholdPanel } from './HouseholdPanel'
import { IntelligenceRail } from './IntelligenceRail'
import { JarvisIntelligence } from './JarvisIntelligence'
import { LargestHoldings } from './LargestHoldings'
import { MarketImpactPanel } from './MarketImpactPanel'
import { OpportunitiesPanel } from './OpportunitiesPanel'
import { PortfolioPanel } from './PortfolioPanel'
import { RelationshipTimeline } from './RelationshipTimeline'
import { WealthStructure } from './WealthStructure'

/**
 * Client 360 — one relationship, understood in ten seconds.
 *
 * The first viewport is the dossier: the cover, the financial strip, the
 * wealth structure beside the largest holdings, the portfolio against the
 * mandate — and, in the rail beside them, JARVIS's recommendation, what
 * needs attention, what is coming, and how the relationship stands. Below
 * it the deeper modules continue in the same language: the market, the
 * goals, the relationship intelligence (context, promises, dates, the
 * timeline), financing and household, the openings, JARVIS's full reading
 * and the client-scoped question. Add what happened opens beneath the cover,
 * never on a separate page.
 *
 * Everything rendered arrives as typed state from the server; the surface
 * derives nothing.
 */
export function Client360({
  view,
  actions,
  onChanged,
}: {
  view: Client360View
  actions: ClientActions
  /** Called after the record changed, so the route re-reads the view. */
  onChanged: () => Promise<void>
}) {
  const [updating, setUpdating] = useState(false)
  const flow = useRef<HTMLDivElement>(null)

  /* The door is in the rail; the flow opens under the cover. Bring it into view when the two are apart. */
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

  return (
    <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,30%)]">
      <div className="flex min-w-0 flex-col gap-2.5">
        <ClientHero view={view} />

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

        <FinancialStrip view={view} />
        <div id="formogenhet" className="grid gap-2.5 2xl:grid-cols-2">
          <WealthStructure view={view} />
          <LargestHoldings view={view} />
        </div>
        <div id="portfolj">
          <PortfolioPanel view={view} />
        </div>

        {/* Market-to-Client: what the market moved that this record is exposed to. */}
        <MarketImpactPanel
          impacts={view.marketImpacts}
          history={view.recentMarketHistory}
        />
        <div id="mal">
          <GoalsPanel goals={view.goals} />
        </div>

        <h2 id="relationsintelligens" className="type-section mt-2 px-1 text-institution">
          Relationsintelligens
        </h2>
        <div id="klientkontext">
          <ClientContextPanel facts={view.contextFacts} />
        </div>
        <div className="grid gap-2.5 lg:grid-cols-2">
          <CommitmentsPanel view={view} onComplete={completeCommitment} />
          <div id="handelser">
            <EventsPanel view={view} />
          </div>
        </div>
        <div id="relationstidslinje">
          <RelationshipTimeline
            interactions={view.interactions}
            advisorNames={advisorNames}
          />
        </div>

        {/* No lending, no lending panel: the strip already says "Skulder 0". */}
        <div id="finansiering">
          {view.liabilities.length > 0 ? (
            <div className="grid gap-2.5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <FinancingPanel view={view} />
              <HouseholdPanel view={view} />
            </div>
          ) : (
            <HouseholdPanel view={view} />
          )}
        </div>
        <div id="mojligheter">
          <OpportunitiesPanel
            opportunities={view.opportunities}
            advisorNames={advisorNames}
          />
        </div>

        <JarvisIntelligence view={view} />
        <AskJarvisClient actions={actions} />

        <p className="type-machine px-1 pb-2">
          Syntetisk relation · derivat per {view.today} · {view.method} · relationsminnet
          hålls i serverprocessen och är inte beständig lagring
        </p>
      </div>

      <div className="min-w-0 xl:sticky xl:top-[58px] xl:self-start">
        <IntelligenceRail
          view={view}
          onCompleteCommitment={completeCommitment}
          onAddUpdate={() => setUpdating((v) => !v)}
          updating={updating}
        />
      </div>
    </div>
  )
}
