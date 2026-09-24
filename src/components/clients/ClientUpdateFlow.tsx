import { useState, type ReactNode } from 'react'
import type {
  ConfirmClientUpdateResult,
  ItemDecision,
} from '~/application/advisory/confirmClientUpdate'
import type {
  ExtractedItem,
  Importance,
  InteractionSource,
  InteractionType,
  MemoryCandidate,
} from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import {
  CONFIDENCE_LABEL,
  EXTRACTED_KIND_LABEL,
  IMPORTANCE_LABEL,
  INTERACTION_LABEL,
  RECORDABLE_INTERACTIONS,
  SOURCE_LABEL,
  TOPIC_LABEL,
} from '~/presentation/advisory/text'
import type { ClientActions } from './clientActions'

/**
 * Client memory — the ingestion point for relationship intelligence.
 *
 * The advisor writes what happened, in their own words. JARVIS proposes the
 * structure it read from the note: the interaction, the concern, the event
 * with its date, the next meeting, the promise. The advisor confirms, edits
 * or removes each item, or confirms them all. Only confirmed items become
 * records; the note is kept whatever happens; nothing is written silently.
 *
 * Three states, one panel: compose → JARVIS understood → saved.
 */

type Stage = 'compose' | 'analysing' | 'review' | 'saving' | 'saved'

interface Decision {
  decision: 'confirm' | 'discard' | 'pending'
  title: string
  date: string | null
}

const DATED_KINDS: readonly ExtractedItem['kind'][] = [
  'important-event',
  'next-meeting',
  'commitment',
]

const SAVE_ERROR: Record<string, string> = {
  NOT_FOUND: 'Klienten kunde inte hittas.',
  EMPTY_NOTE: 'Skriv vad som hände innan du sparar.',
  INVALID_DATE: 'Datumet kunde inte läsas.',
  ALREADY_RESOLVED: 'Uppdateringen är redan bekräftad.',
  UNKNOWN_ITEM: 'En post kunde inte kännas igen.',
  EVENT_NEEDS_DATE: 'En händelse behöver ett datum innan den kan bekräftas.',
  SERVICE_UNAVAILABLE: 'Relationsminnet kunde inte nås just nu.',
}

