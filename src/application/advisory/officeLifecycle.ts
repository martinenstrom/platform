/**
 * The office lifecycle as acts on the register: an office is created,
 * edited, archived and reopened. Archiving is blocked while active
 * relationships remain — they are moved or closed first — unless a
 * destination is named, in which case every one of them is moved in the
 * same unit of work, each with its own move event, before the office is
 * archived. An office's id never changes; its history stays.
 */

import {
  normalisedName,
  type AdvisorId,
  type ClientId,
  type LifecycleEvent,
  type Office,
  type OfficeId,
} from '~/domain/advisory'
import { moveClientOffice, recordEvent } from './lifecycle'
import { todayOf, type AdvisoryContext } from './ports'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u

export interface CreateOfficeInput {
  displayName: string
  shortName?: string | null
  city: string
  description?: string | null
  by: AdvisorId
}

export type OfficeActResult =
  | { ok: true; office: Office; event: LifecycleEvent }
  | {
      ok: false
      code: 'INVALID' | 'NOT_FOUND' | 'NOT_ALLOWED' | 'HAS_ACTIVE_CLIENTS'
      activeClients?: readonly { id: ClientId; displayName: string }[]
    }

/** An office's id is its name made into a path, made unique: readable in a URL, never reused. */
function officeIdFrom(displayName: string, taken: ReadonlySet<string>): string {
  const slug = normalisedName(displayName).replace(/\s+/gu, '-').slice(0, 40) || 'kontor'
  let candidate = `of-${slug}`
  let n = 2
  while (taken.has(candidate)) candidate = `of-${slug}-${n++}`
  return candidate
}

export async function createOffice(
  context: AdvisoryContext,
  input: CreateOfficeInput,
): Promise<OfficeActResult> {
  const { repositories } = context
  const displayName = input.displayName.trim()
  const city = input.city.trim()
  if (displayName.length < 2 || city.length < 1) return { ok: false, code: 'INVALID' }
  const existing = await repositories.clients.offices()
  const office: Office = {
    id: officeIdFrom(displayName, new Set(existing.map((o) => o.id))),
    name: displayName,
    city,
    displayName,
    shortName:
      input.shortName?.trim() ||
      displayName.slice(0, 7) + (displayName.length > 7 ? '.' : ''),
    status: 'active',
    archivedAt: null,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  }
  return repositories.transaction(async () => {
    await repositories.clients.addOffice(office)
    const event = await recordEvent(context, {
      subject: 'office',
      subjectId: office.id,
      kind: 'OFFICE_CREATED',
      effectiveDate: todayOf(context),
      by: input.by,
      detail: { displayName: office.displayName, city: office.city },
      note: null,
    })
    return { ok: true, office, event }
  })
}

export interface UpdateOfficeInput {
  officeId: OfficeId
  displayName?: string
  shortName?: string
  city?: string
  description?: string | null
  by: AdvisorId
}

export async function updateOffice(
  context: AdvisoryContext,
  input: UpdateOfficeInput,
): Promise<OfficeActResult> {
  const { repositories } = context
  const office = await repositories.clients.officeById(input.officeId)
  if (!office) return { ok: false, code: 'NOT_FOUND' }
  const changed: string[] = []
  const updated: Office = { ...office }
  if (
    input.displayName !== undefined &&
    input.displayName.trim() !== office.displayName
  ) {
    if (input.displayName.trim().length < 2) return { ok: false, code: 'INVALID' }
    updated.displayName = input.displayName.trim()
    updated.name = input.displayName.trim()
    changed.push('displayName')
  }
  if (input.shortName !== undefined && input.shortName.trim() !== office.shortName) {
    updated.shortName = input.shortName.trim()
    changed.push('shortName')
  }
  if (input.city !== undefined && input.city.trim() !== office.city) {
    updated.city = input.city.trim()
    changed.push('city')
  }
  if (
    input.description !== undefined &&
    (input.description ?? '') !== (office.description ?? '')
  ) {
    if (input.description?.trim()) updated.description = input.description.trim()
    else delete updated.description
    changed.push('description')
  }
  if (changed.length === 0) return { ok: false, code: 'NOT_ALLOWED' }
  return repositories.transaction(async () => {
    await repositories.clients.saveOffice(updated)
    const event = await recordEvent(context, {
      subject: 'office',
      subjectId: office.id,
      kind: 'OFFICE_UPDATED',
      effectiveDate: todayOf(context),
      by: input.by,
      detail: { fields: changed.join(',') },
      note: null,
    })
    return { ok: true, office: updated, event }
  })
}

