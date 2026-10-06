import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import { CALLOUT_LABEL, NOTE_KIND_LABEL } from '~/presentation/documents/meetingPackText'
import type {
  PackBlock,
  PackDocument,
  PackSlide,
  Tone,
} from '~/presentation/documents/packDocument'

/**
 * The document on screen: the same PackDocument the PowerPoint and the PDF
 * are drawn from, rendered as pages. The Executive Brief is read here
 * before anything is generated; the full pack is read here too, its
 * appendix folded. Nothing is computed on this surface.
 */
export function DocumentView({ document: doc }: { document: PackDocument }) {
  const core = doc.slides.filter((s) => s.section === 'core')
  const appendix = doc.slides.filter((s) => s.section === 'appendix')
  return (
    <div className="flex flex-col gap-2">
      {core.map((slide, index) => (
        <SlideView
          key={slide.kind}
          slide={slide}
          number={index + 1}
          total={doc.slides.length}
          doc={doc}
        />
      ))}
      {appendix.length > 0 && (
        <details className="ref-panel">
          <summary className="ref-head cursor-pointer list-none">
            <span className="type-section">Bilagor · {appendix.length}</span>
            <span className="type-machine">fälls ut · ingår i de genererade filerna</span>
          </summary>
          <div className="flex flex-col gap-2 p-2">
            {appendix.map((slide, index) => (
              <SlideView
                key={slide.kind}
                slide={slide}
                number={core.length + index + 1}
                total={doc.slides.length}
                doc={doc}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function SlideView({
  slide,
  number,
  total,
  doc,
}: {
  slide: PackSlide
  number: number
  total: number
  doc: PackDocument
}) {
  return (
    <section
      aria-label={slide.headline}
      className="ref-panel px-4 py-3"
      data-slide={slide.kind}
      data-archetype={slide.archetype}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className={cn(
            'type-section',
            slide.section === 'appendix' ? 'text-content-subtle' : 'text-institution',
          )}
        >
          {slide.kicker}
        </p>
        <p className="type-machine">
          {doc.internalMark} · {number} / {total}
        </p>
      </div>
      <h2 className="type-display-statement mt-1.5 text-[18px] text-content">
        {slide.headline}
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {slide.blocks.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
      </div>
      {slide.notes.length > 0 && (
        <details className="mt-3 text-[11.5px]">
          <summary className="type-machine cursor-pointer list-none text-content-subtle hover:text-content">
            <span className="underline decoration-dotted underline-offset-2">
              Talepunkter · internt · {slide.notes.length}
            </span>
          </summary>
          <ul className="mt-1 space-y-0.5 border-l border-line pl-2 text-content-muted">
            {slide.notes.map((note, index) => (
              <li key={index}>
                <span className="type-machine mr-1.5 text-content-subtle">
                  {NOTE_KIND_LABEL[note.kind]}
                </span>
                {note.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="type-machine mt-3 border-t border-line pt-2">
        {doc.confidentiality} · {doc.client} · {doc.meetingLabel} · data per{' '}
        {formatLongDate(doc.dataAsOf)}
      </p>
    </section>
  )
}

const MARKER_LABEL = {
  fact: 'Fakta',
  assessment: 'Bedömning',
  suggestion: 'Förslag',
} as const

const TONE_CLASS: Record<Tone, string> = {
  gold: 'text-institution',
  neutral: 'text-content',
  warning: 'text-negative',
  positive: 'text-positive',
  negative: 'text-negative',
}

const CALLOUT_CLASS = {
  observation: 'border-institution text-institution',
  implication: 'border-institution text-institution',
  'why-it-matters': 'border-line text-content-muted',
  'watch-out': 'border-negative text-negative',
  verify: 'border-line text-content-muted',
} as const

function BlockView({ block }: { block: PackBlock }) {
  switch (block.kind) {
    case 'kpis':
      return (
        <dl
          className={cn(
            'grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6',
            block.lead &&
              'rounded-module border border-line bg-surface-2 px-3 py-2 lg:grid-cols-4',
          )}
        >
          {block.items.map((item) => (
            <div
              key={item.label}
              className="min-w-0 border-l border-line pl-2 first:border-l-0 first:pl-0"
            >
              <dt className="type-section text-[9px]">{item.label}</dt>
              <dd
                className={cn(
                  'type-display-figure-sm mt-0.5 text-[16px] leading-tight break-words',
                  item.tone ? TONE_CLASS[item.tone] : 'text-content',
                )}
              >
                {item.value}
              </dd>
              {item.detail && <dd className="type-machine normal-case">{item.detail}</dd>}
            </div>
          ))}
        </dl>
      )
    case 'statement':
      return (
        <div className="jarvis-gold-soft border-l-2 border-institution px-3 py-2">
          {block.label && <p className="type-section text-institution">{block.label}</p>}
          <p className="type-display-statement mt-1 text-[15px] text-content">
            {block.text}
          </p>
          {block.addendum && (
            <>
              <p className="type-section mt-2 text-content-muted">
                {block.addendum.label}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-content">
                {block.addendum.text}
              </p>
            </>
          )}
        </div>
      )
    case 'caption':
      return <p className="type-machine normal-case text-content-muted">{block.text}</p>
    case 'list': {
      const Tag = block.numbered ? 'ol' : 'ul'
      return (
        <div>
          {block.title && <p className="type-section text-[9.5px]">{block.title}</p>}
          <Tag
            className={cn(
              'mt-1 space-y-1 pl-4 text-[12.5px] leading-snug',
              block.numbered ? 'list-decimal' : 'list-disc',
            )}
          >
            {block.items.map((item, index) => (
              <li key={index}>
                {item.marker && item.marker !== 'fact' && (
                  <span
                    className={cn(
                      'type-machine mr-1.5 normal-case',
                      item.marker === 'assessment' ? 'text-accent' : 'text-institution',
                    )}
                  >
                    {MARKER_LABEL[item.marker]}
                  </span>
                )}
                <span className="text-content">{item.text}</span>
                {item.detail && (
                  <span className="block text-[11.5px] text-content-muted">
                    {item.detail}
                  </span>
                )}
              </li>
            ))}
          </Tag>
        </div>
      )
    }
    case 'table':
      return (
        <Table
          title={block.title}
          columns={block.columns}
          rows={block.rows}
          align={block.align}
          emphasis={block.emphasis}
          totals={block.totals}
          tones={block.rowTones}
          toneColumn={block.toneColumn}
          footnote={block.footnote}
        />
      )
    case 'chart':
      return <ChartView block={block} />
    case 'timeline':
      return <TimelineView block={block} />
    case 'callout':
      return (
        <div
          className={cn(
            'rounded-module border px-3 py-2',
            block.tone === 'gold'
              ? 'border-institution-line jarvis-gold-soft'
              : block.tone === 'warning'
                ? 'border-negative/40 bg-negative/10'
                : 'border-line bg-surface-2',
          )}
        >
          <p
            className={cn(
              'type-section',
              block.tone === 'gold' ? 'text-institution' : 'text-content-muted',
            )}
          >
            {block.title}
          </p>
          <p
            className={cn(
              'mt-1 text-content',
              block.compact
                ? 'text-[12.5px] leading-snug'
                : 'type-display-statement text-[14px]',
            )}
          >
            {block.text}
          </p>
          {block.detail && (
            <p className="mt-1 text-[12px] leading-snug text-content-muted">
              {block.detail}
            </p>
          )}
        </div>
      )
    case 'callouts':
      return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {block.items.map((item, index) => (
            <aside
              key={index}
              className={cn('border-l-2 pl-2', CALLOUT_CLASS[item.kind])}
              aria-label={CALLOUT_LABEL[item.kind]}
            >
              <p className="type-section text-[9px]">{CALLOUT_LABEL[item.kind]}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-content">{item.text}</p>
              {item.detail && (
                <p className="mt-0.5 text-[11px] leading-snug text-content-muted">
                  {item.detail}
                </p>
              )}
            </aside>
          ))}
        </div>
      )
    case 'meta':
      return (
        <p className="type-machine flex flex-wrap gap-x-3 gap-y-0.5 normal-case">
          {block.items.map((item) => (
            <span key={item.label}>
              <span className="text-content-subtle uppercase">{item.label}</span>{' '}
              <span className="text-content">{item.value}</span>
            </span>
          ))}
        </p>
      )
    case 'columns': {
      const weights =
        block.weights && block.weights.length === block.columns.length
          ? block.weights
          : block.columns.map(() => 1)
      return (
        <div
          className="grid gap-4 lg:[grid-template-columns:var(--cols)]"
          style={{
            ['--cols' as string]: weights.map((w) => `minmax(0,${w}fr)`).join(' '),
          }}
        >
          {block.columns.map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-3">
              {column.map((inner, i) => (
                <BlockView key={i} block={inner} />
              ))}
            </div>
          ))}
        </div>
      )
    }
    case 'changes':
      return (
        <Table
          title={block.title}
          columns={['Vad', 'Före', 'Nu', 'Förändring']}
          rows={block.rows.map((r) => [r.label, r.before, r.after, r.note ?? ''])}
          align={['left', 'right', 'right', 'left']}
          tones={block.rows.map((r) => r.tone)}
          toneColumn={2}
        />
      )
    case 'actions':
      return (
        <Table
          columns={['Åtgärd', 'Ägare', 'Datum', 'Status']}
          rows={block.rows.map((r) => [r.action, r.owner, r.date, r.status])}
          tones={block.rows.map((r) => r.tone)}
          toneColumn={3}
        />
      )
  }
}

function Table({
  title,
  columns,
  rows,
  align,
  emphasis,
  totals,
  tones,
  toneColumn = 2,
  footnote,
}: {
  title?: string
  columns: readonly string[]
  rows: readonly string[][]
  align?: readonly ('left' | 'right')[]
  emphasis?: readonly number[]
  totals?: readonly number[]
  tones?: readonly (Tone | undefined)[]
  toneColumn?: number
  footnote?: string
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      {title && <p className="type-section text-[9.5px]">{title}</p>}
      <table className="mt-1 w-full text-[12px]">
        <thead>
          <tr className="border-b border-institution-line">
            {columns.map((c, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  'type-section py-1 pr-2 text-[9px] font-medium',
                  align?.[i] === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const total = totals?.includes(r) ?? false
            return (
              <tr
                key={r}
                className={cn(
                  'border-b border-line',
                  total && 'border-t border-t-content-subtle',
                  (total || emphasis?.includes(r)) && 'font-semibold',
                )}
              >
                {row.map((cell, i) => (
                  <td
                    key={i}
                    className={cn(
                      'py-1 pr-2 align-top',
                      align?.[i] === 'right' ? 'tabular text-right' : 'text-left',
                      i === toneColumn && tones?.[r]
                        ? TONE_CLASS[tones[r]!]
                        : 'text-content',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {footnote && (
        <p className="type-machine mt-1 normal-case text-content-muted">{footnote}</p>
      )}
    </div>
  )
}

function ChartView({ block }: { block: Extract<PackBlock, { kind: 'chart' }> }) {
  const caption = (
    <p className="type-machine mt-1.5 flex flex-wrap gap-x-3 normal-case">
      {block.series.length > 1 &&
        block.series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-[1px]"
              style={{ backgroundColor: `#${s.color}` }}
            />
            {s.name}
          </span>
        ))}
      <span className="text-content-subtle">
        {block.unit} · per {formatLongDate(block.asOf)} · {block.source}
        {block.note ? ` · ${block.note}` : ''}
      </span>
    </p>
  )
  if (block.chart === 'donut') {
    const values = block.categories.map((_, c) =>
      block.series.reduce((sum, s) => sum + (s.values[c] ?? 0), 0),
    )
    const total = Math.max(
      1e-9,
      values.reduce((a, b) => a + b, 0),
    )
    let acc = 0
    const stops = values
      .map((v, c) => {
        const from = (acc / total) * 100
        acc += v
        const to = (acc / total) * 100
        return `#${block.series[c]?.color ?? '8A97A8'} ${from}% ${to}%`
      })
      .join(', ')
    return (
      <figure>
        <figcaption className="type-section text-[9.5px]">{block.title}</figcaption>
        <div className="mt-2 flex items-center gap-4">
          <div
            role="img"
            aria-label={block.title}
            className="relative h-28 w-28 shrink-0 rounded-full"
            style={{ background: `conic-gradient(${stops})` }}
          >
            <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-surface">
              <span className="type-display-figure-sm text-[13px] text-content">
                {block.centre}
              </span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-0.5 text-[11.5px]">
            {block.categories.map((category, c) => (
              <li
                key={category}
                className="flex items-center justify-between gap-2 border-b border-line py-0.5"
              >
                <span className="inline-flex min-w-0 items-center gap-1.5 text-content-muted">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
                    style={{ backgroundColor: `#${block.series[c]?.color ?? '8A97A8'}` }}
                  />
                  <span className="truncate">{category}</span>
                </span>
                <span className="tabular shrink-0 text-content">
                  {round(values[c] ?? 0)} {block.unit} ·{' '}
                  {Math.round(((values[c] ?? 0) / total) * 100)} %
                </span>
              </li>
            ))}
          </ul>
        </div>
        {caption}
      </figure>
    )
  }
  const max = Math.max(
    1,
    ...(block.chart === 'stacked-bar'
      ? block.categories.map((_, c) =>
          block.series.reduce((s, x) => s + (x.values[c] ?? 0), 0),
        )
      : block.series.flatMap((s) => s.values)),
  )
  return (
    <figure>
      <figcaption className="type-section text-[9.5px]">{block.title}</figcaption>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {block.categories.map((category, c) => (
          <div
            key={category}
            className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2 text-[11.5px]"
          >
            <span className="truncate text-content-muted">{category}</span>
            {block.chart === 'stacked-bar' ? (
              <div className="flex h-3 w-full overflow-hidden rounded-[2px] bg-hairline">
                {block.series
                  .filter((s) => (s.values[c] ?? 0) > 0)
                  .map((s) => (
                    <span
                      key={s.name}
                      title={`${s.name} ${s.values[c]} ${block.unit}`}
                      style={{
                        width: `${((s.values[c] ?? 0) / max) * 100}%`,
                        backgroundColor: `#${s.color}`,
                      }}
                    />
                  ))}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {block.series.map((s) => (
                  <span
                    key={s.name}
                    title={`${s.name} ${s.values[c]} ${block.unit}`}
                    className={cn(
                      'block rounded-[1px]',
                      block.series.length === 1 ? 'h-2.5' : 'h-1.5',
                    )}
                    style={{
                      width: `${((s.values[c] ?? 0) / max) * 100}%`,
                      backgroundColor: `#${s.color}`,
                    }}
                  />
                ))}
              </div>
            )}
            <span className="tabular text-content">
              {block.chart === 'stacked-bar'
                ? `${round(block.series.reduce((s, x) => s + (x.values[c] ?? 0), 0))} ${block.unit}`
                : block.series
                    .map(
                      (s) =>
                        `${round(s.values[c] ?? 0)}${block.unit === '%' ? ' %' : ''}`,
                    )
                    .join(' / ')}
            </span>
          </div>
        ))}
      </div>
      {caption}
    </figure>
  )
}

function TimelineView({ block }: { block: Extract<PackBlock, { kind: 'timeline' }> }) {
  const maxDays = Math.max(90, ...block.items.map((i) => i.daysAhead))
  const span = Math.ceil(maxDays / 90) * 90
  return (
    <figure>
      <figcaption className="type-section text-[9.5px]">{block.title}</figcaption>
      <ol className="mt-1.5 flex flex-col gap-1.5">
        {block.items.map((item) => (
          <li
            key={`${item.label}-${item.date}`}
            className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-2 text-[11.5px]"
          >
            <span className="min-w-0">
              <span
                className={cn(
                  'block truncate',
                  item.tone ? TONE_CLASS[item.tone] : 'text-content',
                )}
              >
                {item.label}
              </span>
              {item.detail && (
                <span className="block truncate text-[10.5px] text-content-muted">
                  {item.detail}
                </span>
              )}
            </span>
            <span className="relative block h-3 w-full border-b border-line">
              <span
                className={cn(
                  'absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full',
                  item.tone === 'gold' ? 'bg-institution' : 'bg-content',
                )}
                style={{
                  left: `calc(${(Math.min(item.daysAhead, span) / span) * 100}% - 4px)`,
                }}
              />
            </span>
            <span className="tabular text-right text-content-muted">
              {formatLongDate(item.date)} · om {item.daysAhead} dagar
            </span>
          </li>
        ))}
      </ol>
      <p className="type-machine mt-1.5 normal-case text-content-subtle">
        Dagar från {formatLongDate(block.from)} · {block.source}
        {block.note ? ` · ${block.note}` : ''}
      </p>
    </figure>
  )
}

function round(value: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value)
}
