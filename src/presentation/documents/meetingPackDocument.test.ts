/**
 * The composed document: adaptive slide count, one archetype per page,
 * headlines that conclude, facts placed once, the analytical inventory
 * (charts, tables with totals, margin notes), Swedish formatting, no
 * record id anywhere, speaker notes in reading order and off the body,
 * and the file name without diacritics or ids.
 */

import { describe, expect, it } from 'vitest'
import { meetingPack } from '~/application/advisory/meetingPack'
import type { AdvisoryContext } from '~/application/advisory/ports'
import type { MarketCategory, MarketObservation } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { composePackDocument } from './meetingPackDocument'
import { fileBaseNameOf, NOTE_ORDER, readinessSummary } from './meetingPackText'
import type { PackBlock, PackDocument, PackSlide } from './packDocument'

const TODAY = '2026-09-23'
const NOW = `${TODAY}T07:30:00.000Z`

const rates: MarketObservation = {
  symbol: 'rate:us10y',
  category: 'rates' as MarketCategory,
  label: 'US 10Y',
  value: 4.5,
  change: 32,
  changeUnit: 'bp',
  observedAt: NOW,
  source: 'test',
  quality: 'live',
  tags: { region: 'us' },
}

function contextWith(observations: readonly MarketObservation[] = []): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(NOW),
    market: {
      scenario: null,
      async observe() {
        return observations
      },
    },
  }
}

async function documentFor(
  clientId: string,
  depth: 'executive' | 'full' = 'full',
  observations: readonly MarketObservation[] = [],
) {
  const pack = (await meetingPack(contextWith(observations), clientId, depth))!
  return { pack, doc: composePackDocument(pack) }
}

/** Every block, with the columns opened. */
function blocksOf(slide: PackSlide): PackBlock[] {
  const out: PackBlock[] = []
  const walk = (block: PackBlock) => {
    out.push(block)
    if (block.kind === 'columns')
      for (const col of block.columns) for (const b of col) walk(b)
  }
  for (const block of slide.blocks) walk(block)
  return out
}

/** Every string a document carries: headlines, blocks, notes. */
function allText(doc: PackDocument): string[] {
  const out: string[] = [doc.title, doc.meetingLabel]
  const walk = (block: PackBlock) => {
    switch (block.kind) {
      case 'kpis':
        for (const i of block.items) out.push(i.label, i.value, i.detail ?? '')
        break
      case 'statement':
        out.push(
          block.label ?? '',
          block.text,
          block.addendum?.label ?? '',
          block.addendum?.text ?? '',
        )
        break
      case 'caption':
        out.push(block.text)
        break
      case 'list':
        out.push(block.title ?? '')
        for (const i of block.items) out.push(i.text, i.detail ?? '')
        break
      case 'table':
        out.push(
          block.title ?? '',
          ...block.columns,
          ...block.rows.flat(),
          block.footnote ?? '',
        )
        break
      case 'chart':
        out.push(
          block.title,
          block.source,
          block.centre ?? '',
          ...block.categories,
          ...block.series.map((s) => s.name),
        )
        break
      case 'timeline':
        out.push(block.title, block.source)
        for (const i of block.items) out.push(i.label, i.detail ?? '')
        break
      case 'callout':
        out.push(block.title, block.text, block.detail ?? '')
        break
      case 'callouts':
        for (const i of block.items) out.push(i.text, i.detail ?? '')
        break
      case 'meta':
        for (const i of block.items) out.push(i.label, i.value)
        break
      case 'columns':
        for (const col of block.columns) for (const b of col) walk(b)
        break
      case 'changes':
        for (const r of block.rows) out.push(r.label, r.before, r.after, r.note ?? '')
        break
      case 'actions':
        for (const r of block.rows) out.push(r.action, r.owner, r.date, r.status)
        break
    }
  }
  for (const slide of doc.slides) {
    out.push(slide.kicker, slide.headline)
    for (const block of slide.blocks) walk(block)
    for (const note of slide.notes) out.push(note.text)
  }
  return out.filter((t) => t.length > 0)
}

