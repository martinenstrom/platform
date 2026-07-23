import type { KeyboardEvent } from 'react'
import { useRef } from 'react'
import { cn } from '~/lib/cn'

export interface CountryTabDef {
  id: string
  label: string
}

interface CountryAnalysisTabsProps {
  tabs: CountryTabDef[]
  activeTab: string
  onTabChange: (id: string) => void
}

/** Standard ARIA tabs pattern (roving tabindex, arrow-key navigation). */
export function CountryAnalysisTabs({
  tabs,
  activeTab,
  onTabChange,
}: CountryAnalysisTabsProps) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + delta + tabs.length) % tabs.length
    const nextTab = tabs[nextIndex]
    if (!nextTab) return
    onTabChange(nextTab.id)
    tabRefs.current[nextTab.id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Landsanalys, sektioner"
      className="hud-frame flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            tabRefs.current[tab.id] = el
          }}
          type="button"
          role="tab"
          id={`country-tab-${tab.id}`}
          aria-selected={activeTab === tab.id}
          aria-controls={`country-tabpanel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cn(
            'hud-label rounded-md px-3 py-1.5 text-[10px] whitespace-nowrap transition-colors duration-150',
            activeTab === tab.id
              ? 'bg-accent-soft text-accent'
              : 'text-content-subtle hover:text-content',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
