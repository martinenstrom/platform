import { useState } from 'react'
import { CountryAnalysisTabs } from './CountryAnalysisTabs'
import { CountryHeader } from './CountryHeader'
import { CountryNews } from './CountryNews'
import { CountryOverviewTab } from './CountryOverviewTab'
import { CountryScore } from './CountryScore'
import { CountryTriggers } from './CountryTriggers'
import { InvestmentRisks } from './InvestmentRisks'
import { InvestmentStrengths } from './InvestmentStrengths'
import { MacroOverview } from './MacroOverview'
import { MarketOverview } from './MarketOverview'
import { SectorProfile } from './SectorProfile'
import { TopCompanies } from './TopCompanies'
import type { CountryMacroData } from '~/types/countryExplorer'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'macro', label: 'Macro' },
  { id: 'markets', label: 'Markets' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'companies', label: 'Companies' },
  { id: 'news', label: 'News' },
  { id: 'risks', label: 'Risks' },
  { id: 'scores', label: 'Scores' },
  { id: 'triggers', label: 'Triggers' },
]

export function CountryAnalysis({
  data,
  flagEmoji,
  onBack,
}: {
  data: CountryMacroData
  flagEmoji: string
  onBack: () => void
}) {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className="flex h-full flex-col gap-4">
      <CountryHeader data={data} flagEmoji={flagEmoji} onBack={onBack} />

      {data.isPartial && (
        <div className="hud-frame rounded-lg bg-surface-2 p-4 text-sm text-content-muted">
          Fullständig landsanalys är inte tillgänglig ännu för {data.countryName}.
          Grundläggande information visas nedan; makrodata, nyheter och marknadsanalys
          läggs till senare.
        </div>
      )}

      <CountryAnalysisTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto pr-1">
        {TABS.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`country-tabpanel-${tab.id}`}
            aria-labelledby={`country-tab-${tab.id}`}
            hidden={activeTab !== tab.id}
          >
            {activeTab === tab.id && (
              <>
                {tab.id === 'overview' && (
                  <CountryOverviewTab data={data} onGoToTab={setActiveTab} />
                )}
                {tab.id === 'macro' && <MacroOverview indicators={data.macro} />}
                {tab.id === 'markets' && <MarketOverview markets={data.markets} />}
                {tab.id === 'sectors' && (
                  <SectorProfile sectors={data.sectors} analysis={data.sectorAnalysis} />
                )}
                {tab.id === 'companies' && <TopCompanies companies={data.topCompanies} />}
                {tab.id === 'news' && (
                  <CountryNews news={data.news} synthesis={data.newsSynthesis} />
                )}
                {tab.id === 'risks' && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <InvestmentStrengths strengths={data.investmentStrengths} />
                    <InvestmentRisks risks={data.investmentRisks} />
                  </div>
                )}
                {tab.id === 'scores' && <CountryScore scores={data.scores} />}
                {tab.id === 'triggers' && <CountryTriggers triggers={data.triggers} />}
              </>
            )}
          </div>
        ))}
      </div>

      {data.sources.length > 0 && (
        <p className="hud-label text-[9px] text-content-subtle">
          Källor: {data.sources.join(', ')}
        </p>
      )}
    </div>
  )
}
