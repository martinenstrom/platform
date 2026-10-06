/**
 * What a client surface may ask the record to do with the relationship's
 * lifecycle. The route implements these over the lifecycle server
 * functions and re-reads the page afterwards; a test implements them in
 * memory. The surface never names the actor: the record resolves it.
 */

import type {
  ActivateClientInput,
  ChangeClientAdvisorInput,
  CloseClientInput,
  EditClientInput,
  LifecycleActResult,
  MoveClientOfficeInput,
  ReactivateClientInput,
} from '~/application/advisory/lifecycle'
import type { Advisor, ClosureReview, Office } from '~/domain/advisory'
import type { Unavailable } from '../clientActions'

export type ActRequest<T extends { by: string }> = Omit<T, 'by'>

export interface LifecycleRegister {
  offices: readonly Office[]
  advisors: readonly Advisor[]
}

export interface LifecycleActions {
  register(): Promise<({ ok: true } & LifecycleRegister) | Unavailable>
  closureReview(
    clientId: string,
  ): Promise<{ ok: true; review: ClosureReview } | { ok: false; code: string }>
  activate(
    input: ActRequest<ActivateClientInput>,
  ): Promise<LifecycleActResult | Unavailable>
  move(
    input: ActRequest<MoveClientOfficeInput>,
  ): Promise<LifecycleActResult | Unavailable>
  changeAdvisor(
    input: ActRequest<ChangeClientAdvisorInput>,
  ): Promise<LifecycleActResult | Unavailable>
  edit(input: ActRequest<EditClientInput>): Promise<LifecycleActResult | Unavailable>
  close(input: ActRequest<CloseClientInput>): Promise<LifecycleActResult | Unavailable>
  reactivate(
    input: ActRequest<ReactivateClientInput>,
  ): Promise<LifecycleActResult | Unavailable>
}

export type LifecycleAct =
  'activate' | 'edit' | 'move' | 'advisor' | 'close' | 'reactivate'
