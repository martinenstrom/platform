import { useMemo, useState } from 'react'
import { CountryNewsCard } from './CountryNewsCard'
import { CountryNewsFilters } from './CountryNewsFilters'
import { CountryNewsSynthesis } from './CountryNewsSynthesis'
import { DataNotAvailable } from './DataSourceBadge'
import type {
  CountryNewsItem,
  CountryNewsSynthesis as Synthesis,
  NewsFilter,
  NewsSort,
} from '~/types/countryExplorer'

const IMPORTANCE_RANK: Record<CountryNewsItem['importance'], number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
}

export function CountryNews({
  news,
  synthesis,
}: {
  news: CountryNewsItem[]
  synthesis: Synthesis | null
}) {
  const [filter, setFilter] = useState<NewsFilter>('all')
  const [sort, setSort] = useState<NewsSort>('recent')

  const visible = useMemo(() => {
    const filtered =
      filter === 'all' ? news : news.filter((item) => item.category === filter)

    const sorted = [...filtered]
    if (sort === 'recent') {
      sorted.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      )
    } else if (sort === 'importance') {
      sorted.sort((a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance])
    } else {
      // "impact" — no numeric field exists for expected market impact (it's
      // free text, matching the spec's example strings), so approximate by
      // importance as the closest available proxy rather than inventing a
      // fake numeric score.
      sorted.sort((a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance])
    }
    return sorted
  }, [news, filter, sort])

  return (
    <section aria-labelledby="country-news-heading" className="flex flex-col gap-4">
      <h3 id="country-news-heading" className="hud-label text-xs text-content-muted">
        Country Intelligence // Key Developments
      </h3>

      {news.length === 0 ? (
        <div className="hud-frame flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      ) : (
        <>
          <CountryNewsFilters
            filter={filter}
            onFilterChange={setFilter}
            sort={sort}
            onSortChange={setSort}
          />
          <div className="flex flex-col gap-3">
            {visible.map((item) => (
              <CountryNewsCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      <CountryNewsSynthesis synthesis={synthesis} />
    </section>
  )
}
