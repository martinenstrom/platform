import { useState } from 'react'
import type { Client360 } from '~/application/advisory/client360'
import type { Commitment } from '~/domain/advisory'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatDaysFromToday, formatLongDate } from '~/presentation/advisory/format'
import { COMMITMENT_PRIORITY_LABEL } from '~/presentation/advisory/text'

/**
 * Promises. The product principle: the advisor never forgets something
 * promised to a client. Open commitments come first, overdue ones cannot be
 * missed, each says which note it came from, and one press closes it.
 */
export function CommitmentsPanel({
  view,
  onComplete,
}: {
  view: Client360
  onComplete: (commitmentId: string) => Promise<void>
}) {
  const closed = view.commitments.filter((c) => c.status !== 'open')
  const overdue = view.openCommitments.filter((c) => c.overdue).length
  return (
    <Panel
      title="Löften och öppna åtaganden"
      meta={
        overdue > 0
          ? `${overdue} försenade · ${view.openCommitments.length} öppna`
          : `${view.openCommitments.length} öppna`
      }
      bodyClassName="p-3"
    >
      {view.openCommitments.length === 0 ? (
        <p className="type-inst-sub">
          Inga öppna åtaganden. Allt som lovats är levererat.
        </p>
      ) : (
        <ul className="space-y-1.5">
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
        <details className="mt-3">
          <summary className="type-machine cursor-pointer list-none hover:text-content">
            <span className="underline decoration-dotted underline-offset-2">
              {closed.length} avslutade
            </span>
          </summary>
          <ul className="mt-1.5 space-y-1">
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
    </Panel>
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
    <li
      className={cn(
        'ref-module flex items-start gap-3 px-2.5 py-2',
        commitment.overdue && 'shadow-[inset_2px_0_0_0_var(--color-negative)]',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="type-inst">{commitment.title}</p>
        <p className="type-machine mt-0.5">
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
        className="type-section shrink-0 rounded-[3px] border border-line px-2 py-1 text-content-muted transition-colors hover:border-institution-line hover:text-institution disabled:opacity-40"
      >
        Markera klart
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
      <blockquote className="mt-1 border-l border-line pl-2 text-[11.5px] italic leading-snug text-content-muted">
        ”{provenance.sourceText}”
      </blockquote>
    </details>
  )
}
