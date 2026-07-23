/** Loading placeholder shown while a country's analysis data is being fetched. */
export function CountryExplorerSkeleton() {
  return (
    <div
      className="flex h-full flex-col gap-4"
      role="status"
      aria-label="Läser in landsanalys…"
    >
      <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
      <div className="h-8 w-64 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
    </div>
  )
}
