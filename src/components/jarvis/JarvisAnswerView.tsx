import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type { JarvisAnswer } from '~/application/jarvis/answer'
import { cn } from '~/lib/cn'
import {
  answerHeadline,
  itemText,
  NATURE_LABEL,
  SECTION_TITLE,
  sourceText,
} from '~/presentation/jarvis/advisoryAnswerText'

const ACTION_LABEL = {
  'open-client': 'Öppna klient',
  'open-meeting-prep': 'Förbered möte',
  'open-meeting-pack': 'Öppna mötesunderlag',
  'open-office': 'Öppna kontor',
  'open-sentinel': 'Öppna Sentinel',
  'open-book': 'Öppna boken',
  'open-market-impact': 'Öppna Marknadspåverkan',
  'open-today': 'Öppna Idag',
  'prepare-call': 'Förbered samtal',
} as const

/**
 * A structured answer from the record, rendered as the sections it came
 * in: a headline, the subject when it is not the screen's, each section
 * with its items and their nature, the doors it offers, and the evidence
 * on request — VARFÖR SÄGER JARVIS DETTA? — never a chain of thought.
 */
export function JarvisAnswerView({ answer }: { answer: JarvisAnswer }) {
  const { about } = answer
  /* The switched subject's door stands with its name; the same door is not listed twice. */
  const actions = answer.actions.filter(
    (action) => !(about.switched && action.kind === 'open-client'),
  )
  return (
    <div className="flex flex-col gap-2" data-intent={answer.intent}>
      {about.switched && about.href && (
        <p className="type-machine flex flex-wrap items-center gap-x-2 text-institution normal-case">
          Svarar om: <span className="text-content">{about.label}</span>
          <Link
            to={about.href}
            className="inline-flex items-center gap-1 hover:text-content"
          >
            Öppna klient
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </p>
      )}
      <p className="font-display text-[15px] leading-snug font-medium text-content">
        {answerHeadline(answer)}
      </p>
      {answer.sections.map((section) => (
        <section key={section.key} aria-label={SECTION_TITLE[section.key]}>
          <h3 className="type-section text-[9.5px]">{SECTION_TITLE[section.key]}</h3>
          <ul className="mt-0.5 space-y-1">
            {section.items.map((item, index) => {
              const t = itemText(item, answer.titles, answer.today)
              return (
                <li key={`${item.kind}-${index}`} className="text-[12.5px] leading-snug">
                  <span className="text-content">
                    {item.nature !== 'fact' && (
                      <span
                        className={cn(
                          'type-machine mr-1.5 normal-case',
                          item.nature === 'assessment'
                            ? 'text-accent'
                            : 'text-institution',
                        )}
                      >
                        {NATURE_LABEL[item.nature]}
                      </span>
                    )}
                    {t.text}
                  </span>
                  {t.detail && (
                    <span className="block text-[11.5px] text-content-muted">
                      {t.detail}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {actions.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          {actions.map((action) => (
            <Link
              key={action.kind}
              to={action.href}
              className="type-section inline-flex items-center gap-1 text-institution hover:text-content"
            >
              {ACTION_LABEL[action.kind]}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          ))}
        </p>
      )}
      <details className="text-[11.5px]">
        <summary className="type-machine cursor-pointer list-none text-content-subtle hover:text-content">
          <span className="underline decoration-dotted underline-offset-2">
            Varför säger JARVIS detta? · {answer.sources.length} underlag
          </span>
        </summary>
        {answer.sources.length === 0 ? (
          <p className="mt-1 text-content-muted">
            Svaret vilar på det som saknas i registret, inte på en post.
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5 border-l border-line pl-2 text-content-muted">
            {answer.sources.map((source) => (
              <li key={source.id}>{sourceText(source)}</li>
            ))}
          </ul>
        )}
        <p className="type-machine mt-1">
          metod {answer.method} · derivat per {answer.today} · svar ur strukturerat
          underlag, inte genererad text
        </p>
      </details>
    </div>
  )
}
