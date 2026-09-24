import { useState } from 'react'
import type { AskAboutClientResult } from '~/application/advisory/askAboutClient'
import type { MemoryHit } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import {
  CONTEXT_LABEL,
  EVENT_LABEL,
  INTERACTION_LABEL,
  MEMORY_ANSWER_HEADING,
} from '~/presentation/advisory/text'
import type { ClientActions } from './clientActions'
import { JarvisMark } from './JarvisBlock'

const SUGGESTIONS = [
  'När diskuterade vi avgifter senast?',
  'Vad är klienten orolig för just nu?',
  'Vad har jag lovat?',
  'När förfaller bolånet?',
  'Vad har hänt sedan förra mötet?',
  'Vad sa vi om energiallokeringen?',
] as const

/**
 * Ask JARVIS about this client — answered from the relationship's own
 * structured memory. Not a chat window: a question, and the dated records
 * that answer it, each saying what kind of record it is. The method is
 * named on the answer, so a lexicon answer never passes as a model's.
 */
export function AskJarvisClient({ actions }: { actions: ClientActions }) {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [result, setResult] = useState<
    AskAboutClientResult | { ok: false; code: 'SERVICE_UNAVAILABLE' } | null
  >(null)
  const [busy, setBusy] = useState(false)

  async function ask(text: string) {
    const q = text.trim()
    if (!q) return
    setBusy(true)
    setAsked(q)
    try {
      setResult(await actions.ask(q))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ref-panel" aria-label="Fråga JARVIS om klienten">
      <header className="ref-head">
        <h2 className="type-section">Fråga JARVIS om klienten</h2>
        <span className="type-machine">relationsminne · lexikon v1</span>
      </header>
      <div className="p-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void ask(question)
          }}
        >
          <label htmlFor="ask-jarvis-client" className="sr-only">
            Fråga om klienten
          </label>
          <input
            id="ask-jarvis-client"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Vad har jag lovat? När förfaller bolånet? Vad har hänt sedan sist?"
            className="hq-field min-w-0 flex-1 text-[13px]"
          />
          <button
            type="submit"
            disabled={busy || question.trim().length === 0}
            className="type-section shrink-0 rounded-[4px] border border-hud-line bg-accent-soft px-3 py-1.5 text-accent transition-colors hover:bg-accent-soft/70 disabled:opacity-40"
          >
            Fråga
          </button>
        </form>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Exempelfrågor">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(suggestion)
                  void ask(suggestion)
                }}
                className="rounded-[3px] border border-line px-2 py-0.5 text-[11.5px] text-content-muted transition-colors hover:border-line-strong hover:text-content"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>

        {asked && (
          <div className="mt-3 border-t border-line pt-3" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <JarvisMark kind="ask" />
              <span className="type-machine">”{asked}”</span>
            </div>
            {busy ? (
              <p className="type-machine mt-2 text-accent" role="status">
                JARVIS söker i relationsminnet…
              </p>
            ) : result && result.ok ? (
              <div className="mt-2">
                <h3 className="type-inst">
                  {MEMORY_ANSWER_HEADING[result.answer.kind]}
                  {result.answer.topic && (
                    <span className="type-inst-sub ml-1.5">· {result.answer.topic}</span>
                  )}
                </h3>
                {result.answer.hits.length === 0 ? (
                  <p className="type-inst-sub mt-1">
                    Inget i relationsminnet svarar på frågan.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {result.answer.hits.map((hit) => (
                      <HitRow key={`${hit.type}-${hit.id}`} hit={hit} />
                    ))}
                  </ul>
                )}
                <p className="type-machine mt-2">
                  {result.answer.hits.length} träffar · metod {result.answer.method} ·
                  svar ur strukturerat minne, inte genererad text
                </p>
              </div>
            ) : (
              <p className="type-metadata mt-2 text-warning" role="alert">
                {result?.ok === false && result.code === 'EMPTY_QUESTION'
                  ? 'Ställ en fråga.'
                  : 'Relationsminnet kunde inte nås just nu.'}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function HitRow({ hit }: { hit: MemoryHit }) {
  const kind =
    hit.type === 'interaction'
      ? INTERACTION_LABEL[hit.interactionType]
      : hit.type === 'context'
        ? CONTEXT_LABEL[hit.category]
        : hit.type === 'event'
          ? EVENT_LABEL[hit.eventType]
          : hit.type === 'commitment'
            ? `Åtagande · ${hit.status === 'open' ? 'öppet' : hit.status === 'done' ? 'klart' : 'avbrutet'}`
            : hit.type === 'goal'
              ? 'Mål'
              : hit.type === 'holding'
                ? 'Innehav'
                : 'Lån'
  const amount =
    hit.type === 'holding' || hit.type === 'liability' ? formatMsek(hit.value) : null
  return (
    <li className="flex items-start gap-3 text-[12.5px] leading-snug">
      <span className="type-machine w-[5.5rem] shrink-0 text-content">
        {hit.date ? formatLongDate(hit.date) : '—'}
      </span>
      <span className="type-machine w-[7.5rem] shrink-0 truncate">{kind}</span>
      <span
        className={cn(
          'min-w-0 flex-1',
          hit.type === 'interaction' ? 'text-content-muted' : 'text-content',
        )}
      >
        {hit.text}
        {amount && <span className="tabular ml-2 text-content-subtle">{amount}</span>}
      </span>
    </li>
  )
}
