/**
 * The advisory composition root.
 *
 * One place decides which repositories the advisory context runs on and
 * which clock it reads. Phase 1: synthetic clients in memory, seeded
 * relative to the clock's date so the demonstration stays current. A later
 * phase swaps the repositories for PostgreSQL here and nowhere else.
 */

import type {
  AdvisoryContext,
  MarketObservationSource,
} from '~/application/advisory/ports'
import type { Clock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from './syntheticRepositories'
import { syntheticClients } from './syntheticClients'

/**
 * The market is handed in, never built here: its source reaches into the
 * market-data container, which must stay out of every module the client
 * bundle can follow (see `serverFns.ts` and `marketSource.ts`).
 */
export function createAdvisoryContext(
  clock: Clock,
  market?: MarketObservationSource,
): AdvisoryContext {
  const today = clock.isoNow().slice(0, 10)
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(today)),
    clock,
    ...(market ? { market } : {}),
  }
}
