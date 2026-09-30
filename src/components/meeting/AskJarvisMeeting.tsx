import { useState } from 'react'
import type { AskBeforeMeetingResult } from '~/application/advisory/meetingCockpit'
import type { MemoryHit } from '~/domain/advisory'
import { JarvisMark } from '~/components/clients/JarvisBlock'
import type { Unavailable } from '~/components/clients/clientActions'
import { formatLongDate } from '~/presentation/advisory/format'
import {
  agendaLabel,
  changeText,
  clientQuestionText,
  focusHeadline,
  marketHeadline,
  marketRelevanceLines,
  PROMISE_BUCKET_LABEL,
} from '~/presentation/advisory/meetingCockpitText'
import {
  CONTEXT_LABEL,
  EVENT_LABEL,
  INTERACTION_LABEL,
  MEMORY_ANSWER_HEADING,
} from '~/presentation/advisory/text'
import type { MeetingActions } from './meetingActions'

const SUGGESTIONS = [
  'Vad har förändrats sedan senaste mötet?',
  'Vad har jag inte gjort?',
  'Vilka marknadsrörelser bör jag kunna förklara?',
  'Varför står finansieringen på agendan?',
  'Vad sa klienten om energi senast?',
] as const

/**
 * Ask JARVIS before the meeting — the same typed cockpit answers what
 * changed, what is owed, what the market did and why something is on the
 * agenda; what the client once said comes from the relationship memory.
 * Not a chat window: a question, and the records that answer it, with the
 * method named so a rule never passes as a model.
 */
