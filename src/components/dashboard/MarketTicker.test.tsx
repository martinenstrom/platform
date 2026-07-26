/**
 * What the Markets ticker actually shows.
 *
 * The two international index rows are the point of these tests: they have no
 * approved provider, and the screen has to say so rather than show a number
 * from somewhere else.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketTickerList } from './MarketTicker'
import type { MarketTickerRow } from '~/presentation/marketData/marketsViewModel'
import type { CanonicalSymbol } from '~/domain/market'

const row = (overrides: Partial<MarketTickerRow> = {}): MarketTickerRow => ({
  symbol: 'idx:omxs30' as CanonicalSymbol,
  displayName: 'OMXS30',
  value: 3199.61,
  changePercent: 1.03,
  precision: 2,
  state: 'ok',
  tone: 'positive',
  sourceName: 'Avanza',
  isDemo: false,
  ...overrides,
})

describe('an available row', () => {
  it('shows the level and the change', () => {
    const { container } = render(<MarketTickerList rows={[row()]} />)
    const text = container.textContent ?? ''
    expect(text).toContain('OMXS30')
    expect(text).toMatch(/3\s?199,61/)
  })

  it('marks a fixture value as an example', () => {
    render(<MarketTickerList rows={[row({ state: 'fixture', isDemo: true })]} />)
    expect(screen.getByText('Exempel')).toBeInTheDocument()
  })

  it('does not mark a real value', () => {
    const { container } = render(<MarketTickerList rows={[row()]} />)
    expect(container.textContent).not.toContain('Exempel')
  })
})

describe('an unavailable row', () => {
  const unavailable = row({
    symbol: 'idx:sp500' as CanonicalSymbol,
    displayName: 'S&P 500',
    value: null,
    changePercent: null,
    state: 'unavailable',
    tone: 'muted',
    sourceName: null,
  })

  it('says it is unavailable instead of showing a number', () => {
    render(<MarketTickerList rows={[unavailable]} />)
    expect(screen.getByText('Ej tillgänglig')).toBeInTheDocument()
  })

  it('shows no zero and no percentage', () => {
    const { container } = render(<MarketTickerList rows={[unavailable]} />)
    const text = container.textContent ?? ''
    // A zero level and a 0,00 % change would both be claims we cannot make.
    expect(text).not.toMatch(/\b0,00\b/)
    expect(text).not.toContain('%')
  })

  it('keeps the instrument name visible', () => {
    // The row stays as the landing place for the future provider decision, so
    // the reader can see what is missing rather than what was quietly dropped.
    render(<MarketTickerList rows={[unavailable]} />)
    expect(screen.getByText('S&P 500')).toBeInTheDocument()
  })
})

describe('the whole card', () => {
  it('renders available and unavailable rows side by side', () => {
    const rows = [
      row(),
      row({
        symbol: 'idx:sp500' as CanonicalSymbol,
        displayName: 'S&P 500',
        value: null,
        changePercent: null,
        state: 'unavailable',
        tone: 'muted',
        sourceName: null,
      }),
      row({
        symbol: 'crypto:btc' as CanonicalSymbol,
        displayName: 'Bitcoin (USD)',
        value: 78240.5,
        precision: 2,
      }),
    ]
    const { container } = render(<MarketTickerList rows={rows} />)
    expect(container.querySelectorAll('li')).toHaveLength(3)
    // Bitcoin names its currency; the index rows do not need to.
    expect(within(container).getByText('Bitcoin (USD)')).toBeInTheDocument()
  })
})