export function ClientUpdateFlow({
  today,
  actions,
  onConfirmed,
  onClose,
}: {
  today: string
  actions: ClientActions
  onConfirmed: (result: Extract<ConfirmClientUpdateResult, { ok: true }>) => Promise<void>
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('compose')
  const [noteText, setNoteText] = useState('')
  const [interactionType, setInteractionType] = useState<InteractionType | ''>('')
  const [interactionDate, setInteractionDate] = useState(today)
  const [source, setSource] = useState<InteractionSource>('advisor')
  const [importance, setImportance] = useState<Importance>('normal')
  const [candidate, setCandidate] = useState<MemoryCandidate | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<
    ConfirmClientUpdateResult,
    { ok: true }
  > | null>(null)

  async function analyse() {
    setError(null)
    setStage('analysing')
    const result = await actions.recordUpdate({
      noteText,
      interactionDate,
      interactionType: interactionType === '' ? null : interactionType,
      source,
      importance,
    })
    if (!result.ok) {
      setError(SAVE_ERROR[result.code] ?? 'Uppdateringen kunde inte analyseras.')
      setStage('compose')
      return
    }
    setCandidate(result.candidate)
    setDecisions(
      Object.fromEntries(
        result.candidate.items.map((item) => [
          item.id,
          { decision: 'pending', title: item.title, date: item.date } satisfies Decision,
        ]),
      ),
    )
    setStage('review')
  }

  function decide(itemId: string, decision: Decision['decision']) {
    setDecisions((current) => ({
      ...current,
      [itemId]: { ...current[itemId]!, decision },
    }))
  }

  async function save(all: boolean) {
    if (!candidate) return
    setError(null)
    setStage('saving')
    const payload: ItemDecision[] = candidate.items.map((item) => {
      const d = decisions[item.id]!
      const confirm = all ? d.decision !== 'discard' : d.decision === 'confirm'
      return {
        itemId: item.id,
        decision: confirm ? 'confirm' : 'discard',
        title: d.title,
        date: d.date,
      }
    })
    const result = await actions.confirmUpdate(candidate.id, payload)
    if (!result.ok) {
      setError(SAVE_ERROR[result.code] ?? 'Uppdateringen kunde inte sparas.')
      setStage('review')
      return
    }
    setSaved(result)
    setStage('saved')
    await onConfirmed(result)
  }

  const confirmedCount = Object.values(decisions).filter(
    (d) => d.decision === 'confirm',
  ).length

  return (
    <section
      className="ref-panel shadow-[inset_2px_0_0_0_var(--color-hud-line)]"
      aria-label="Lägg till klientuppdatering"
    >
      <header className="ref-head">
        <h2 className="type-section">
          {stage === 'review' || stage === 'saving'
            ? 'JARVIS förstod'
            : stage === 'saved'
              ? 'Sparat i relationsminnet'
              : 'Vad hände med klienten?'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="type-machine hover:text-content"
        >
          Stäng
        </button>
      </header>

      {(stage === 'compose' || stage === 'analysing') && (
        <form
          className="p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void analyse()
          }}
        >
          <label htmlFor="client-update-note" className="sr-only">
            Vad hände med klienten?
          </label>
          <textarea
            id="client-update-note"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            onKeyDown={(event) => {
              /* Ctrl/Cmd+Enter saves: the advisor's hands stay on the keyboard. */
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                if (stage === 'compose' && noteText.trim().length > 0) void analyse()
              }
            }}
            rows={5}
            placeholder="Träffade klienten i dag. Han är fortsatt orolig över energiallokeringen. Bolånet ska omsättas 14 november. Nästa möte är bokat 3 december. Jag lovade att återkomma med en jämförelse av två placeringsalternativ."
            className="hq-field w-full resize-y text-[14px] leading-relaxed"
            disabled={stage === 'analysing'}
          />
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <Field label="Typ">
              <select
                value={interactionType}
                onChange={(e) =>
                  setInteractionType(e.target.value as InteractionType | '')
                }
                className="hq-field py-1 text-[12px]"
              >
                <option value="">Låt JARVIS avgöra</option>
                {RECORDABLE_INTERACTIONS.map((type) => (
                  <option key={type} value={type}>
                    {INTERACTION_LABEL[type]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Datum">
              <input
                type="date"
                value={interactionDate}
                onChange={(e) => setInteractionDate(e.target.value)}
                className="hq-field py-1 text-[12px]"
              />
            </Field>
            <Field label="Källa">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as InteractionSource)}
                className="hq-field py-1 text-[12px]"
              >
                {(['advisor', 'client', 'system'] as const).map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vikt">
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value as Importance)}
                className="hq-field py-1 text-[12px]"
              >
                {(['low', 'normal', 'high'] as const).map((i) => (
                  <option key={i} value={i}>
                    {IMPORTANCE_LABEL[i]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="ml-auto flex items-center gap-3">
              {stage === 'compose' && (
                <span className="type-machine hidden sm:inline">Ctrl+Enter sparar</span>
              )}
              {stage === 'analysing' && (
                <span className="type-machine text-accent" role="status">
                  JARVIS analyserar…
                </span>
              )}
              <button
                type="submit"
                disabled={stage === 'analysing' || noteText.trim().length === 0}
                className="type-section rounded-[4px] border border-hud-line bg-accent-soft px-3.5 py-2 text-accent transition-colors hover:bg-accent-soft/70 disabled:opacity-40"
              >
                Spara &amp; analysera
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="type-metadata mt-2 text-warning">
              {error}
            </p>
          )}
        </form>
      )}

      {(stage === 'review' || stage === 'saving') && candidate && (
        <div className="p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="type-inst-sub">Bekräfta, redigera eller ta bort varje post.</p>
            <p className="type-machine">
              {INTERACTION_LABEL[candidate.interactionType]} ·{' '}
              {formatLongDate(candidate.interactionDate)} · endast bekräftade poster
              sparas
            </p>
          </div>
          <ul className="mt-2 space-y-1.5">
            {candidate.items.map((item) => {
              const d = decisions[item.id]!
              return (
                <li
                  key={item.id}
                  className={cn(
                    'ref-module px-2.5 py-2 transition-colors',
                    d.decision === 'confirm' && 'border-positive/40',
                    d.decision === 'discard' && 'opacity-50',
                  )}
                >
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <p className="type-section">
                        {EXTRACTED_KIND_LABEL[item.kind]}
                        <span className="type-machine ml-2 normal-case tracking-normal">
                          {CONFIDENCE_LABEL[item.confidence].toLowerCase()}
                        </span>
                      </p>
                      {item.kind === 'discussion-topics' && item.topics ? (
                        <p className="type-inst mt-0.5">
                          {item.topics.map((topic) => TOPIC_LABEL[topic]).join(', ')}
                        </p>
                      ) : (
                        <input
                          aria-label={`${EXTRACTED_KIND_LABEL[item.kind]}: formulering`}
                          value={d.title}
                          onChange={(e) =>
                            setDecisions((c) => ({
                              ...c,
                              [item.id]: { ...c[item.id]!, title: e.target.value },
                            }))
                          }
                          disabled={d.decision === 'discard'}
                          className="hq-field mt-0.5 w-full py-1 text-[13px]"
                        />
                      )}
                      {DATED_KINDS.includes(item.kind) && (
                        <label className="mt-1 flex items-center gap-2 text-[11px] text-content-muted">
                          Datum
                          <input
                            type="date"
                            value={d.date ?? ''}
                            onChange={(e) =>
                              setDecisions((c) => ({
                                ...c,
                                [item.id]: {
                                  ...c[item.id]!,
                                  date: e.target.value || null,
                                },
                              }))
                            }
                            disabled={d.decision === 'discard'}
                            className="hq-field py-0.5 text-[12px]"
                          />
                        </label>
                      )}
                      <p className="type-machine mt-1 text-content-subtle">
                        ”{item.sourceText}”
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => decide(item.id, 'confirm')}
                        aria-pressed={d.decision === 'confirm'}
                        className={cn(
                          'type-machine rounded-[3px] border px-2 py-1 transition-colors',
                          d.decision === 'confirm'
                            ? 'border-positive text-positive'
                            : 'border-line text-content-muted hover:text-content',
                        )}
                      >
                        Bekräfta
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(item.id, 'discard')}
                        aria-pressed={d.decision === 'discard'}
                        className={cn(
                          'type-machine rounded-[3px] border px-2 py-1 transition-colors',
                          d.decision === 'discard'
                            ? 'border-negative text-negative'
                            : 'border-line text-content-muted hover:text-content',
                        )}
                      >
                        Ta bort
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => void save(true)}
              disabled={stage === 'saving'}
              className="type-section rounded-[4px] border border-institution-line bg-institution-soft px-3.5 py-2 text-institution transition-colors hover:bg-institution-soft/70 disabled:opacity-40"
            >
              Bekräfta alla
            </button>
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={stage === 'saving'}
              className="type-section rounded-[4px] border border-line px-3.5 py-2 text-content-muted transition-colors hover:text-content disabled:opacity-40"
            >
              Spara {confirmedCount} bekräftade
            </button>
            {stage === 'saving' && (
              <span className="type-machine text-accent" role="status">
                Sparar…
              </span>
            )}
            {error && (
              <p role="alert" className="type-metadata text-warning">
                {error}
              </p>
            )}
            <p className="type-machine ml-auto">Noteringen sparas alltid i sin helhet.</p>
          </div>
        </div>
      )}

      {stage === 'saved' && saved && (
        <div className="p-3" role="status">
          <p className="type-inst">Uppdateringen är sparad i relationstidslinjen.</p>
          <p className="type-inst-sub mt-1">
            {saved.created.contextFacts} fakta, {saved.created.commitments} åtaganden och{' '}
            {saved.created.events} händelser bekräftade.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStage('compose')
                setNoteText('')
                setCandidate(null)
                setSaved(null)
              }}
              className="type-section rounded-[4px] border border-line px-3 py-1.5 text-content-muted hover:text-content"
            >
              Ny uppdatering
            </button>
            <button
              type="button"
              onClick={onClose}
              className="type-section rounded-[4px] border border-line px-3 py-1.5 text-content-muted hover:text-content"
            >
              Stäng
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="type-section">{label}</span>
      {children}
    </label>
  )
}
