/**
 * Wires the central-bank snapshot onto the shared resolution pipeline.
 *
 * Small on purpose: the pipeline already owns caching, retry, breaker, budget
 * and fallback, so this file's whole job is to name three categories and hand
 * back three independent envelopes.
 */

import type {
  CentralBankPolicyState,
  EcbPolicyState,
  FederalReservePolicyState,
  RiksbankPolicyState,
} from '~/domain/policy'
import type { Envelope } from '~/domain/shared/provenance'
import type { CorrelationId } from '~/domain/shared/correlation'
import type { DataCategory, FetchContext } from '~/application/marketData/ports'
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
    chainGapsSeen: container.chainGapsSeen,
  }

  /**
   * Resolves one institution and CHECKS which one came back.
   *
   * The registry routes on capability, so all three providers are
   * interchangeable to it — nothing structural stops the ECB adapter answering
   * a request keyed for the Fed if a chain is misconfigured. This used to be
   * an `as unknown as T` cast, which is the compiler being told that mistake
   * is impossible. It is not; it is a one-line config error. So the narrowing
   * is a runtime assertion instead, and a mismatch fails loudly rather than
   * rendering euro rates under a US flag.
   */
  function run<T extends CentralBankPolicyState>(
    category: DataCategory,
    bank: T['centralBank'],
  ): Promise<Envelope<T>> {
    return resolve<T, 'policy-rates'>(deps, {
      category,
      capability: 'policy-rates',
      cacheKey: policyStateKey(bank),
      chain: container.config.chains[category],
      /*
       * Policy publication has no trading session. `true` selects the open
       * TTL, and both TTLs are identical for these categories precisely so
       * this flag cannot quietly mean anything.
       */
      marketOpen: true,
      attempt: async (provider, ctx: FetchContext) => {
        const state = await provider.fetchPolicyState(bank, ctx)
        if (state.centralBank !== bank) {
          throw new Error(
            `Provider "${provider.id}" answered a ${bank} request with ` +
              `${state.centralBank} state. Check the chain for "${category}".`,
          )
        }
        return { data: state as T, provenance: state.provenance }
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
