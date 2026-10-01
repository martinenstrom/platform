import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import { NOTE_KIND_LABEL } from '~/presentation/documents/meetingPackText'
import type {
  PackBlock,
  PackDocument,
  PackSlide,
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
        {doc.confidentiality} · {doc.client} · data per {formatLongDate(doc.dataAsOf)}
      </p>
    </section>
  )
}

const MARKER_LABEL = {
  fact: 'Fakta',
  assessment: 'Bedömning',
  suggestion: 'Förslag',
} as const

const TONE_CLASS = {
  gold: 'text-institution',
  neutral: 'text-content',
  warning: 'text-negative',
  positive: 'text-positive',
  negative: 'text-negative',
} as const

function BlockView({ block }: { block: PackBlock }) {
  switch (block.kind) {
    case 'kpis':
      return (
        <dl
          className={cn(
            'grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4',
            block.lead && 'rounded-[4px] border border-line bg-surface-2 px-3 py-2',
          )}
        >
          {block.items.map((item) => (
            <div key={item.label} className="min-w-0">
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
        />
      )
    case 'chart':
      return <ChartView block={block} />
    case 'callout':
      return (
        <div
          className={cn(
            'rounded-[4px] border px-3 py-2',
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
          <p className="type-display-statement mt-1 text-[14px] text-content">
            {block.text}
          </p>
          {block.detail && (
            <p className="mt-1 text-[12px] leading-snug text-content-muted">
              {block.detail}
            </p>
          )}
        </div>
      )
    case 'columns':
      return (
        <div
          className={cn(
            'grid gap-4',
            block.columns.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
          )}
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
    case 'changes':
      return (
        <Table
          title={block.title}
          columns={['Vad', 'Före', 'Nu', '']}
          rows={block.rows.map((r) => [r.label, r.before, r.after, r.note ?? ''])}
          align={['left', 'right', 'right', 'left']}
          tones={block.rows.map((r) => r.tone)}
        />
      )
    case 'actions':
      return (
        <Table
          columns={['Åtgärd', 'Ägare', 'Datum', 'Status']}
          rows={block.rows.map((r) => [r.action, r.owner, r.date, r.status])}
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
  tones,
}: {
  title?: string
  columns: readonly string[]
  rows: readonly string[][]
  align?: readonly ('left' | 'right')[]
  emphasis?: readonly number[]
  tones?: readonly (keyof typeof TONE_CLASS | undefined)[]
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
          {rows.map((row, r) => (
            <tr
              key={r}
              className={cn(
                'border-b border-line',
                emphasis?.includes(r) && 'font-semibold',
              )}
            >
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    'py-1 pr-2 align-top',
                    align?.[i] === 'right' ? 'tabular text-right' : 'text-left',
                    i === 2 && tones?.[r] ? TONE_CLASS[tones[r]!] : 'text-content',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartView({ block }: { block: Extract<PackBlock, { kind: 'chart' }> }) {
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
            className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 text-[11.5px]"
          >
            <span className="truncate text-content-muted">{category}</span>
            {block.chart === 'stacked-bar' ? (
              <div className="flex h-3 w-full overflow-hidden rounded-[2px] bg-white/[0.06]">
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
                    className="block h-1.5 rounded-[1px]"
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
                    .map((s) => `${round(s.values[c] ?? 0)} ${block.unit}`)
                    .join(' / ')}
            </span>
          </div>
        ))}
      </div>
      <p className="type-machine mt-1.5 flex flex-wrap gap-x-3 normal-case">
        {block.series.map((s) => (
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
    </figure>
  )
}

function round(value: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value)
}
