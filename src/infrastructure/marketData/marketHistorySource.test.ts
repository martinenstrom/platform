/**
 * The history source routes a symbol to the chain that serves its family,
 * and answers a symbol no chain serves as "no series" without a request.
 */

import { describe, expect, it } from 'vitest'
import {
  SYM_DAX,
  SYM_EURUSD,
  SYM_GOLD,
  SYM_SP500,
  SYM_US10Y,
  SYM_DE10Y,
} from '~/domain/market'
import { HISTORY_SERVED_SYMBOLS, historyCategoryFor } from './marketHistorySource'

describe('the history source', () => {
  it('routes the indices, the ECB pairs and the US yields to their chains', () => {
    expect(historyCategoryFor(SYM_SP500)).toBe('history-index')
    expect(historyCategoryFor(SYM_DAX)).toBe('history-index')
    expect(historyCategoryFor(SYM_EURUSD)).toBe('history-fx')
    expect(historyCategoryFor(SYM_US10Y)).toBe('history-yields-us')
  })

  it('serves no history for a commodity or a non-US yield, which no adapter has a route for', () => {
    expect(historyCategoryFor(SYM_GOLD)).toBeNull()
    expect(historyCategoryFor(SYM_DE10Y)).toBeNull()
    expect(HISTORY_SERVED_SYMBOLS).not.toContain(SYM_GOLD)
    expect(HISTORY_SERVED_SYMBOLS).toContain(SYM_SP500)
  })
})