describe('Anna & Per — the full pack', () => {
  it('follows the outline: the core slides and the appendix the record justifies', async () => {
    const { pack, doc } = await documentFor('cl-dahlqvist')
    expect(doc.slides.map((s) => s.kind)).toEqual([
      ...pack.outline.core,
      ...pack.outline.appendix,
    ])
    expect(doc.coreCount).toBe(pack.outline.core.length)
    expect(doc.appendixCount).toBe(pack.outline.appendix.length)
    expect(doc.audience).toBe('INTERNAL_ADVISOR')
    expect(doc.internalMark).toBe('INTERNT')
    expect(doc.confidentiality).toMatch(/KONFIDENTIELLT/)
    expect(doc.advisor).toBe('Sofia')
    expect(doc.office).toBe('Arbetargatan')
    expect(doc.provenance.sourceCount).toBe(pack.sources.length)
  })

  it('gives every page its own archetype: the core pages differ, the appendix pages are data pages', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const core = doc.slides.filter((s) => s.section === 'core').map((s) => s.archetype)
    expect(new Set(core).size).toBe(core.length)
    expect(core).toEqual(
      expect.arrayContaining([
        'executive',
        'snapshot',
        'change',
        'balance-sheet',
        'portfolio',
        'financing',
        'issues',
        'questions',
        'plan',
        'actions',
      ]),
    )
    for (const slide of doc.slides.filter((s) => s.section === 'appendix')) {
      expect(slide.archetype).toBe('appendix-data')
    }
  })

  it('writes every headline as a conclusion, not a topic — the first slide included', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const byKind = Object.fromEntries(doc.slides.map((s) => [s.kind, s]))
    expect(byKind.executive!.headline).toMatch(
      /^Brygglånet Åre förfaller om \d+ dagar; finansieringen är mötets huvudpunkt\.$/,
    )
    expect(byKind.financing!.headline).toMatch(
      /förfaller om \d+ dagar och kräver ett tydligt nästa steg/,
    )
    expect(byKind.financing!.headline).not.toMatch(/förfaller förfaller/)
    expect(byKind.glance!.headline).toMatch(
      /^42,0 MSEK i total förmögenhet, 12 % hos banken/,
    )
    expect(byKind.wealth!.headline).toMatch(
      /^Nettoförmögenhet 22,5 MSEK: fastigheter är \d+ % av tillgångarna/,
    )
    expect(byKind.portfolio!.headline).toMatch(
      /^Portföljen ligger inom mandatet; likviditeten/,
    )
    expect(byKind.relationship!.headline).toMatch(/åtagande är försenat/)
    expect(byKind.questions!.headline).toMatch(
      /^Klienten lär fråga om bolånet; ställ frågan om/,
    )
    expect(byKind.plan!.headline).toMatch(
      /^Mötet ska enas om nästa steg för finansieringen/,
    )
    expect(byKind['next-steps']!.headline).toMatch(
      /gäller redan; .* bekräftas i mötet\.$/,
    )
    for (const slide of doc.slides.filter((s) => s.section === 'core')) {
      expect(slide.headline.length, slide.kind).toBeGreaterThan(30)
      expect(slide.headline, slide.kind).not.toBe(slide.kicker)
      expect(slide.headline, slide.kind).toMatch(/[.!?]$|MSEK$|poster/)
    }
  })

  it('runs the meeting from the first slide: who, when, the figures, the focus, the outcome, the top three, the critical date', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const first = doc.slides[0]!
    expect(first.kind).toBe('executive')
    expect(first.archetype).toBe('executive')
    const text = allText({ ...doc, slides: [first] }).join(' ')
    for (const expected of [
      'Anna & Per Dahlqvist',
      'Arbetargatan',
      'Sofia',
      '26 sep 2026',
      'Total förmögenhet',
      'Hos banken',
      'Nettoförmögenhet',
      'Likviditet',
      'Relationshälsa',
      'Mötets huvudfokus',
      'Önskat utfall',
      'Topp 3 prioriteringar',
      'Sedan sist',
      'Kritiskt datum',
      'Brygglånet Åre förfaller',
      'försenat',
    ]) {
      expect(text, expected).toContain(expected)
    }
    /* Speaker notes carry the point, why it matters, the follow-up and the sources, off the body. */
    expect(first.notes.map((n) => n.kind)).toEqual(
      expect.arrayContaining(['talking-point', 'why-it-matters', 'follow-up', 'source']),
    )
  })

  it('carries the analytical inventory: a composition donut early, previous against current, the balance sheet, allocation against strategy, liquidity against maturities, a maturity timeline', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const charts = doc.slides.flatMap((s) =>
      blocksOf(s)
        .filter((b): b is Extract<PackBlock, { kind: 'chart' }> => b.kind === 'chart')
        .map((b) => ({ slide: s.kind, ...b })),
    )
    /* Anna & Per's record moved in one figure only, so the change page keeps its table and draws no bars for one row. */
    expect(charts.map((c) => `${c.slide}:${c.chart}`)).toEqual([
      'glance:donut',
      'wealth:stacked-bar',
      'portfolio:grouped-bar',
      'financing:horizontal-bar',
    ])
    const change = doc.slides.find((s) => s.kind === 'since-last')!
    expect(blocksOf(change).some((b) => b.kind === 'changes')).toBe(true)
    for (const chart of charts) {
      expect(chart.title.length).toBeGreaterThan(0)
      expect(chart.unit.length).toBeGreaterThan(0)
      expect(chart.asOf).toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(chart.source.length).toBeGreaterThan(0)
      expect(chart.series.every((s) => s.values.length === chart.categories.length)).toBe(
        true,
      )
    }
    const donut = charts.find((c) => c.chart === 'donut')!
    expect(donut.centre).toBe('42,0 MSEK')
    const timelines = doc.slides.flatMap((s) =>
      blocksOf(s).filter(
        (b): b is Extract<PackBlock, { kind: 'timeline' }> => b.kind === 'timeline',
      ),
    )
    expect(timelines).toHaveLength(1)
    expect(timelines[0]!.items.length).toBeGreaterThan(0)
    expect(timelines[0]!.items[0]!.daysAhead).toBeGreaterThanOrEqual(0)
    expect(timelines[0]!.items.map((i) => i.daysAhead)).toEqual(
      [...timelines[0]!.items.map((i) => i.daysAhead)].sort((a, b) => a - b),
    )
  })

  it('sets the serious tables: a financial summary and a balance sheet with totals, a loan structure with a sum, sums in the appendix', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const tables = doc.slides.flatMap((s) =>
      blocksOf(s)
        .filter((b): b is Extract<PackBlock, { kind: 'table' }> => b.kind === 'table')
        .map((b) => ({ slide: s.kind, ...b })),
    )
    const byTitle = (title: string) => tables.find((t) => t.title === title)!
    const summary = byTitle('Finansiell översikt')
    expect(summary.slide).toBe('glance')
    expect(summary.rows[summary.totals![0]!]![0]).toBe('Nettoförmögenhet')
    expect(summary.rows.map((r) => r[0])).toEqual(
      expect.arrayContaining([
        'Total förmögenhet',
        'varav hos banken',
        'Skulder',
        'Likviditet',
      ]),
    )
    const balance = byTitle('Balansräkning')
    expect(balance.totals!.map((i) => balance.rows[i]![0])).toEqual([
      'Summa tillgångar',
      'Summa skulder',
      'Nettoförmögenhet',
    ])
    expect(balance.rows[balance.totals![2]!]![2]).toBe('22,5 MSEK')
    const loans = byTitle('Lånestruktur')
    expect(loans.columns).toContain('Säkerhet')
    expect(loans.rows[loans.totals![0]!]![0]).toBe('Summa')
    expect(loans.rows[loans.totals![0]!]![1]).toBe('19,5 MSEK')
    const holdings = tables.find((t) => t.slide === 'appendix-holdings')!
    expect(holdings.rows[holdings.totals![0]!]![0]).toBe('Summa')
    const appendixLoans = tables.find((t) => t.slide === 'appendix-loans')!
    expect(appendixLoans.rows[appendixLoans.totals![0]!]![0]).toBe('Summa')
    /* Figures are right-aligned wherever a column holds them. */
    for (const table of [summary, balance, loans]) {
      expect(table.align!.filter((a) => a === 'right').length).toBeGreaterThanOrEqual(2)
    }
    expect(tables.find((t) => t.title === 'Öppna åtaganden')).toBeDefined()
    expect(tables.find((t) => t.title === 'Viktiga datum')).toBeDefined()
    expect(tables.find((t) => t.title === 'Förslag på agenda')).toBeDefined()
    expect(tables.find((t) => t.title === 'Klienten kan fråga')!.columns).toEqual([
      'Fråga',
      'Sannolikhet',
      'Underlag',
    ])
  })

  it('writes small margin notes on the analytical pages, never a page of them', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const withNotes = doc.slides.filter((s) =>
      blocksOf(s).some((b) => b.kind === 'callouts'),
    )
    expect(withNotes.map((s) => s.kind)).toEqual(
      expect.arrayContaining([
        'glance',
        'since-last',
        'wealth',
        'portfolio',
        'financing',
        'relationship',
        'questions',
        'next-steps',
      ]),
    )
    for (const slide of doc.slides) {
      for (const block of blocksOf(slide)) {
        if (block.kind !== 'callouts') continue
        expect(block.items.length, slide.kind).toBeGreaterThan(0)
        expect(block.items.length, slide.kind).toBeLessThanOrEqual(3)
        for (const item of block.items) {
          expect([
            'observation',
            'implication',
            'why-it-matters',
            'watch-out',
            'verify',
          ]).toContain(item.kind)
          expect(item.text.length, slide.kind).toBeLessThan(260)
        }
      }
    }
    const financing = doc.slides.find((s) => s.kind === 'financing')!
    const notes = blocksOf(financing).find((b) => b.kind === 'callouts')!
    if (notes.kind !== 'callouts') throw new Error('not callouts')
    expect(notes.items.map((i) => i.kind)).toEqual(['implication', 'watch-out'])
    expect(notes.items[0]!.text).toMatch(/planen .* lösen/)
    expect(notes.items[1]!.detail).toMatch(/räntor verifieras före mötet/)
  })

  it('places the bridge loan as a priority and as financing detail, not on the relationship slide again', async () => {
    const { doc, pack } = await documentFor('cl-dahlqvist')
    const financing = doc.slides.find((s) => s.kind === 'financing')!
    const relationship = doc.slides.find((s) => s.kind === 'relationship')!
    const maturity = pack.financing[0]!.event!
    expect(financing.sourceIds).toContain(maturity.id)
    const upcoming = allText({ ...doc, slides: [relationship] })
    expect(upcoming.some((t) => t.startsWith(`${maturity.title} ·`))).toBe(false)
  })

  it('uses Financial OS formatting and never an id or an arrow', async () => {
    const { pack, doc } = await documentFor('cl-dahlqvist')
    const texts = allText(doc)
    const joined = texts.join('\n')
    expect(joined).toMatch(/\d,\d MSEK/)
    expect(joined).toMatch(/\d+ %/)
    expect(joined).toMatch(/\d{1,2} \w{3} 2026/)
    expect(joined).not.toMatch(/\d\.\d ?m\b/i)
    expect(joined).not.toMatch(/SEK\d/)
    expect(joined).not.toMatch(/→/)
    expect(joined).not.toMatch(/undefined|NaN/)
    for (const id of [...Object.keys(pack.titles), pack.identity.clientId]) {
      expect(joined.includes(id), id).toBe(false)
    }
  })

  it('keeps the notes internal and in reading order: the point, why it matters, what to mind, what not to claim, what to verify, the follow-up, the basis', async () => {
    const { doc } = await documentFor('cl-alvarsson')
    for (const slide of doc.slides) {
      const order = slide.notes.map((n) => NOTE_ORDER.indexOf(n.kind))
      expect(order, slide.kind).toEqual([...order].sort((a, b) => a - b))
    }
    const financing = doc.slides.find((s) => s.kind === 'financing')!
    expect(financing.notes.map((n) => n.kind)).toEqual(
      expect.arrayContaining([
        'talking-point',
        'why-it-matters',
        'do-not-claim',
        'follow-up',
        'source',
      ]),
    )
    expect(financing.notes.find((n) => n.kind === 'do-not-claim')!.text).toMatch(/ränta/)
    const portfolio = doc.slides.find((s) => s.kind === 'portfolio')!
    expect(portfolio.notes.some((n) => n.kind === 'do-not-claim')).toBe(true)
    expect(portfolio.notes.some((n) => n.kind === 'why-it-matters')).toBe(true)
    const executive = doc.slides[0]!
    /* Henrik's stale valuation is something to verify in the notes and a readiness reason, never a slide claim. */
    expect(
      executive.notes.some((n) => n.kind === 'verify' && /dagar gammal/.test(n.text)),
    ).toBe(true)
    expect(
      allText({ ...doc, slides: [{ ...executive, notes: [] }] }).join(' '),
    ).not.toMatch(/dagar gammal/)
  })

  it('shows the market slide only when a client-relevant move exists, and says why it matters once', async () => {
    const quiet = await documentFor('cl-dahlqvist')
    expect(quiet.doc.slides.some((s) => s.kind === 'market')).toBe(false)
    const sinceLast = quiet.doc.slides.find((s) => s.kind === 'since-last')!
    expect(allText({ ...quiet.doc, slides: [sinceLast] }).join(' ')).toMatch(
      /Inga väsentliga klientrelevanta marknadsförändringar/,
    )
    const moved = await documentFor('cl-dahlqvist', 'full', [rates])
    const market = moved.doc.slides.find((s) => s.kind === 'market')
    expect(market).toBeDefined()
    expect(market!.archetype).toBe('market')
    expect(market!.headline).toMatch(
      /^US 10-årsränta \+32 bp spelar roll: direkt exponering/,
    )
    const text = allText({ ...moved.doc, slides: [market!] }).join(' ')
    expect(text).toMatch(/Vad hände/)
    expect(text).toMatch(/Finansiell relevans/)
    expect(text).toMatch(/Samtalsrelevans/)
    const table = blocksOf(market!).find((b) => b.kind === 'table')!
    if (table.kind !== 'table') throw new Error('not a table')
    /* The reason is said once, in the margin, not repeated per row. */
    expect(table.columns).not.toContain('Varför det spelar roll')
    const notes = blocksOf(market!).find((b) => b.kind === 'callouts')!
    if (notes.kind !== 'callouts') throw new Error('not callouts')
    expect(notes.items[0]!.kind).toBe('why-it-matters')
  })
})

