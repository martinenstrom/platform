import { ExternalLink } from 'lucide-react'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { formatRelativeTime } from '~/lib/format'
import { COUNTRY_MOCK_NOW } from '~/data/countryExplorer'
import type { CountryNewsItem, NewsImportance } from '~/types/countryExplorer'
import type { Tone } from '~/types'

const IMPORTANCE_META: Record<NewsImportance, { label: string; tone: Tone }> = {
  critical: { label: 'Kritisk', tone: 'negative' },
  high: { label: 'Hög', tone: 'warning' },
  medium: { label: 'Medel', tone: 'accent' },
  low: { label: 'Låg', tone: 'neutral' },
}

const CATEGORY_LABEL: Record<CountryNewsItem['category'], string> = {
  macro: 'Makro',
  'central-bank': 'Centralbank',
  politics: 'Politik',
  regulation: 'Reglering',
  markets: 'Marknad',
  companies: 'Bolag',
  geopolitics: 'Geopolitik',
}

export function CountryNewsCard({ item }: { item: CountryNewsItem }) {
  const importance = IMPORTANCE_META[item.importance]

  return (
    <article className="hud-frame flex flex-col gap-2.5 rounded-lg bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium text-content">{item.headline}</h4>
        <StatusBadge tone={importance.tone} className="shrink-0">
          {importance.label}
        </StatusBadge>
      </header>

      <div className="hud-label flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-content-subtle">
        <span>{CATEGORY_LABEL[item.category]}</span>
        <span aria-hidden="true">·</span>
        <span>{formatRelativeTime(item.publishedAt, COUNTRY_MOCK_NOW)}</span>
        <span aria-hidden="true">·</span>
        <span>{item.source}</span>
        {!item.isConfirmed && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-warning">Obekräftad uppgift</span>
          </>
        )}
      </div>

      <p className="text-sm leading-relaxed text-content-muted">{item.summary}</p>

      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        <p>
          <span className="hud-label text-[9px] text-content-subtle">
            Marknadspåverkan{' '}
          </span>
          <span className="text-content">{item.expectedMarketImpact}</span>
        </p>
        {item.affectedAssets.length > 0 && (
          <p>
            <span className="hud-label text-[9px] text-content-subtle">Berör </span>
            <span className="text-content">{item.affectedAssets.join(', ')}</span>
          </p>
        )}
      </div>

      {item.sourceUrl && (
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="hud-label inline-flex w-fit items-center gap-1 text-[9px] text-content-subtle transition-colors duration-150 hover:text-accent"
        >
          Källa
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </article>
  )
}
