import { useState } from 'react'
import { Bookmark } from 'lucide-react'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { cn } from '~/lib/cn'
import { COUNTRY_MOCK_NOW, getGlobalNewsFeed } from '~/data/countryExplorer'
import type { NewsCategory, NewsSentiment } from '~/types/countryExplorer'

/** Terminal-compact relative time for the feed's narrow left column (42m, 3h, 2d). */
function compactRelativeTime(publishedAt: string, now: Date): string {
  const diffMs = now.getTime() - new Date(publishedAt).getTime()
  const minutes = Math.max(1, Math.round(diffMs / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** Display names for the feed's real category field, reference-style caps. */
const CATEGORY_LABEL: Record<NewsCategory, string> = {
  macro: 'Macro',
  'central-bank': 'Monetary Policy',
  politics: 'Politics',
  regulation: 'Regulation',
  markets: 'Markets',
  companies: 'Corporate',
  geopolitics: 'Geopolitics',
}

const CATEGORY_CLASS: Record<NewsCategory, string> = {
  macro: 'text-accent',
  'central-bank': 'text-warning',
  politics: 'text-warning',
  regulation: 'text-info',
  markets: 'text-accent',
  companies: 'text-accent',
  geopolitics: 'text-warning',
}

const SENTIMENT_LABEL: Record<NewsSentiment, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
  mixed: 'Mixed',
}

const SENTIMENT_CLASS: Record<NewsSentiment, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-content-subtle',
  mixed: 'text-warning',
}

/**
 * Compact global feed — aggregates the real (mock) per-country news already
 * written, not new content. Reference row format: time column, colored
 * category label, headline, "Impact:" sentiment line, bookmark. Clicking a
 * row expands the full headline and market-impact text in place; the card
 * never grows (fixed height with internal scrolling).
 */
export function GlobalNewsFeedCard() {
  const items = getGlobalNewsFeed(6)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useState<ReadonlySet<string>>(new Set())

  function toggleBookmark(id: string) {
    setBookmarked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <DashboardCard
      dense
      title="Global News Feed"
      className="h-[400px] transition-shadow duration-200 hover:shadow-[0_0_28px_rgba(77,232,245,0.12)]"
      bodyClassName="min-h-0 overflow-y-auto pr-1"
    >
      <ul className="flex flex-col">
        {items.map((item) => {
          const expanded = expandedId === item.id
          const saved = bookmarked.has(item.id)
          return (
            <li
              key={item.id}
              className="flex gap-2 border-t border-line py-1.5 first:border-t-0"
            >
              <span className="hud-label w-8 shrink-0 pt-0.5 text-[9px] text-content-subtle">
                {compactRelativeTime(item.publishedAt, COUNTRY_MOCK_NOW)}
              </span>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : item.id)}
                className="min-w-0 flex-1 rounded-md px-1 text-left transition-colors duration-150 hover:bg-surface-2"
              >
                <p className={cn('hud-label text-[8px]', CATEGORY_CLASS[item.category])}>
                  {CATEGORY_LABEL[item.category]}
                </p>
                <p
                  className={cn(
                    'text-[13px] leading-snug text-content',
                    !expanded && 'line-clamp-1',
                  )}
                >
                  {item.headline}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug">
                  <span className="text-content-subtle">Impact: </span>
                  <span className={SENTIMENT_CLASS[item.sentiment]}>
                    {SENTIMENT_LABEL[item.sentiment]}
                  </span>
                  <span className="text-content-subtle"> · {item.source}</span>
                </p>
                {expanded && (
                  <p className="mt-1 text-[11px] leading-snug text-content-muted">
                    {item.expectedMarketImpact}
                  </p>
                )}
              </button>
              <button
                type="button"
                aria-pressed={saved}
                aria-label={saved ? 'Ta bort bokmärke' : 'Bokmärk nyhet'}
                onClick={() => toggleBookmark(item.id)}
                className={cn(
                  'shrink-0 self-start pt-0.5 transition-colors duration-150',
                  saved ? 'text-accent' : 'text-content-subtle hover:text-content',
                )}
              >
                <Bookmark
                  className="h-3.5 w-3.5"
                  fill={saved ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </DashboardCard>
  )
}
