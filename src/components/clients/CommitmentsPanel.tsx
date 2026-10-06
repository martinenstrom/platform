import { useState } from 'react'
import { Handshake } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import type { Commitment } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatDaysFromToday, formatLongDate } from '~/presentation/advisory/format'
import { COMMITMENT_PRIORITY_LABEL } from '~/presentation/advisory/text'
import { Empty, Module } from './dossier/Module'

/**
 * Promises. The product principle: the advisor never forgets something
 * promised to a client. Open commitments come first, overdue ones cannot be
 * missed, each says which note it came from, and one press closes it. This
 * is the one place on the dossier a promise is closed; the priorities open
 * a door here rather than offering a second button.
 */
export function CommitmentsPanel({
  view,
  onComplete,
  className,
}: {
  view: Client360
  onComplete: (commitmentId: string) => Promise<void>
  className?: string
}) {
  const closed = view.commitments.filter((c) => c.status !== 'open')
  const overdue = view.openCommitments.filter((c) => c.overdue).length
  return (
    <Module
      id="ataganden"
      title="Åtaganden"
      icon={Handshake}
      meta={
        overdue > 0
          ? `${overdue} försenade · ${view.openCommitments.length} öppna`
          : `${view.openCommitments.length} öppna`
      }
      className={className}
    >
      {view.openCommitments.length === 0 ? (
        <Empty>Inga öppna åtaganden. Allt som lovats är levererat.</Empty>
      ) : (
        <ul className="flex flex-col">
          {view.openCommitments.map((commitment) => (
            <CommitmentRow
              key={commitment.id}
              commitment={commitment}
              onComplete={onComplete}
            />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="mt-3 border-t border-hairline pt-3">
          <summary className="dossier-link list-none">{closed.length} avslutade</summary>
          <ul className="mt-2 space-y-1">
            {closed.map((c) => (
              <li
                key={c.id}
                className="flex items-baseline justify-between gap-3 text-[12px] text-content-subtle"
              >
                <span className="line-through decoration-content-subtle/60">
                  {c.title}
                </span>
                <span className="type-machine">
                  {c.completedAt ? `klart ${formatLongDate(c.completedAt)}` : 'avbrutet'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Module>
  )
}

function CommitmentRow({
  commitment,
  onComplete,
}: {
  commitment: Client360['openCommitments'][number]
  onComplete: (commitmentId: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <li className="dossier-row flex items-start gap-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full',
          commitment.overdue ? 'bg-negative' : 'bg-info',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-content">{commitment.title}</p>
        <p className="type-machine mt-0.5 normal-case">
          {commitment.dueDate ? (
            <span className={cn(commitment.overdue && 'text-negative')}>
              {commitment.overdue ? 'Försenat · ' : 'Senast '}
              {formatLongDate(commitment.dueDate)}
              {commitment.daysToDue !== null &&
                ` (${formatDaysFromToday(commitment.daysToDue)})`}
            </span>
          ) : (
            'Inget datum'
          )}
          {' · '}
          {COMMITMENT_PRIORITY_LABEL[commitment.priority].toLowerCase()} prioritet · lovat{' '}
          {formatLongDate(commitment.createdAt)}
        </p>
        <SourceLine commitment={commitment} />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onComplete(commitment.id)
          } finally {
            setBusy(false)
          }
        }}
        aria-label={`Markera "${commitment.title}" som klart`}
        className="dossier-link shrink-0 rounded-chip border border-hairline-strong px-2.5 py-1.5 transition-colors hover:border-panel-edge disabled:opacity-40"
      >
        Klart
      </button>
    </li>
  )
}

function SourceLine({ commitment }: { commitment: Commitment }) {
  const { provenance } = commitment
  if (!provenance.sourceText) return null
  return (
    <details className="mt-0.5">
      <summary className="type-machine cursor-pointer list-none text-content-subtle hover:text-content">
        <span className="underline decoration-dotted underline-offset-2">
          Ur noteringen {formatLongDate(provenance.sourceDate)}
        </span>
      </summary>
      <blockquote className="mt-1 border-l border-hairline-strong pl-2 text-[11.5px] italic leading-snug text-content-muted">
        ”{provenance.sourceText}”
      </blockquote>
    </details>
  )
}