describe('the executive brief and the quiet client', () => {
  it('is three to five slides that carry the meeting plan and the next steps', async () => {
    const { doc } = await documentFor('cl-dahlqvist', 'executive')
    expect(doc.slides.length).toBeGreaterThanOrEqual(3)
    expect(doc.slides.length).toBeLessThanOrEqual(5)
    expect(doc.appendixCount).toBe(0)
    const plan = doc.slides.find((s) => s.kind === 'plan')!
    expect(plan.blocks.some((b) => b.kind === 'actions')).toBe(true)
    /* The frozen clock: the meeting falls three days after 23 September. */
    expect(doc.fileBaseName).toBe('Anna_Per_Dahlqvist_Executive_brief_2026-09-26')
  })

  it('gives the quiet client a shorter deck with no empty slide', async () => {
    const { doc } = await documentFor('cl-ekstrand')
    const rich = await documentFor('cl-dahlqvist')
    expect(doc.coreCount).toBeLessThan(rich.doc.coreCount)
    for (const slide of doc.slides) {
      expect(slide.blocks.length, slide.kind).toBeGreaterThan(0)
    }
  })

  it('marks a missing figure DATA SAKNAS rather than inventing one', async () => {
    const { doc } = await documentFor('cl-grahn')
    const text = allText(doc).join('\n')
    expect(text).not.toMatch(/undefined|null|NaN/)
    expect(text).toMatch(/Ingen baslinje|DATA SAKNAS|Saknas/)
  })
})

describe('the small vocabulary', () => {
  it('builds a clean file name and a readiness summary', () => {
    expect(fileBaseNameOf('Anna & Per Dahlqvist', 'full', '2026-10-02')).toBe(
      'Anna_Per_Dahlqvist_Motesunderlag_2026-10-02',
    )
    expect(fileBaseNameOf('Åsa Öberg-Ängström', 'executive', '2026-10-02')).toBe(
      'Asa_Oberg_Angstrom_Executive_brief_2026-10-02',
    )
    expect(
      readinessSummary({
        state: 'GRANSKA',
        reasons: [
          { kind: 'stale-valuation', severity: 'review', sourceIds: [] },
          { kind: 'external-not-updated', severity: 'review', sourceIds: [] },
          { kind: 'loan-rate-unverified', severity: 'review', sourceIds: [] },
        ],
        method: 'pack-readiness-v1',
      }),
    ).toBe('2 datapunkter bör verifieras · 1 finansieringsuppgift saknar aktuell ränta')
  })
})
