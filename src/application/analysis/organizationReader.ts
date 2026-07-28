/**
 * The seeded organization, as the commands see it.
 *
 * Separate from `AnalysisRepositories` because the organization is not case
 * data: it changes only by migration, the runtime holds `SELECT` and nothing
 * else on it, and every command needs it before any transaction opens — to
 * resolve the actor.
 */

import type { Organization } from '~/domain/analysis'

export interface SeededOrganization {
  organization: Organization
  /**
   * Which seed produced it.
   *
   * Snapshotted onto every command, so a later structural change cannot
   * silently rewrite the authority a past command ran under.
   */
  seedVersion: string
  /** Checksum of the organization as it stands. Cache key and drift detector. */
  seedChecksum: string
}

export interface OrganizationReader {
  /** Cached per process; reloaded when the seed checksum changes. */
  load(): Promise<SeededOrganization>
}

export class OrganizationNotSeededError extends Error {
  constructor() {
    super(
      'The analysis organization is not seeded. Commands resolve their actors ' +
        'against it, so the runtime cannot start without one — run the migrations.',
    )
    this.name = 'OrganizationNotSeededError'
  }
}
