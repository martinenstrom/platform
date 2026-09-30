import { sourceName } from '~/presentation/advisory/meetingCockpitText'

/**
 * "Varför visas detta?" — the records an item or a section rests on, by
 * name, on request. Never the reasoning, always the evidence.
 */
export function SourcesNote({
  ids,
  titles,
  label = 'Varför visas detta?',
}: {
  ids: readonly string[]
  titles: Readonly<Record<string, string>>
  label?: string
}) {
  const unique = [...new Set(ids)]
  return (
    <details className="mt-1.5">
      <summary className="type-machine cursor-pointer list-none underline decoration-dotted underline-offset-2 hover:text-content">
        {label}
      </summary>
      <p className="type-machine mt-1">
        {unique.length === 0
          ? 'Härlett ur registret som helhet; ingen enskild post.'
          : `Källor: ${unique.map((id) => sourceName(id, titles)).join(' · ')}`}
      </p>
    </details>
  )
}
