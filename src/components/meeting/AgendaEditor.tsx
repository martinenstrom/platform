import { useState } from 'react'
import type { AgendaItem } from '~/domain/advisory'
import { Panel } from '~/components/ui/Panel'
import { agendaLabel } from '~/presentation/advisory/meetingCockpitText'
import { SourcesNote } from './SourcesNote'

interface EditableItem {
  id: string
  label: string
  custom: boolean
  sourceIds: readonly string[]
}

/**
 * The suggested agenda, editable in place: move up or down, remove, add a
 * custom item. Process-local state — the suggestion is derived from the
 * record on every read, the advisor's edits live on this page until it
 * closes. Simple controls, on purpose: robust beats drag-and-drop.
 */
export function AgendaEditor({
  agenda,
  titles,
}: {
  agenda: readonly AgendaItem[]
  titles: Readonly<Record<string, string>>
}) {
  const [items, setItems] = useState<EditableItem[]>(() =>
    agenda.map((a) => ({
      id: a.id,
      label: agendaLabel(a),
      custom: false,
      sourceIds: a.sourceIds,
    })),
  )
  const [draft, setDraft] = useState('')

  function move(index: number, delta: -1 | 1) {
    setItems((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item!)
      return next
    })
  }

  function remove(index: number) {
    setItems((current) => current.filter((_, i) => i !== index))
  }

  function add() {
    const label = draft.trim()
    if (!label) return
    setItems((current) => [
      ...current,
      {
        id: `custom-${current.length + 1}-${label.slice(0, 12)}`,
        label,
        custom: true,
        sourceIds: [],
      },
    ])
    setDraft('')
  }

  return (
    <Panel
      title="Förslag på agenda"
      meta={`${items.length} punkter · redigerbar`}
      bodyClassName="p-3"
    >
      {items.length === 0 ? (
        <p className="type-inst-sub">Agendan är tom. Lägg till en punkt nedan.</p>
      ) : (
        <ol className="space-y-1" aria-label="Agenda">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-[3px] border border-line px-2 py-1.5"
            >
              <span className="type-machine w-5 shrink-0 text-content-subtle">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-content">
                {item.label}
                {item.custom && <span className="type-machine ml-1.5">egen punkt</span>}
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Flytta upp: ${item.label}`}
                  className="type-machine rounded-[3px] border border-line px-1.5 py-0.5 hover:text-content disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Flytta ned: ${item.label}`}
                  className="type-machine rounded-[3px] border border-line px-1.5 py-0.5 hover:text-content disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Ta bort: ${item.label}`}
                  className="type-machine rounded-[3px] border border-line px-1.5 py-0.5 hover:text-negative"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <label htmlFor="agenda-custom" className="sr-only">
          Egen agendapunkt
        </label>
        <input
          id="agenda-custom"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Lägg till egen punkt"
          className="hq-field min-w-0 flex-1 text-[13px]"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          className="type-section shrink-0 rounded-[4px] border border-line px-3 py-1.5 text-content-muted transition-colors hover:text-content disabled:opacity-40"
        >
          Lägg till
        </button>
      </form>
      <SourcesNote ids={agenda.flatMap((a) => a.sourceIds)} titles={titles} />
    </Panel>
  )
}
