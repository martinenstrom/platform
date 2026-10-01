/**
 * The composed document: adaptive slide count, headlines that conclude,
 * facts placed once, Swedish formatting, no record id anywhere, speaker
 * notes off the body, and the file name without diacritics or ids.
 */

import { describe, expect, it } from 'vitest'
import { meetingPack } from '~/application/advisory/meetingPack'
import type { AdvisoryContext } from '~/application/advisory/ports'
import type { MarketCategory, MarketObservation } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { composePackDocument } from './meetingPackDocument'
import { fileBaseNameOf, readinessSummary } from './meetingPackText'
import type { PackBlock, PackDocument } from './packDocument'

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

/** Every string a document carries: headlines, blocks, notes. */
function allText(doc: PackDocument): string[] {
  const out: string[] = [doc.title, doc.meetingLabel]
  const walk = (block: PackBlock) => {
    switch (block.kind) {
      case 'kpis':
        for (const i of block.items) out.push(i.label, i.value, i.detail ?? '')
        break
      case 'statement':
        out.push(block.label ?? '', block.text)
        break
      case 'caption':
        out.push(block.text)
        break
      case 'list':
        out.push(block.title ?? '')
        for (const i of block.items) out.push(i.text, i.detail ?? '')
        break
      case 'table':
        out.push(block.title ?? '', ...block.columns, ...block.rows.flat())
        break
      case 'chart':
        out.push(
          block.title,
          block.source,
          ...block.categories,
          ...block.series.map((s) => s.name),
        )
        break
      case 'callout':
        out.push(block.title, block.text, block.detail ?? '')
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
  it('follows the outline: ten core slides and the appendix the record justifies', async () => {
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
  })

  it('writes every headline as a conclusion, not a topic', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const byKind = Object.fromEntries(doc.slides.map((s) => [s.kind, s]))
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
    expect(byKind.relationship!.headline).toMatch(/åtagande är försenat/)
    expect(byKind.questions!.headline).toMatch(
      /^Klienten lär fråga om bolånet; ställ frågan om/,
    )
    expect(byKind.plan!.headline).toMatch(
      /^Mötet ska enas om nästa steg för finansieringen/,
    )
    for (const slide of doc.slides) {
      expect(slide.headline.length, slide.kind).toBeGreaterThan(12)
    }
  })

  it('answers the executive questions on the first slide: who, why, what changed, what is owed', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const first = doc.slides[0]!
    expect(first.kind).toBe('executive')
    const text = allText({ ...doc, slides: [first] }).join(' ')
    expect(text).toMatch(/Anna & Per Dahlqvist/)
    expect(text).toMatch(/Arbetargatan/)
    expect(text).toMatch(/Sofia/)
    expect(text).toMatch(/Mötets huvudfokus/)
    expect(text).toMatch(/Topp 3 prioriteringar/)
    expect(text).toMatch(/Sedan sist/)
    expect(text).toMatch(/försenat/)
    /* Speaker notes carry the talking points and the sources, off the body. */
    expect(first.notes.some((n) => n.kind === 'talking-point')).toBe(true)
    expect(first.notes.some((n) => n.kind === 'source')).toBe(true)
  })

  it('places the bridge loan as a priority and as financing detail, not on the relationship slide again', async () => {
    const { doc, pack } = await documentFor('cl-dahlqvist')
    const financing = doc.slides.find((s) => s.kind === 'financing')!
    const relationship = doc.slides.find((s) => s.kind === 'relationship')!
    const maturity = pack.financing[0]!.event!
    expect(financing.sourceIds).toContain(maturity.id)
    const upcoming = allText({ ...doc, slides: [relationship] })
    expect(upcoming.some((t) => t === maturity.title)).toBe(false)
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
    for (const id of [...Object.keys(pack.titles), pack.identity.clientId]) {
      expect(joined.includes(id), id).toBe(false)
    }
  })

  it('keeps the notes internal: talking points, watch-outs, what not to claim, sources', async () => {
    const { doc } = await documentFor('cl-alvarsson')
    const financing = doc.slides.find((s) => s.kind === 'financing')!
    expect(financing.notes.map((n) => n.kind)).toEqual(
      expect.arrayContaining(['do-not-claim', 'follow-up', 'source']),
    )
    expect(financing.notes.find((n) => n.kind === 'do-not-claim')!.text).toMatch(/ränta/)
    const portfolio = doc.slides.find((s) => s.kind === 'portfolio')!
    expect(portfolio.notes.some((n) => n.kind === 'do-not-claim')).toBe(true)
    const executive = doc.slides[0]!
    /* Henrik's stale valuation is a watch-out in the notes and a readiness reason, never a slide claim. */
    expect(
      executive.notes.some((n) => n.kind === 'watch-out' && /dagar gammal/.test(n.text)),
    ).toBe(true)
  })

  it('draws the charts from data with a title, a unit, an as-of and a source', async () => {
    const { doc } = await documentFor('cl-dahlqvist')
    const charts = doc.slides.flatMap((s) =>
      s.blocks
        .flatMap((b) => (b.kind === 'columns' ? b.columns.flat() : [b]))
        .filter((b) => b.kind === 'chart'),
    )
    expect(charts.length).toBe(2)
    for (const chart of charts) {
      if (chart.kind !== 'chart') throw new Error('not a chart')
      expect(chart.title.length).toBeGreaterThan(0)
      expect(chart.unit.length).toBeGreaterThan(0)
      expect(chart.asOf).toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(chart.source.length).toBeGreaterThan(0)
      expect(chart.series.every((s) => s.values.length === chart.categories.length)).toBe(
        true,
      )
    }
  })

  it('shows the market slide only when a client-relevant move exists', async () => {
    const quiet = await documentFor('cl-dahlqvist')
    expect(quiet.doc.slides.some((s) => s.kind === 'market')).toBe(false)
    const sinceLast = quiet.doc.slides.find((s) => s.kind === 'since-last')!
    expect(allText({ ...quiet.doc, slides: [sinceLast] }).join(' ')).toMatch(
      /Inga väsentliga klientrelevanta marknadsförändringar/,
    )
    const moved = await documentFor('cl-dahlqvist', 'full', [rates])
    const market = moved.doc.slides.find((s) => s.kind === 'market')
    expect(market).toBeDefined()
    expect(market!.headline).toMatch(/relevans/)
    const text = allText({ ...moved.doc, slides: [market!] }).join(' ')
    expect(text).toMatch(/Vad hände/)
    expect(text).toMatch(/Finansiell relevans/)
    expect(text).toMatch(/Samtalsrelevans/)
    expect(text).toMatch(/Diskussionspunkter/)
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
