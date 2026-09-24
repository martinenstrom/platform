/**
 * The only door between the browser and the relationship record.
 *
 * Every client surface reads through here and writes through here, exactly
 * as the institution's surfaces do through `infrastructure/analysis/serverFns`.
 * The fitness rule `no-ui-import-of-infrastructure` allows a component to
 * import this module and nothing else in the layer, so the repositories, the
 * seed and the clock never reach the client bundle.
 *
 * One function per act; refusals are bounded codes, never free text; one
 * context per server process so a confirmed update survives the next page
 * load.
 */

import { createServerFn } from '@tanstack/react-start'
import {
  askAboutClient,
  type AskAboutClientResult,
} from '~/application/advisory/askAboutClient'
import { client360, type Client360 } from '~/application/advisory/client360'
import {
  clientDirectory,
  type ClientDirectory,
} from '~/application/advisory/clientDirectory'
import {
  completeCommitment,
  type CompleteCommitmentResult,
} from '~/application/advisory/completeCommitment'
import {
  confirmClientUpdate,
  type ConfirmClientUpdateResult,
  type ItemDecision,
} from '~/application/advisory/confirmClientUpdate'
import { prepareMeeting } from '~/application/advisory/meetingPrep'
import {
  disposePriority,
  sentinelBrief,
  type DisposeInput,
  type DisposeResult,
  type SentinelBrief,
} from '~/application/advisory/sentinel'
import type { AdvisoryContext } from '~/application/advisory/ports'
import {
  recordClientUpdate,
  type RecordClientUpdateResult,
} from '~/application/advisory/recordClientUpdate'
import type {
  Importance,
  InteractionSource,
  InteractionType,
  MeetingPrep,
} from '~/domain/advisory'
import { FakeClock, systemClock, type Clock } from '~/domain/shared/clock'

export type AdvisoryReadFailure = 'NOT_FOUND' | 'SERVICE_UNAVAILABLE'

let cached: AdvisoryContext | null = null

/**
 * The clock the synthetic record is seeded and read against.
 *
 * The seed is built relative to the clock's date, so the demonstration stays
 * alive on any day. A demonstration or a screenshot that must not drift sets
 * `ADVISORY_REFERENCE_DATE=YYYY-MM-DD` and gets a clock pinned to that
 * morning; otherwise the system clock. Tests never come through here: they
 * build the context with a `FakeClock` directly.
 *
 * The context lives for the server process. What the advisor confirms stays
 * across page loads and vanishes when the process restarts — a synthetic
 * store, not persistence (TD-104).
 */
function advisoryClock(): Clock {
  const reference = process.env.ADVISORY_REFERENCE_DATE?.trim()
  if (reference && /^\d{4}-\d{2}-\d{2}$/.test(reference)) {
    return new FakeClock(`${reference}T09:00:00.000Z`)
  }
  return systemClock
}

async function getContext(): Promise<AdvisoryContext> {
  if (cached) return cached
  const { createAdvisoryContext } = await import('./container')
  cached = createAdvisoryContext(advisoryClock())
  return cached
}

export type ClientDirectoryResponse =
  { ok: true; directory: ClientDirectory } | { ok: false; code: AdvisoryReadFailure }

export const getClientDirectoryFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ClientDirectoryResponse> => {
    try {
      const context = await getContext()
      return { ok: true, directory: await clientDirectory(context) }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export type Client360Response =
  { ok: true; view: Client360 } | { ok: false; code: AdvisoryReadFailure }

export const getClient360Fn = createServerFn({ method: 'POST' })
  .validator((clientId: string) => clientId)
  .handler(async ({ data: clientId }): Promise<Client360Response> => {
    try {
      const context = await getContext()
      const view = await client360(context, clientId)
      return view ? { ok: true, view } : { ok: false, code: 'NOT_FOUND' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type MeetingPrepResponse =
  { ok: true; prep: MeetingPrep } | { ok: false; code: AdvisoryReadFailure }

export const getMeetingPrepFn = createServerFn({ method: 'POST' })
  .validator((clientId: string) => clientId)
  .handler(async ({ data: clientId }): Promise<MeetingPrepResponse> => {
    try {
      const context = await getContext()
      const prep = await prepareMeeting(context, clientId)
      return prep ? { ok: true, prep } : { ok: false, code: 'NOT_FOUND' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export interface RecordClientUpdateRequest {
  clientId: string
  noteText: string
  interactionDate?: string
  interactionType?: InteractionType | null
  source?: InteractionSource
  importance?: Importance
}

export type RecordClientUpdateResponse =
  RecordClientUpdateResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const recordClientUpdateFn = createServerFn({ method: 'POST' })
  .validator((input: RecordClientUpdateRequest) => input)
  .handler(async ({ data }): Promise<RecordClientUpdateResponse> => {
    try {
      const context = await getContext()
      return await recordClientUpdate(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export interface ConfirmClientUpdateRequest {
  candidateId: string
  decisions: readonly ItemDecision[]
}

export type ConfirmClientUpdateResponse =
  ConfirmClientUpdateResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const confirmClientUpdateFn = createServerFn({ method: 'POST' })
  .validator((input: ConfirmClientUpdateRequest) => input)
  .handler(async ({ data }): Promise<ConfirmClientUpdateResponse> => {
    try {
      const context = await getContext()
      return await confirmClientUpdate(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type CompleteCommitmentResponse =
  CompleteCommitmentResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const completeCommitmentFn = createServerFn({ method: 'POST' })
  .validator((commitmentId: string) => commitmentId)
  .handler(async ({ data: commitmentId }): Promise<CompleteCommitmentResponse> => {
    try {
      const context = await getContext()
      return await completeCommitment(context, commitmentId)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type AskAboutClientResponse =
  AskAboutClientResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

export const askAboutClientFn = createServerFn({ method: 'POST' })
  .validator((input: { clientId: string; question: string }) => input)
  .handler(async ({ data }): Promise<AskAboutClientResponse> => {
    try {
      const context = await getContext()
      return await askAboutClient(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* --------------------------------------------------------------- Sentinel */

export type SentinelBriefResponse =
  { ok: true; brief: SentinelBrief } | { ok: false; code: AdvisoryReadFailure }

/** The morning brief: every client's one priority, ranked, on the advisory clock. */
export const getSentinelBriefFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<SentinelBriefResponse> => {
    try {
      const context = await getContext()
      return { ok: true, brief: await sentinelBrief(context) }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export type DisposePriorityResponse =
  DisposeResult | { ok: false; code: 'SERVICE_UNAVAILABLE' }

/** The advisor's word on a priority: reviewed, snoozed until a date, or dismissed. */
export const disposePriorityFn = createServerFn({ method: 'POST' })
  .validator((input: DisposeInput) => input)
  .handler(async ({ data }): Promise<DisposePriorityResponse> => {
    try {
      const context = await getContext()
      return await disposePriority(context, data)
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })
