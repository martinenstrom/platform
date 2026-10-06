/**
 * The advisor's identity as a surface shows it: the full name, the role and
 * the portrait beside the first name the record carries.
 *
 * Deliberately a presentation map, not a field on the advisor record: the
 * record names an advisor by first name because that is how a client's
 * page speaks of them ("Rådgivare Martin"), and a portrait is presentation
 * in the same way a client's is (`portraits.ts`). The JARVIS workspace is
 * read as one advisor's book; which advisor is the deployment's to say
 * (TD-106), and until an operator is configured for the workspace the
 * synthetic deployment reads it as Martin's.
 */

import type { Advisor } from '~/domain/advisory'

export interface AdvisorIdentity {
  advisorId: string
  /** The name as it stands on the identity mark; the record's first name otherwise. */
  fullName: string
  roleTitle: string
  portraitUrl: string | null
}

const IDENTITIES: Readonly<Record<string, Omit<AdvisorIdentity, 'advisorId'>>> =
  Object.freeze({
    'adv-martin': {
      fullName: 'Martin Enström',
      roleTitle: 'Private Banking',
      portraitUrl: '/data/advisors/martin-enstrom.jpg',
    },
  })

/** The advisor the synthetic workspace is read for, until an operator is configured. */
export const WORKSPACE_ADVISOR_ID = 'adv-martin'

/** The identity for an advisor id, with the record's own name where the map has none. */
export function advisorIdentityOf(
  advisor: Pick<Advisor, 'id' | 'displayName'> | string,
): AdvisorIdentity {
  const id = typeof advisor === 'string' ? advisor : advisor.id
  const known = IDENTITIES[id]
  return {
    advisorId: id,
    fullName: known?.fullName ?? (typeof advisor === 'string' ? id : advisor.displayName),
    roleTitle: known?.roleTitle ?? 'Private Banking',
    portraitUrl: known?.portraitUrl ?? null,
  }
}

/** The workspace's advisor, as the bar and the book's hero show them. */
export function workspaceAdvisor(): AdvisorIdentity {
  return advisorIdentityOf(WORKSPACE_ADVISOR_ID)
}

/**
 * The workspace's advisor as the record carries them: the id, and the
 * first name a client's page speaks of. What a new Financial OS is set up
 * for, before its first relationship.
 */
export function workspaceAdvisorRecord(): Advisor {
  const identity = workspaceAdvisor()
  return {
    id: identity.advisorId,
    displayName: identity.fullName.split(' ')[0] ?? identity.fullName,
  }
}
