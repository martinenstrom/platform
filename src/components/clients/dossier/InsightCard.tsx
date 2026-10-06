import { ArrowRight, Sparkles } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import { formatDayMonth, formatLongDate } from '~/presentation/advisory/format'
import { nextBestActionText, signalText } from '~/presentation/advisory/intelligenceText'
import { anchorFor } from './sections'

/**
 * Template 1 — the highlight insight. JARVIS's one recommendation for the
 * relationship, in the gold material, with the contour art at its right:
 * the mark, one conclusion in the display face, a short explanation, when
 * the action is due, and one door to the part of the dossier that explains
 * it. Everything said here is the read model's next best action; the card
 * ranks and words nothing of its own.
 */
export function InsightCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const action = view.nextBestAction
  const when = action
    ? action.dueDate
      ? `senast ${formatLongDate(action.dueDate)}`
      : view.nextMeeting
        ? `före mötet ${formatDayMonth(view.nextMeeting.occursOn)}`
        : 'vid nästa kontakt'
    : null
  const text = action ? signalText(action.signal) : null
  return (
    <section
      aria-label="JARVIS rekommenderar"
      className={cn('jarvis-gold flex min-w-0 flex-col px-6 pt-5 pb-5', className)}
    >
      <WaveArt />
      <div className="relative flex items-center justify-between gap-3">
        <span className="type-section flex items-center gap-2.5 text-[#e6c987]">
          <span className="dossier-icon h-7 w-7" aria-hidden="true">
            <Sparkles className="h-[13px] w-[13px]" strokeWidth={1.6} />
          </span>
          JARVIS insight
        </span>
        {action && (
          <span className="rounded-chip bg-institution px-1.5 py-[3px] text-[9.5px] font-semibold tracking-[0.14em] text-[#1a1305] uppercase">
            Brådska {action.urgency}/5
          </span>
        )}
      </div>

      {action && text ? (
        <>
          <p className="type-display-statement relative mt-4 max-w-[30rem] text-[22px] text-[#f6efdf]">
            {nextBestActionText(action)}
          </p>
          <p className="relative mt-3 max-w-[32rem] text-[12.5px] leading-[1.15rem] text-[#d9cdb0]">
            {text.signal} {text.why}
          </p>
          <p className="relative mt-1.5 text-[12.5px] leading-snug text-[#f6efdf]">
            Rekommenderad åtgärd {when}.
          </p>
        </>
      ) : (
        <p className="type-display-statement relative mt-4 max-w-[30rem] text-[22px] text-[#f6efdf]">
          Ingen åtgärd rekommenderas just nu. Relationen kräver ingenting av dig i dag.
        </p>
      )}

      <div className="relative mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
        {action && (
          <a
            href={anchorFor(action.signal.kind)}
            className="jarvis-ghost-btn dossier-cta"
          >
            Visa underlag
            <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
          </a>
        )}
        {action && <span className="type-machine text-[#a8987a]">{action.method}</span>}
      </div>
    </section>
  )
}

/**
 * Contour lines in the gold: an abstract field at the card's right, drawn
 * once and still. Decorative, hidden from assistive technology.
 */
function WaveArt() {
  const lines = [
    'M0 150 C 90 120, 150 200, 240 150 S 380 90, 460 140',
    'M0 170 C 90 140, 150 220, 240 170 S 380 110, 460 160',
    'M0 190 C 90 160, 150 240, 240 190 S 380 130, 460 180',
    'M0 130 C 90 100, 150 180, 240 130 S 380 70, 460 120',
    'M0 110 C 90 80, 150 160, 240 110 S 380 50, 460 100',
    'M0 90 C 90 60, 150 140, 240 90 S 380 30, 460 80',
    'M0 210 C 90 180, 150 260, 240 210 S 380 150, 460 200',
  ]
  return (
    <svg
      aria-hidden="true"
      className="dossier-wave"
      viewBox="0 0 460 260"
      preserveAspectRatio="xMaxYMid slice"
    >
      {lines.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="#e2b45a"
          strokeWidth={i === 3 ? 1.1 : 0.7}
          strokeOpacity={i === 3 ? 0.42 : 0.14 + (i % 3) * 0.06}
        />
      ))}
      {[
        [300, 118],
        [352, 104],
        [410, 132],
        [262, 158],
      ].map(([x, y]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={1.4}
          fill="#e2b45a"
          fillOpacity={0.55}
        />
      ))}
    </svg>
  )
}
