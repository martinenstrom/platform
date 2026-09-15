/**
 * The firm's deeper surfaces, opened beside the conversation.
 *
 * "Visa hur ni kom fram till det" opens the Boardroom; "Visa underlaget"
 * opens the record. Both are the canonical pages — `CaseOverviewPage` and
 * `CaseRecord`, the same modules the routes `/cases/$caseId` and
 * `/cases/$caseId/underlag` render — given a place to stand next to JARVIS
 * instead of a document of their own. The ruling for slice F: no second
 * Boardroom, no second Underlag, the routes stay valid, and closing returns
 * the person to exactly the HQ they were in.
 *
 * ## Over the page, not instead of it
 *
 * The surface is positioned over the routed page, to the right of the
 * engaged presence. The page beneath stays mounted and untouched, so closing
 * is a matter of unmounting this and nothing else — the same HQ context by
 * construction, not by navigation. The conversation lives in the presence
 * store and is not here at all.
 *
 * ## The same read model, read again
 *
 * Opening asks the firm for the case through `getCaseOverviewFn`, exactly as
 * the route loaders do. Nothing is copied from the conversation into the
 * surface; the reference is a pointer and the truth is re-read.
 *
 * ## Its own door out
 *
 * The header carries the canonical link, so a person who wants the page as a
 * page — a URL to send, a tab to keep — has it one click away.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, X } from 'lucide-react'
import { CaseOverviewPage } from '~/components/boardroom/CaseOverviewPage'
import { CaseRecord } from '~/components/headquarters/CaseRecord'
import { getCaseOverviewFn, resumeConveningFn } from '~/infrastructure/analysis/serverFns'
import type { CaseOverviewResponse } from '~/infrastructure/analysis/serverFns'
import type { DomainReference } from '~/application/analysis/domainSystem'
import type { ContextualSurface as SurfaceKind } from './presenceStore'

/** What each surface is called, to the person and to assistive technology. */
export const SURFACE_TEXT: Record<
  SurfaceKind,
  { title: string; close: string; open: string; route: '/cases/$caseId' | '/cases/$caseId/underlag' }
> = {
  boardroom: {
    title: 'Styrelserummet',
    close: 'Stäng styrelserummet',
    open: 'Visa hur ni kom fram till det',
    route: '/cases/$caseId',
  },
  underlag: {
    title: 'Underlaget',
    close: 'Stäng underlaget',
    open: 'Visa underlaget',
    route: '/cases/$caseId/underlag',
  },
}

export function ContextualSurface({
  kind,
  reference,
  subject,
  question,
  onClose,
}: {
  kind: SurfaceKind
  reference: DomainReference
  subject: string | null
  question: string | null
  onClose: () => void
}) {
  const [response, setResponse] = useState<CaseOverviewResponse | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const text = SURFACE_TEXT[kind]

  /* The firm, asked again. Re-asked when the case or the surface changes. */
  const caseId = reference.id
  useEffect(() => {
    let cancelled = false
    setResponse(null)
    getCaseOverviewFn({ data: caseId })
      .then((result) => {
        if (!cancelled) setResponse(result)
      })
      .catch(() => {
        /* The same sentence the route would show when the analysis environment cannot be reached. */
        if (!cancelled) setResponse({ ok: false, code: 'SERVICE_UNAVAILABLE' })
      })
    return () => {
      cancelled = true
    }
  }, [caseId, kind])

  /* Land the person on the way out, so Escape and a screen reader both know where they are. */
  useEffect(() => {
    closeRef.current?.focus()
  }, [kind])

  /* Escape closes the surface and only the surface; the presence keeps its own Escape. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  async function resumeConvening(id: string, actingEmployeeId: string) {
    await resumeConveningFn({ data: { caseId: id, actingEmployeeId } })
    setResponse(await getCaseOverviewFn({ data: id }))
  }

  return (
    <section
      role="region"
      aria-label={text.title}
      onKeyDown={onKeyDown}
      className="fixed inset-y-0 right-0 left-[306px] z-[35] flex flex-col border-l border-line bg-canvas"
    >
      <header className="flex items-center gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="type-section">{text.title}</p>
          <p className="type-metadata truncate">
            {subject ?? 'Ärende'}
            {question ? ` · ${question}` : ''}
          </p>
        </div>
        <Link
          to={text.route}
          params={{ caseId: reference.id }}
          className="brd-console-link inline-flex items-center gap-1"
        >
          Öppna som sida
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={text.close}
          title={text.close}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-content-subtle hover:bg-surface-2 hover:text-content"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 lg:p-2.5">
        {response === null ? (
          <p className="type-metadata" aria-live="polite">
            Hämtar ärendet…
          </p>
        ) : kind === 'boardroom' ? (
          <CaseOverviewPage response={response} onResumeConvening={resumeConvening} />
        ) : (
          <CaseRecord response={response} />
        )}
      </div>
    </section>
  )
}
