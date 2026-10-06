/**
 * The lifecycle doors: how a surface creates, activates, moves, hands over,
 * edits, closes and reactivates a relationship, reads the lifecycle books
 * and the book's history, and sees what a closure would leave open. One
 * function per act; refusals are bounded codes, never free text; every act
 * runs through the same advisory context the other doors use, so what one
 * door writes the next one reads.
 *
 * The actor of an act is resolved here: the relationship's primary advisor,
 * as `recordClientUpdate` attributes a note (TD-106); for a new
 * relationship, the advisor it is given.
 */

import { createServerFn } from '@tanstack/react-start'
import {
  clientDirectory,
  type ClientDirectory,
  type DirectoryBook,
} from '~/application/advisory/clientDirectory'
import {
  activateClient,
  changeClientAdvisor,
  closeClient,
  closureReviewOf,
  createClient,
  editClient,
  lifecycleFeed,
  moveClientOffice,
  onboardingOverviewOf,
  reactivateClient,
  similarRelationships,
  type ActivateClientInput,
  type ChangeClientAdvisorInput,
  type CloseClientInput,
  type CreateClientInput,
  type CreateClientResult,
  type EditClientInput,
  type LifecycleActResult,
  type LifecycleFeedEntry,
  type LifecycleFeedFilter,
  type MoveClientOfficeInput,
  type ReactivateClientInput,
  type SimilarRelationship,
} from '~/application/advisory/lifecycle'
import {
  archiveOffice,
  createOffice,
  officeArchiveReview,
  reactivateOffice,
  updateOffice,
  type ArchiveOfficeInput,
  type CreateOfficeInput,
  type OfficeActResult,
  type ReactivateOfficeInput,
  type UpdateOfficeInput,
} from '~/application/advisory/officeLifecycle'
import type { AdvisoryContext } from '~/application/advisory/ports'
import type {
  Advisor,
  ClosureReview,
  Office,
  OnboardingOverview,
} from '~/domain/advisory'
import { WORKSPACE_ADVISOR_ID } from '~/presentation/advisory/advisorIdentity'
import { advisoryContext } from '../serverFns'

type Unavailable = { ok: false; code: 'SERVICE_UNAVAILABLE' }

function context(): Promise<AdvisoryContext> {
  return advisoryContext(
    () => import('../marketSource'),
    () => import('../container'),
  )
}

/** The relationship's own advisor acts on it; a surface never names the actor. */
async function actorFor(ctx: AdvisoryContext, clientId: string): Promise<string | null> {
  const client = await ctx.repositories.clients.byId(clientId)
  return client?.primaryAdvisorId ?? null
}

/* --------------------------------------------------------------- register */

export interface RegisterResponse {
  ok: true
  offices: readonly Office[]
  advisors: readonly Advisor[]
}

