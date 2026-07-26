/**
 * The central-bank snapshot.
 *
 * Deliberately NOT part of `OverviewSnapshot`. The Overview does not render
 * policy state in Phase 6A, and folding it in would ship an unused payload on
 * every page load while coupling two things that are meant to stay separable.
 *
 * Each institution resolves independently and carries its own envelope, so one
 * source failing costs exactly one panel. There is no combined envelope and no
 * worst-of state: unlike the yield rows, these are three different
 * institutions, and "the ECB is unavailable" is not a statement about the Fed.
 */

import { isolate } from '~/application/shared/isolate'
import { withDeadline, DEFAULT_SNAPSHOT_BUDGET_MS } from '~/application/shared/deadline'
import type { Envelope } from '~/domain/shared/provenance'
import type {
  EcbPolicyState,
  FederalReservePolicyState,
  RiksbankPolicyState,
} from '~/domain/policy'

export interface CentralBanksSnapshot {
  federalReserve: Envelope<FederalReservePolicyState>
  ecb: Envelope<EcbPolicyState>
  riksbank: Envelope<RiksbankPolicyState>
  /** When this snapshot was assembled. */
  generatedAt: string
  /**
   * The OLDEST observation across the three, so a consumer can bound how
   * current the whole picture is.
   *
   * Conservative on purpose, and it is an observation age, never a policy age:
   * a rate last changed in October is not old data.
   */
  asOf: string
  correlationId: string
}

export interface CentralBanksDataSource {
  now(): Date
  correlationId(): string
  federalReserve(): Promise<Envelope<FederalReservePolicyState>>
  ecb(): Promise<Envelope<EcbPolicyState>>
  riksbank(): Promise<Envelope<RiksbankPolicyState>>
}

export async function getCentralBanksSnapshot(
  source: CentralBanksDataSource,
  budgetMs: number = DEFAULT_SNAPSHOT_BUDGET_MS,
): Promise<CentralBanksSnapshot> {
  const unit = <T>(label: string, run: () => Promise<Envelope<T>>) =>
    Number.isFinite(budgetMs)
      ? withDeadline(label, () => isolate(label, run), { budgetMs })
      : isolate(label, run)

  const [federalReserve, ecb, riksbank] = await Promise.all([
    unit('federal-reserve', () => source.federalReserve()),
    unit('ecb', () => source.ecb()),
    unit('riksbank', () => source.riksbank()),
  ])

  const generatedAt = source.now().toISOString()
  const observed = [federalReserve, ecb, riksbank]
    .map((envelope) =>
      envelope.state === 'ok' ||
      envelope.state === 'stale' ||
      envelope.state === 'fixture'
        ? envelope.provenance.asOf
        : null,
    )
    .filter((value): value is string => value !== null)
    .sort()

  return {
    federalReserve,
    ecb,
    riksbank,
    generatedAt,
    // With nothing resolved there is no observation to report, and the
    // assembly time is the only honest answer.
    asOf: observed[0] ?? generatedAt,
    correlationId: source.correlationId(),
  }
}
