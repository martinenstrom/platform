import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Download, FileText, Presentation } from 'lucide-react'
import type { MeetingPack, MeetingPackDepth } from '~/application/advisory/meetingPack'
import type {
  GeneratedPackMeta,
  PackFormat,
} from '~/application/advisory/meetingPackVersions'
import { cn } from '~/lib/cn'
import { formatDaysFromToday, formatLongDate } from '~/presentation/advisory/format'
import { composePackDocument } from '~/presentation/documents/meetingPackDocument'
import {
  DEPTH_LABEL,
  FORMAT_LABEL,
  READINESS_LABEL,
  readinessReasonText,
  readinessSummary,
} from '~/presentation/documents/meetingPackText'
import { DocumentView } from './DocumentView'
import type { MeetingPackActions, RequestedFormat } from './meetingPackActions'

const FAILURE: Record<string, string> = {
  NOT_FOUND: 'Klienten kunde inte hittas.',
  BLOCKED:
    'Underlaget är blockerat: registret kan inte bära ett underlag utan att ge en missvisande bild.',
  AUDIENCE_NOT_ALLOWED: 'Endast det interna rådgivarunderlaget kan genereras.',
  NO_FORMAT: 'Välj ett format.',
  SERVICE_UNAVAILABLE: 'Genereringen kunde inte nås just nu.',
}

/**
 * Meeting Pack Preview — what the pack will say, whether it is ready, what
 * it contains, and the Executive Brief on screen; then the file. One
 * PackDocument drives the screen and every generated file, so what is read
 * here is what the senior gets.
 */
