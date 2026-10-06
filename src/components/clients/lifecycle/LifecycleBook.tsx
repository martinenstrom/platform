import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type {
  ClientDirectory,
  ClientDirectoryRow,
} from '~/application/advisory/clientDirectory'
import type { LifecycleStatus } from '~/domain/advisory'
import {
  advisorIdentityOf,
  WORKSPACE_ADVISOR_ID,
} from '~/presentation/advisory/advisorIdentity'
import { formatLongDate, formatMsek, yearOf } from '~/presentation/advisory/format'
import { CLOSURE_REASON_LABEL, SEGMENT_LABEL } from '~/presentation/advisory/text'
import { AdvisorPortrait } from '../AdvisorPortrait'
import { ClientPortrait } from '../ClientPortrait'
import { BookSwitch } from './BookSwitch'

const BOOK_TITLE: Record<Exclude<LifecycleStatus, 'active'>, string> = {
  onboarding: 'Onboarding',
  former: 'Tidigare klienter',
}

const BOOK_LINE: Record<Exclude<LifecycleStatus, 'active'>, string> = {
  onboarding:
    'Relationer som tas emot men ännu inte ingår i den aktiva boken — inget räknas in förrän de aktiveras.',
  former:
    'Relationer som avslutats. Dossier, tidslinje och underlag finns kvar; inget räknas in i de aktiva siffrorna.',
}

/**
 * A lifecycle book: the same cover and the same card material as the
 * active book, with the facts a book of this kind is read by. Onboarding:
 * who is coming in, since when, with what is known so far. Former: who
 * left, from which office, when and why — the dossier a door away.
 */
export function LifecycleBook({
  book,
  directory,
}: {
  book: Exclude<LifecycleStatus, 'active'>
  directory: ClientDirectory
}) {
  const advisor = advisorIdentityOf(WORKSPACE_ADVISOR_ID)
  const rows = [...directory.rows].sort((a, b) =>
    book === 'former'
      ? (b.lifecycle.closure?.effectiveDate ?? '').localeCompare(
          a.lifecycle.closure?.effectiveDate ?? '',
        )
      : b.lifecycle.since.localeCompare(a.lifecycle.since),
  )
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-5 px-1 pt-3 pb-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-6 lg:gap-9">
          <AdvisorPortrait identity={advisor} size="lg" />
          <div className="min-w-0">
            <p className="type-section text-institution">Client Intelligence</p>
            <h1 className="type-display-name mt-1.5 text-[54px] leading-none">
              {BOOK_TITLE[book]}
            </h1>
            <p className="mt-2 max-w-[24rem] font-display text-[15px] leading-snug text-content-muted">
              {BOOK_LINE[book]}
            </p>
            <p className="mt-3.5 font-display text-[15px] font-semibold leading-tight text-content">
              {advisor.fullName}
              <span className="mt-0.5 block text-[13px] font-normal text-content-muted">
                {advisor.roleTitle}
              </span>
            </p>
          </div>
        </div>
        <BookSwitch current={book} />
      </header>

      <section aria-label={BOOK_TITLE[book]} className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="type-section">{BOOK_TITLE[book]}</h2>
          <span className="type-machine">
            {rows.length} {rows.length === 1 ? 'relation' : 'relationer'}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="ref-panel type-inst-sub px-5 py-8 text-center">
            {book === 'onboarding'
              ? 'Ingen relation under onboarding.'
              : 'Inga tidigare klienter.'}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <li key={row.id} className="min-w-0">
                {book === 'former' ? (
                  <FormerCard row={row} />
                ) : (
                  <OnboardingCard row={row} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function CardFrame({
  row,
  children,
}: {
  row: ClientDirectoryRow
  children: React.ReactNode
}) {
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId: row.id }}
      className="client-card relative flex h-full flex-col gap-3 px-4 pt-3.5 pb-3 outline-offset-0"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <ClientPortrait clientId={row.id} displayName={row.displayName} size="sm" />
          <span className="min-w-0">
            <span
              className="block truncate font-display text-[20px] leading-tight font-medium tracking-[-0.005em] text-content"
              style={{ viewTransitionName: `client-${row.id}` }}
            >
              {row.displayName}
            </span>
            <span className="type-inst-sub block truncate">
              {SEGMENT_LABEL[row.segment]} · {row.officeName}
            </span>
          </span>
        </span>
        <span className="dossier-chevron" aria-hidden="true">
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
      </div>
      {children}
    </Link>
  )
}

function FormerCard({ row }: { row: ClientDirectoryRow }) {
  const closure = row.lifecycle.closure
  return (
    <CardFrame row={row}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3">
        <div>
          <dt className="type-section">PB-relation</dt>
          <dd className="mt-0.5 text-[13px] text-content">
            {yearOf(row.relationshipSince)}–{closure ? yearOf(closure.effectiveDate) : ''}
          </dd>
        </div>
        <div>
          <dt className="type-section">Relation avslutad</dt>
          <dd className="mt-0.5 text-[13px] text-content">
            {closure ? formatLongDate(closure.effectiveDate) : '—'}
          </dd>
        </div>
        <div>
          <dt className="type-section">Tidigare rådgivare</dt>
          <dd className="mt-0.5 text-[13px] text-content">{row.advisorName}</dd>
        </div>
        <div>
          <dt className="type-section">Orsak</dt>
          <dd className="mt-0.5 text-[13px] text-content">
            {closure ? CLOSURE_REASON_LABEL[closure.reason] : '—'}
          </dd>
        </div>
      </dl>
    </CardFrame>
  )
}

function OnboardingCard({ row }: { row: ClientDirectoryRow }) {
  return (
    <CardFrame row={row}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3">
        <div>
          <dt className="type-section">PB-start</dt>
          <dd className="mt-0.5 text-[13px] text-content">
            {formatLongDate(row.relationshipSince)}
          </dd>
        </div>
        <div>
          <dt className="type-section">Rådgivare</dt>
          <dd className="mt-0.5 text-[13px] text-content">{row.advisorName}</dd>
        </div>
        <div>
          <dt className="type-section">AUM</dt>
          <dd className="mt-0.5 text-[13px] text-content">
            {row.aum > 0 ? (
              formatMsek(row.aum)
            ) : (
              <span className="type-inst-sub">Data saknas</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="type-section">Total förmögenhet</dt>
          <dd className="mt-0.5 text-[13px] text-content">
            {row.estimatedWealth > 0 ? (
              formatMsek(row.estimatedWealth)
            ) : (
              <span className="type-inst-sub">Data saknas</span>
            )}
          </dd>
        </div>
      </dl>
    </CardFrame>
  )
}