export function AskJarvisMeeting({
  actions,
  titles,
}: {
  actions: MeetingActions
  titles: Readonly<Record<string, string>>
}) {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [result, setResult] = useState<AskBeforeMeetingResult | Unavailable | null>(null)
  const [busy, setBusy] = useState(false)

  async function ask(text: string) {
    const q = text.trim()
    if (!q) return
    setBusy(true)
    setAsked(q)
    try {
      setResult(await actions.askBeforeMeeting(q))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ref-panel" aria-label="Fråga JARVIS inför mötet">
      <header className="ref-head">
        <h2 className="type-section">Fråga JARVIS inför mötet</h2>
        <span className="type-machine">cockpit · regler v1 · relationsminne</span>
      </header>
      <div className="p-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void ask(question)
          }}
        >
          <label htmlFor="ask-jarvis-meeting" className="sr-only">
            Fråga inför mötet
          </label>
          <input
            id="ask-jarvis-meeting"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Vad har förändrats? Vad har jag inte gjort? Vad bör jag kunna förklara?"
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
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(s)
                  void ask(s)
                }}
                className="rounded-[3px] border border-line px-2 py-0.5 text-[11.5px] text-content-muted transition-colors hover:border-line-strong hover:text-content"
              >
                {s}
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
                JARVIS läser mötesunderlaget…
              </p>
            ) : result && result.ok ? (
              <Answer result={result} titles={titles} />
            ) : (
              <p className="type-metadata mt-2 text-warning" role="alert">
                {result?.ok === false && result.code === 'EMPTY_QUESTION'
                  ? 'Ställ en fråga.'
                  : 'Mötesunderlaget kunde inte nås just nu.'}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function Answer({
  result,
  titles,
}: {
  result: Extract<AskBeforeMeetingResult, { ok: true }>
  titles: Readonly<Record<string, string>>
}) {
  const { answer } = result
  const footer = (
    <p className="type-machine mt-2">
      metod {result.method} · svar ur strukturerat underlag, inte genererad text
    </p>
  )
  switch (answer.kind) {
    case 'changes':
      return (
        <div className="mt-2">
          <h3 className="type-inst">Sedan senaste mötet</h3>
          {answer.changes.changes.length === 0 && answer.market.length === 0 ? (
            <p className="type-inst-sub mt-1">
              Få väsentliga förändringar sedan senaste mötet.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-[12.5px]">
              {answer.changes.changes.map((c, i) => {
                const t = changeText(c, titles)
                return (
                  <li key={`${c.kind}-${i}`}>
                    <span className="type-machine mr-1.5 text-content">{t.label}</span>
                    <span className="text-content-muted">{t.value}</span>
                  </li>
                )
              })}
              {answer.market.map((m) => (
                <li key={m.item.impact.id}>
                  <span className="type-machine mr-1.5 text-content">Marknad</span>
                  <span className="text-content-muted">{marketHeadline(m)}</span>
                </li>
              ))}
            </ul>
          )}
          {footer}
        </div>
      )
    case 'promises':
      return (
        <div className="mt-2">
          <h3 className="type-inst">Du lovade</h3>
          {answer.promises.length === 0 ? (
            <p className="type-inst-sub mt-1">Inga åtaganden är registrerade.</p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-[12.5px]">
              {answer.promises.map((p) => (
                <li key={p.commitment.id}>
                  <span className="type-machine mr-1.5 text-content">
                    {PROMISE_BUCKET_LABEL[p.bucket]}
                  </span>
                  <span className="text-content-muted">
                    {p.commitment.title}
                    {p.commitment.dueDate
                      ? ` · senast ${formatLongDate(p.commitment.dueDate)}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {footer}
        </div>
      )
    case 'market':
      return (
        <div className="mt-2">
          <h3 className="type-inst">Marknad sedan senaste mötet</h3>
          {answer.market.length === 0 ? (
            <p className="type-inst-sub mt-1">
              Inga klientrelevanta marknadsrörelser i fönstret.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-[12.5px]">
              {answer.market.map((m) => {
                const lines = marketRelevanceLines(m)
                return (
                  <li key={m.item.impact.id}>
                    <span className="text-content">{marketHeadline(m)}</span>
                    <span className="type-machine ml-1.5">
                      fin. {lines.financial.toLowerCase()} · samtal{' '}
                      {lines.conversation.toLowerCase()}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {footer}
        </div>
      )
    case 'agenda':
      return (
        <div className="mt-2">
          <h3 className="type-inst">Mötets huvudfokus</h3>
          <p className="mt-1 text-[12.5px] text-content">{focusHeadline(answer.focus)}</p>
          <ol className="mt-1.5 space-y-0.5 text-[12.5px] text-content-muted">
            {answer.agenda.map((a, i) => (
              <li key={a.id}>
                <span className="type-machine mr-1.5">{i + 1}</span>
                {agendaLabel(a)}
              </li>
            ))}
          </ol>
          {footer}
        </div>
      )
    case 'memory':
      return (
        <div className="mt-2">
          <h3 className="type-inst">
            {MEMORY_ANSWER_HEADING[answer.answer.kind]}
            {answer.answer.topic && (
              <span className="type-inst-sub ml-1.5">· {answer.answer.topic}</span>
            )}
          </h3>
          {answer.answer.hits.length === 0 ? (
            <p className="type-inst-sub mt-1">
              Inget i relationsminnet svarar på frågan.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {answer.answer.hits.map((hit) => (
                <MemoryRow key={`${hit.type}-${hit.id}`} hit={hit} />
              ))}
            </ul>
          )}
          <p className="type-machine mt-2">
            {answer.answer.hits.length} träffar · metod {answer.answer.method} · svar ur
            strukturerat minne, inte genererad text
          </p>
        </div>
      )
  }
}

function MemoryRow({ hit }: { hit: MemoryHit }) {
  const kind =
    hit.type === 'interaction'
      ? INTERACTION_LABEL[hit.interactionType]
      : hit.type === 'context'
        ? CONTEXT_LABEL[hit.category]
        : hit.type === 'event'
          ? EVENT_LABEL[hit.eventType]
          : hit.type === 'commitment'
            ? 'Åtagande'
            : hit.type === 'goal'
              ? 'Mål'
              : hit.type === 'holding'
                ? 'Innehav'
                : 'Lån'
  return (
    <li className="flex items-start gap-3 text-[12.5px] leading-snug">
      <span className="type-machine w-[5.5rem] shrink-0 text-content">
        {hit.date ? formatLongDate(hit.date) : '—'}
      </span>
      <span className="type-machine w-[7rem] shrink-0 truncate">{kind}</span>
      <span className="min-w-0 flex-1 text-content-muted">{hit.text}</span>
    </li>
  )
}

/** Exported for the section that lists the possible client questions beside the ask panel. */
export { clientQuestionText }