export function MeetingPackPreview({
  pack,
  versions: initialVersions,
  depth,
  requestedFormat,
  actions,
}: {
  pack: MeetingPack
  versions: readonly GeneratedPackMeta[]
  depth: MeetingPackDepth
  requestedFormat: RequestedFormat | null
  actions: MeetingPackActions
}) {
  const document = useMemo(() => composePackDocument(pack), [pack])
  /* The loader's list shows through until a generation on this page replaces it. */
  const [generatedVersions, setVersions] = useState<readonly GeneratedPackMeta[] | null>(
    null,
  )
  const versions = generatedVersions ?? initialVersions
  const [busy, setBusy] = useState<PackFormat[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const blocked = pack.readiness.state === 'BLOCKERAD'

  async function generate(formats: PackFormat[]) {
    setError(null)
    setNotice(null)
    setBusy(formats)
    const result = await actions.generate(depth, formats)
    setBusy(null)
    if (!result.ok) {
      setError(FAILURE[result.code] ?? 'Underlaget kunde inte genereras.')
      return
    }
    setVersions(result.versions)
    for (const file of result.files) {
      actions.save({
        fileName: file.meta.fileName,
        base64: file.base64,
        format: file.meta.format,
      })
    }
    const reused = result.files.filter((f) => f.reused)
    setNotice(
      reused.length === result.files.length
        ? `Registret är oförändrat sedan version ${reused[0]!.meta.version}; samma fil lämnades ut igen.`
        : `Version ${result.files.find((f) => !f.reused)!.meta.version} genererad: ${result.files
            .map((f) => f.meta.fileName)
            .join(', ')}.`,
    )
  }

  async function download(meta: GeneratedPackMeta) {
    setError(null)
    const result = await actions.download(meta.id)
    if (!result.ok) {
      setError(
        result.code === 'NOT_FOUND'
          ? 'Versionen finns inte längre i den här processen.'
          : FAILURE.SERVICE_UNAVAILABLE!,
      )
      return
    }
    actions.save({
      fileName: result.meta.fileName,
      base64: result.base64,
      format: result.meta.format,
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <header className="ref-panel inst-edge px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="type-section text-institution">
              Mötesunderlag · {document.internalMark}
            </p>
            <h1 className="type-display-name mt-1 text-[30px]">
              {pack.identity.clientName}
            </h1>
            <p className="type-inst-sub mt-1">
              {document.meetingLabel}
              {pack.meeting.daysAhead !== null &&
                ` · ${formatDaysFromToday(pack.meeting.daysAhead)}`}
              {' · '}data per {formatLongDate(pack.dataAsOf)}
            </p>
            <nav aria-label="Djup" className="mt-3 flex flex-wrap gap-1.5">
              {(['executive', 'full'] as const).map((d) => (
                <Link
                  key={d}
                  to="/clients/$clientId/meeting-pack"
                  params={{ clientId: pack.identity.clientId }}
                  search={{
                    depth: d,
                    ...(requestedFormat ? { format: requestedFormat } : {}),
                  }}
                  aria-current={d === depth ? 'page' : undefined}
                  className={cn(
                    'type-section rounded-[4px] border px-3 py-1.5 transition-colors',
                    d === depth
                      ? 'border-institution-line bg-institution-soft/60 text-institution'
                      : 'border-line text-content-muted hover:text-content',
                  )}
                >
                  {DEPTH_LABEL[d]}
                </Link>
              ))}
              <span className="type-machine self-center">
                {document.coreCount}{' '}
                {document.coreCount === 1 ? 'kärnbild' : 'kärnbilder'}
                {document.appendixCount > 0 && ` · ${document.appendixCount} bilagor`}
              </span>
            </nav>
          </div>

          <section aria-label="Status" className="min-w-0 lg:w-[42%]">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded-[3px] px-2 py-[3px] text-[10px] font-semibold tracking-[0.14em] uppercase',
                  pack.readiness.state === 'REDO' && 'bg-positive/15 text-positive',
                  pack.readiness.state === 'GRANSKA' && 'bg-[#e9c46a] text-[#1a1305]',
                  pack.readiness.state === 'BLOCKERAD' && 'bg-negative/20 text-negative',
                )}
              >
                {READINESS_LABEL[pack.readiness.state]}
              </span>
              <span className="type-inst-sub">{readinessSummary(pack.readiness)}</span>
            </div>
            {pack.readiness.reasons.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12.5px] leading-snug text-content">
                {pack.readiness.reasons.map((reason, index) => (
                  <li key={index} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full',
                        reason.severity === 'block' ? 'bg-negative' : 'bg-[#e9c46a]',
                      )}
                    />
                    {readinessReasonText(reason)}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                to="/clients/$clientId/meeting-prep"
                params={{ clientId: pack.identity.clientId }}
                className="jarvis-ghost-btn"
              >
                Granska underlag
              </Link>
              <button
                type="button"
                disabled={blocked || busy !== null}
                onClick={() => void generate(['pptx'])}
                className={cn(
                  requestedFormat === 'pptx' ? 'jarvis-gold-btn' : 'jarvis-ghost-btn',
                )}
              >
                <Presentation
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                  strokeWidth={1.8}
                />
                Generera PowerPoint
              </button>
              <button
                type="button"
                disabled={blocked || busy !== null}
                onClick={() => void generate(['pdf'])}
                className={cn(
                  requestedFormat === 'pdf' ? 'jarvis-gold-btn' : 'jarvis-ghost-btn',
                )}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.8} />
                Generera PDF
              </button>
              <button
                type="button"
                disabled={blocked || busy !== null}
                onClick={() => void generate(['pptx', 'pdf'])}
                className={cn(
                  requestedFormat === 'both' || requestedFormat === null
                    ? 'jarvis-gold-btn'
                    : 'jarvis-ghost-btn',
                )}
              >
                Generera båda
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
              </button>
            </div>
            {pack.readiness.state === 'GRANSKA' && !blocked && (
              <p className="type-machine mt-2 normal-case">
                Generera ändå: granskningspunkterna följer med i underlaget som varningar.
              </p>
            )}
            {busy && (
              <p role="status" className="type-machine mt-2 text-institution normal-case">
                Genererar {busy.map((f) => FORMAT_LABEL[f]).join(' och ')}…
              </p>
            )}
            {notice && (
              <p role="status" className="type-metadata mt-2 text-content">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="type-metadata mt-2 text-warning">
                {error}
              </p>
            )}
          </section>
        </div>
      </header>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(300px,30%)]">
        <article aria-label="Underlag på skärmen" className="min-w-0">
          <DocumentView document={document} />
        </article>

        <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-14 xl:self-start">
          <section aria-label="Innehåll" className="ref-panel">
            <header className="ref-head">
              <h2 className="type-section">Innehåll</h2>
              <span className="type-machine">{DEPTH_LABEL[depth]}</span>
            </header>
            <ol className="p-3 text-[12.5px] leading-snug">
              {document.slides.map((slide, index) => (
                <li key={slide.kind} className="flex gap-2 py-0.5">
                  <span className="tabular w-5 shrink-0 text-content-subtle">
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      'min-w-0',
                      slide.section === 'appendix'
                        ? 'text-content-muted'
                        : 'text-content',
                    )}
                  >
                    {slide.kicker}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="Genererade versioner" className="ref-panel">
            <header className="ref-head">
              <h2 className="type-section">Genererade versioner</h2>
              <span className="type-machine">{versions.length}</span>
            </header>
            {versions.length === 0 ? (
              <p className="type-inst-sub p-3">
                Inget genererat ännu i den här processen. Versioner är processlokala; en
                tidigare version skrivs aldrig över.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {versions.map((meta) => (
                  <li
                    key={meta.id}
                    className="flex items-center gap-3 px-3 py-2 text-[12.5px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-content" title={meta.fileName}>
                        <span className="type-section mr-1.5 text-institution">
                          v{meta.version}
                        </span>
                        {FORMAT_LABEL[meta.format]} · {meta.slideCount}{' '}
                        {meta.format === 'pptx' ? 'bilder' : 'avsnitt'}
                      </p>
                      <p className="type-machine normal-case">
                        genererad {meta.generatedAt.slice(11, 16)} · data per{' '}
                        {formatLongDate(meta.sourceAsOf)}
                        {meta.meetingDate &&
                          ` · möte ${formatLongDate(meta.meetingDate)}`}{' '}
                        · {Math.round(meta.byteLength / 1024)} kB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void download(meta)}
                      className="type-machine inline-flex items-center gap-1 rounded-[3px] border border-line px-2 py-1 text-content-muted transition-colors hover:text-content"
                      aria-label={`Ladda ner ${meta.fileName}`}
                    >
                      <Download className="h-3 w-3" aria-hidden="true" />
                      Ladda ner
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Underlagets härkomst" className="ref-panel">
            <header className="ref-head">
              <h2 className="type-section">Härkomst</h2>
            </header>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-3 text-[12px]">
              <Fact label="Data per" value={formatLongDate(pack.dataAsOf)} />
              <Fact
                label="Portfölj värderad"
                value={
                  pack.provenance.portfolioValuedAt
                    ? formatLongDate(pack.provenance.portfolioValuedAt)
                    : 'Saknas'
                }
              />
              <Fact
                label="Äldsta värdering"
                value={
                  pack.provenance.oldestValuationAt
                    ? formatLongDate(pack.provenance.oldestValuationAt)
                    : 'Saknas'
                }
              />
              <Fact
                label="Marknadsdata"
                value={
                  pack.provenance.marketDataAsOf
                    ? formatLongDate(pack.provenance.marketDataAsOf.slice(0, 10))
                    : 'Inga rörelser'
                }
              />
              <Fact
                label="Baslinje"
                value={
                  pack.provenance.baseline
                    ? formatLongDate(pack.provenance.baseline.meetingDate)
                    : 'Saknas'
                }
              />
              <Fact label="Källposter" value={String(pack.provenance.sourceCount)} />
            </dl>
            <p className="type-machine border-t border-line px-3 py-2">
              {pack.method} · {pack.readiness.method} · syntetiskt register · inget
              genererat av en modell
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="type-section text-[9px]">{label}</dt>
      <dd className="mt-0.5 truncate text-content">{value}</dd>
    </div>
  )
}