/** The offices and advisors a form chooses from — archived offices included, marked. */
export const getRegisterFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<RegisterResponse | Unavailable> => {
    try {
      const ctx = await context()
      const [offices, advisors] = await Promise.all([
        ctx.repositories.clients.offices(),
        ctx.repositories.clients.advisors(),
      ])
      return { ok: true, offices, advisors }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

/* ------------------------------------------------------------------ books */

export type LifecycleBookResponse = { ok: true; directory: ClientDirectory } | Unavailable

/** The directory for one lifecycle book: active (the default), onboarding, former, or all. */
export const getLifecycleBookFn = createServerFn({ method: 'POST' })
  .validator((book: DirectoryBook) => book)
  .handler(async ({ data: book }): Promise<LifecycleBookResponse> => {
    try {
      return { ok: true, directory: await clientDirectory(await context(), book) }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type LifecycleFeedResponse =
  { ok: true; entries: readonly LifecycleFeedEntry[] } | Unavailable

export const getLifecycleFeedFn = createServerFn({ method: 'POST' })
  .validator((filter: LifecycleFeedFilter) => filter)
  .handler(async ({ data: filter }): Promise<LifecycleFeedResponse> => {
    try {
      return { ok: true, entries: await lifecycleFeed(await context(), filter) }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* ----------------------------------------------------------------- create */

export type SimilarClientsResponse =
  { ok: true; similar: readonly SimilarRelationship[] } | Unavailable

export const similarClientsFn = createServerFn({ method: 'POST' })
  .validator((displayName: string) => displayName)
  .handler(async ({ data: displayName }): Promise<SimilarClientsResponse> => {
    try {
      return {
        ok: true,
        similar: await similarRelationships(await context(), displayName),
      }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type CreateClientRequest = Omit<CreateClientInput, 'by'>

export const createClientFn = createServerFn({ method: 'POST' })
  .validator((input: CreateClientRequest) => input)
  .handler(async ({ data }): Promise<CreateClientResult | Unavailable> => {
    try {
      return await createClient(await context(), { ...data, by: data.advisorId })
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* ------------------------------------------------------------------- acts */

type ActRequest<T extends { by: string }> = Omit<T, 'by'>

async function act<T extends { by: string; clientId: string }>(
  request: ActRequest<T>,
  run: (ctx: AdvisoryContext, input: T) => Promise<LifecycleActResult>,
): Promise<LifecycleActResult | Unavailable> {
  try {
    const ctx = await context()
    const by = await actorFor(ctx, request.clientId)
    if (!by) return { ok: false, code: 'NOT_FOUND' }
    return await run(ctx, { ...request, by } as T)
  } catch {
    return { ok: false, code: 'SERVICE_UNAVAILABLE' }
  }
}

export const activateClientFn = createServerFn({ method: 'POST' })
  .validator((input: ActRequest<ActivateClientInput>) => input)
  .handler(({ data }) => act(data, activateClient))

export const moveClientOfficeFn = createServerFn({ method: 'POST' })
  .validator((input: ActRequest<MoveClientOfficeInput>) => input)
  .handler(({ data }) => act(data, moveClientOffice))

export const changeClientAdvisorFn = createServerFn({ method: 'POST' })
  .validator((input: ActRequest<ChangeClientAdvisorInput>) => input)
  .handler(({ data }) => act(data, changeClientAdvisor))

export const editClientFn = createServerFn({ method: 'POST' })
  .validator((input: ActRequest<EditClientInput>) => input)
  .handler(({ data }) => act(data, editClient))

export const closeClientFn = createServerFn({ method: 'POST' })
  .validator((input: ActRequest<CloseClientInput>) => input)
  .handler(({ data }) => act(data, closeClient))

export const reactivateClientFn = createServerFn({ method: 'POST' })
  .validator((input: ActRequest<ReactivateClientInput>) => input)
  .handler(({ data }) => act(data, reactivateClient))

/* --------------------------------------------------------------- readings */

export type ClosureReviewResponse =
  { ok: true; review: ClosureReview } | { ok: false; code: 'NOT_FOUND' } | Unavailable

export const closureReviewFn = createServerFn({ method: 'POST' })
  .validator((clientId: string) => clientId)
  .handler(async ({ data: clientId }): Promise<ClosureReviewResponse> => {
    try {
      const review = await closureReviewOf(await context(), clientId)
      return review ? { ok: true, review } : { ok: false, code: 'NOT_FOUND' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type OnboardingOverviewResponse =
  | { ok: true; overview: OnboardingOverview }
  | { ok: false; code: 'NOT_FOUND' }
  | Unavailable

export const onboardingOverviewFn = createServerFn({ method: 'POST' })
  .validator((clientId: string) => clientId)
  .handler(async ({ data: clientId }): Promise<OnboardingOverviewResponse> => {
    try {
      const overview = await onboardingOverviewOf(await context(), clientId)
      return overview ? { ok: true, overview } : { ok: false, code: 'NOT_FOUND' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* ---------------------------------------------------------------- offices */

export type OfficeActRequest<T extends { by: string }> = Omit<T, 'by'>

async function officeAct<T extends { by: string }>(
  request: OfficeActRequest<T>,
  run: (ctx: AdvisoryContext, input: T) => Promise<OfficeActResult>,
): Promise<OfficeActResult | Unavailable> {
  try {
    const ctx = await context()
    /* The workspace's advisor answers for the office register. */
    return await run(ctx, { ...request, by: WORKSPACE_ADVISOR_ID } as T)
  } catch {
    return { ok: false, code: 'SERVICE_UNAVAILABLE' }
  }
}

export const createOfficeFn = createServerFn({ method: 'POST' })
  .validator((input: OfficeActRequest<CreateOfficeInput>) => input)
  .handler(({ data }) => officeAct(data, createOffice))

export const updateOfficeFn = createServerFn({ method: 'POST' })
  .validator((input: OfficeActRequest<UpdateOfficeInput>) => input)
  .handler(({ data }) => officeAct(data, updateOffice))

export const archiveOfficeFn = createServerFn({ method: 'POST' })
  .validator((input: OfficeActRequest<ArchiveOfficeInput>) => input)
  .handler(({ data }) => officeAct(data, archiveOffice))

export const reactivateOfficeFn = createServerFn({ method: 'POST' })
  .validator((input: OfficeActRequest<ReactivateOfficeInput>) => input)
  .handler(({ data }) => officeAct(data, reactivateOffice))

export type OfficeArchiveReviewResponse =
  | { ok: true; activeClients: readonly { id: string; displayName: string }[] }
  | Unavailable

export const officeArchiveReviewFn = createServerFn({ method: 'POST' })
  .validator((officeId: string) => officeId)
  .handler(async ({ data: officeId }): Promise<OfficeArchiveReviewResponse> => {
    try {
      return {
        ok: true,
        activeClients: await officeArchiveReview(await context(), officeId),
      }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })
