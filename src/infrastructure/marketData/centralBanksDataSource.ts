/**
 * Wires the central-bank snapshot onto the shared resolution pipeline.
 *
 * Small on purpose: the pipeline already owns caching, retry, breaker, budget
 * and fallback, so this file's whole job is to name three categories and hand
 * back three independent envelopes.
 */

import type {
  EcbPolicyState,
  FederalReservePolicyState,
  RiksbankPolicyState,
} from '~/domain/policy'
import type { Envelope, Provenance } from '~/domain/shared/provenance'
import type { CorrelationId } from '~/domain/shared/correlation'
import type {
  Capability,
  DataCategory,
  FetchContext,
  PolicyRateProvider,
} from '~/application/marketData/ports'
import type { CentralBanksDataSource } from '~/application/policy/getCentralBanksSnapshot'
import { resolve, type ResolveDeps } from '~/application/marketData/resolution'
import type { Container } from './container'
import { policyStateKey } from './keys'

export function createCentralBanksDataSource(
  container: Container,
  correlationId: CorrelationId = container.newCorrelationId(),
): CentralBanksDataSource {
  const deps: ResolveDeps = {
    registry: container.registry,
    clock: container.clock,
    production: container.config.production,
    cache: container.cache,
    logger: container.logger,
    metrics: container.metrics,
    runAttempt: container.runAttempt,
    singleFlight: (key, execute) => container.singleFlight.run(key, execute),
    correlationId,
  }

  function run<T extends { provenance: Provenance }>(
    category: DataCategory,
    bank: string,
  ): Promise<Envelope<T>> {
    return resolve<T>(deps, {
      category,
      capability: 'policy-rates' as Capability,
      cacheKey: policyStateKey(bank),
      chain: container.config.chains[category],
      /*
       * Policy publication has no trading session. `true` selects the open
       * TTL, and both TTLs are identical for these categories precisely so
       * this flag cannot quietly mean anything.
       */
      marketOpen: true,
      attempt: async (provider: unknown, ctx: FetchContext) => {
        // The registry is untyped by design: it routes on capability, not on
        // which institution a provider serves. Each call site above names the
        // concrete state type, and the adapter contract tests pin the shape.
        const state = (await (provider as PolicyRateProvider).fetchPolicyState(
          ctx,
        )) as unknown as T
        return { data: state, provenance: state.provenance }
      },
    })
  }

  return {
    now: () => container.clock.now(),
    correlationId: () => correlationId,
    federalReserve: () => run<FederalReservePolicyState>('policy-us', 'federal-reserve'),
    ecb: () => run<EcbPolicyState>('policy-ea', 'ecb'),
    riksbank: () => run<RiksbankPolicyState>('policy-se', 'riksbank'),
  }
}
