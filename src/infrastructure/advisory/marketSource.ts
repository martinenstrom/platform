/**
 * The market, as the advisory context observes it: the same overview
 * snapshot the dashboard renders, read through the same container and the
 * same use case, mapped into the advisory domain's observation shape.
 *
 * Server-only by construction, like `marketData/containerInstance`: the
 * advisory door reaches this module through a dynamic `import()` inside its
 * handler bodies, which the client build strips, so the providers — and the
 * MCP stdio client one of them spawns — never enter the browser bundle.
 * Nothing imports this module statically.
 */

import { marketObservationsFrom } from '~/application/advisory/marketImpact'
import type { MarketObservationSource } from '~/application/advisory/ports'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import type { Clock } from '~/domain/shared/clock'
import { getContainer } from '~/infrastructure/marketData/containerInstance'
import { createOverviewDataSource } from '~/infrastructure/marketData/overviewDataSource'
import { applyMarketScenario, parseMarketScenarios } from './marketScenarios'

export function createMarketObservationSource(clock: Clock): MarketObservationSource {
  const scenarios = parseMarketScenarios(process.env.MARKET_TO_CLIENT_SCENARIO)
  return {
    scenario: scenarios.length > 0 ? scenarios.join(',') : null,
    async observe() {
      const container = await getContainer()
      const snapshot = await getOverviewSnapshot(createOverviewDataSource(container))
      return applyMarketScenario(
        marketObservationsFrom(snapshot),
        scenarios,
        clock.isoNow(),
      )
    },
  }
}