/** The active relationships an archive would strand — the review shown before the act. */
export async function officeArchiveReview(
  context: AdvisoryContext,
  officeId: OfficeId,
): Promise<readonly { id: ClientId; displayName: string }[]> {
  const clients = await context.repositories.clients.list()
  return clients
    .filter((c) => c.officeId === officeId && c.lifecycle.status !== 'former')
    .map((c) => ({ id: c.id, displayName: c.displayName }))
}

export interface ArchiveOfficeInput {
  officeId: OfficeId
  effectiveDate?: string
  /** Where the office's active relationships move first; without it, any active client blocks the archive. */
  transferToOfficeId?: OfficeId | null
  note?: string | null
  by: AdvisorId
}

export async function archiveOffice(
  context: AdvisoryContext,
  input: ArchiveOfficeInput,
): Promise<OfficeActResult> {
  const { repositories } = context
  const office = await repositories.clients.officeById(input.officeId)
  if (!office) return { ok: false, code: 'NOT_FOUND' }
  if (office.status === 'archived') return { ok: false, code: 'NOT_ALLOWED' }
  const effectiveDate = input.effectiveDate ?? todayOf(context)
  if (!ISO_DATE.test(effectiveDate)) return { ok: false, code: 'INVALID' }
  const active = await officeArchiveReview(context, office.id)
  if (active.length > 0 && !input.transferToOfficeId)
    return { ok: false, code: 'HAS_ACTIVE_CLIENTS', activeClients: active }
  if (input.transferToOfficeId) {
    const destination = await repositories.clients.officeById(input.transferToOfficeId)
    if (!destination || destination.status !== 'active' || destination.id === office.id)
      return { ok: false, code: 'INVALID' }
  }
  return repositories.transaction(async () => {
    for (const client of active) {
      const moved = await moveClientOffice(context, {
        clientId: client.id,
        toOfficeId: input.transferToOfficeId!,
        effectiveDate,
        note: `Flyttad när ${office.displayName} arkiverades.`,
        by: input.by,
      })
      if (!moved.ok) throw new Error(`transfer refused for ${client.id}: ${moved.code}`)
    }
    const updated: Office = { ...office, status: 'archived', archivedAt: effectiveDate }
    await repositories.clients.saveOffice(updated)
    const event = await recordEvent(context, {
      subject: 'office',
      subjectId: office.id,
      kind: 'OFFICE_ARCHIVED',
      effectiveDate,
      by: input.by,
      detail: {
        transferredClients: active.length,
        transferToOfficeId: input.transferToOfficeId ?? null,
      },
      note: input.note?.trim() || null,
    })
    return { ok: true, office: updated, event }
  })
}

export interface ReactivateOfficeInput {
  officeId: OfficeId
  effectiveDate?: string
  by: AdvisorId
}

export async function reactivateOffice(
  context: AdvisoryContext,
  input: ReactivateOfficeInput,
): Promise<OfficeActResult> {
  const { repositories } = context
  const office = await repositories.clients.officeById(input.officeId)
  if (!office) return { ok: false, code: 'NOT_FOUND' }
  if (office.status !== 'archived') return { ok: false, code: 'NOT_ALLOWED' }
  const effectiveDate = input.effectiveDate ?? todayOf(context)
  if (!ISO_DATE.test(effectiveDate)) return { ok: false, code: 'INVALID' }
  return repositories.transaction(async () => {
    const updated: Office = { ...office, status: 'active', archivedAt: null }
    await repositories.clients.saveOffice(updated)
    const event = await recordEvent(context, {
      subject: 'office',
      subjectId: office.id,
      kind: 'OFFICE_REACTIVATED',
      effectiveDate,
      by: input.by,
      detail: { archivedAt: office.archivedAt },
      note: null,
    })
    return { ok: true, office: updated, event }
  })
}
