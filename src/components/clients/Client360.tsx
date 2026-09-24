import { useState } from 'react'
import type { Client360 as Client360View } from '~/application/advisory/client360'
import type { MeetingPrep } from '~/domain/advisory'
import { AskJarvisClient } from './AskJarvisClient'
import type { ClientActions } from './clientActions'
import { ClientContextPanel } from './ClientContextPanel'
import { ClientHero } from './ClientHero'
import { ClientUpdateFlow } from './ClientUpdateFlow'
import { CommitmentsPanel } from './CommitmentsPanel'
import { EventsPanel } from './EventsPanel'
import { FinancialSnapshot } from './FinancialSnapshot'
import { FinancingPanel } from './FinancingPanel'
import { GoalsPanel } from './GoalsPanel'
import { HouseholdPanel } from './HouseholdPanel'
import { IntelligenceRail } from './IntelligenceRail'
import { JarvisIntelligence } from './JarvisIntelligence'
import { MeetingPrepPanel } from './MeetingPrepPanel'
import { OpportunitiesPanel } from './OpportunitiesPanel'
import { PortfolioPanel } from './PortfolioPanel'
import { RelationshipTimeline } from './RelationshipTimeline'
import { WealthStructure } from './WealthStructure'

/**
 * Client 360 — one relationship, understood in ten seconds.
 *
 * The hierarchy the spec asks for, top to bottom: hero, financial snapshot,
 * wealth structure, portfolio, goals, relationship intelligence (context,
 * timeline, dates, promises), financing and household, opportunities,
 * JARVIS intelligence, and the client-scoped question. The intelligence
 * rail stands beside all of it on a wide screen. The two doors of the daily
 * workflow — prepare the meeting, add what happened — open beneath the
 * hero as expanded panels, never as a separate page.
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
  const [door, setDoor] = useState<'update' | 'prep' | null>(null)
  const [prep, setPrep] = useState<MeetingPrep | null>(null)
  const [prepLoading, setPrepLoading] = useState(false)
  const [prepError, setPrepError] = useState<string | null>(null)

  const advisorNames: Record<string, string> = view.advisor
    ? { [view.advisor.id]: view.advisor.displayName }
    : {}

  async function openPrep() {
    if (door === 'prep') {
      setDoor(null)
      return
    }
    setDoor('prep')
    setPrepLoading(true)
    setPrepError(null)
    const result = await actions.prepareMeeting()
    setPrepLoading(false)
    if (result.ok) setPrep(result.prep)
    else setPrepError('Underlaget kunde inte sammanställas just nu.')
  }

  async function completeCommitment(commitmentId: string) {
    const result = await actions.completeCommitment(commitmentId)
    if (result.ok) await onChanged()
  }

  return (
    <div className="flex flex-col gap-2">
      <ClientHero
        view={view}
        activeDoor={door}
        onPrepareMeeting={() => void openPrep()}
        onAddUpdate={() => setDoor(door === 'update' ? null : 'update')}
      />

      {door === 'update' && (
        <ClientUpdateFlow
          today={view.today}
          actions={actions}
          onConfirmed={async () => onChanged()}
          onClose={() => setDoor(null)}
        />
      )}
      {door === 'prep' && (
        <MeetingPrepPanel
          prep={prep}
          loading={prepLoading}
          error={prepError}
          onClose={() => setDoor(null)}
        />
      )}

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(300px,27%)]">
        <div className="flex min-w-0 flex-col gap-2">
          <FinancialSnapshot view={view} />
          <WealthStructure view={view} />
          <PortfolioPanel view={view} />
          <GoalsPanel goals={view.goals} />

          <h2 className="type-section mt-2 px-1 text-institution">
            Relationsintelligens
          </h2>
          <ClientContextPanel facts={view.contextFacts} />
          <div className="grid gap-2 lg:grid-cols-2">
            <CommitmentsPanel view={view} onComplete={completeCommitment} />
            <EventsPanel view={view} />
          </div>
          <RelationshipTimeline
            interactions={view.interactions}
            advisorNames={advisorNames}
          />

          {/* No lending, no lending panel: the snapshot already says "Skulder 0". */}
          {view.liabilities.length > 0 ? (
            <div className="grid gap-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <FinancingPanel view={view} />
              <HouseholdPanel view={view} />
            </div>
          ) : (
            <HouseholdPanel view={view} />
          )}
          <OpportunitiesPanel
            opportunities={view.opportunities}
            advisorNames={advisorNames}
          />

          <JarvisIntelligence view={view} />
          <AskJarvisClient actions={actions} />

          <p className="type-machine px-1 pb-2">
            Syntetisk relation · derivat per {view.today} · {view.method} ·
            relationsminnet hålls i serverprocessen och är inte beständig lagring
          </p>
        </div>

        <div className="min-w-0 xl:sticky xl:top-14 xl:self-start">
          <IntelligenceRail view={view} onCompleteCommitment={completeCommitment} />
        </div>
      </div>
    </div>
  )
}
