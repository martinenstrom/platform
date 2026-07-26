/**
 * What the Bevakning table actually shows.
 *
 * The view-model tests prove the states are computed correctly; these prove
 * they reach the screen. The distinction matters here more than usual, because
 * every one of these states exists to stop the page claiming something it
 * cannot support.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WatchlistTable } from './WatchlistTable'
import type { WatchlistRow } from '~/presentation/marketData/watchlistViewModel'
import type { CanonicalSymbol } from '~/domain/market'

const row = (overrides: Partial<WatchlistRow> = {}): WatchlistRow => ({
  symbol: 'eq:xsto:volv-b' as CanonicalSymbol,
  displayName: 'Volvo B',
  ticker: 'VOLV B',
  value: 354.8,
  changePercent: 0.8,
  precision: 2,
  spark: [],
  signal: { state: 'unavailable' },
  ...overrides,
})

describe('the signal column', () => {
  it('says the signal is unavailable rather than showing nothing', () => {
    // An empty cell reads as "no signal"; this reads as "not built yet".
    render(<WatchlistTable items={[row()]} />)
    expect(screen.getByText('Ej tillgänglig')).toBeInTheDocument()
  })

  it('shows no buy, sell, hold or watch without a real agent behind it', () => {
    render(<WatchlistTable items={[row()]} />)
    // Scoped to the signal cell: the table caption legitimately contains
    // "Bevakade instrument", which a whole-table scan would trip on.
    const cells = within(screen.getByRole('row', { name: /Volvo B/ })).getAllByRole(
      'cell',
    )
    const signalCell = cells[cells.length - 1]!
    for (const word of ['Köp', 'Sälj', 'Behåll', 'Bevaka']) {
      expect(signalCell.textContent ?? '').not.toContain(word)
    }
  })

  it('marks an example signal as an example', () => {
    render(
      <WatchlistTable items={[row({ signal: { state: 'example', signal: 'buy' } })]} />,
    )
    // The badge may say "Köp" — but never without "Exempel" beside it.
    expect(screen.getByText('Exempel')).toBeInTheDocument()
  })

  it('keeps the column header even with nothing to show', () => {
    // It is the landing place for real agent signals; removing it would make
    // the future integration a layout change.
    render(<WatchlistTable items={[row()]} />)
    expect(screen.getByRole('columnheader', { name: 'Signal' })).toBeInTheDocument()
  })
})

describe('the sparkline column', () => {
  it('draws nothing when there is no history', () => {
    const { container } = render(<WatchlistTable items={[row({ spark: [] })]} />)
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
  })

  it('draws a line when history exists', () => {
    // Guards the assertion above from passing for the wrong reason.
    const { container } = render(
      <WatchlistTable items={[row({ spark: [1, 2, 3, 4] })]} />,
    )
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
  })

  it('keeps the row intact without a sparkline', () => {
    render(<WatchlistTable items={[row({ spark: [] })]} />)
    const cells = within(screen.getByRole('row', { name: /Volvo B/ })).getAllByRole(
      'cell',
    )
    // Instrument, price, change, trend, signal — the layout does not collapse.
    expect(cells).toHaveLength(5)
  })
})

describe('missing values', () => {
  it('renders a dash rather than a zero when no quote resolved', () => {
    const { container } = render(
      <WatchlistTable items={[row({ value: null, changePercent: null })]} />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('–')
    // A zero price and a flat change would both be assertions we cannot make.
    expect(text).not.toMatch(/\b0,00\b/)
  })
})
