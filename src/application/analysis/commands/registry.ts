/**
 * Every production command, in one place.
 *
 * A registry rather than a convention, so the declaration lists —
 * `VERSION_GUARDED_COMMANDS` and `REASON_REQUIRED_COMMANDS` — can be asserted
 * against the commands that actually exist. Without it, "the approved list" and
 * "what the code does" are two documents that agree until they do not.
 *
 * Definitions are factories over the organization because authorization is
 * data-driven: a command's mandate is checked against the seeded firm, not
 * against a hard-coded department id.
 */

import type { Organization } from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { openInvestmentCase } from './openInvestmentCase'
import { instantiatePlaybook } from './instantiatePlaybook'
import { proposeThesis } from './proposeThesis'
import { startAgentRun } from './startAgentRun'
import { failAgentRun } from './failAgentRun'

/* eslint-disable @typescript-eslint/no-explicit-any -- a heterogeneous list of
   definitions has no useful common Input/Result; every consumer reads only the
   declaration fields, which are the same on all of them. */
export type AnyCommandDefinition = CommandDefinition<any, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

export function productionCommands(
  organization: Organization,
): readonly AnyCommandDefinition[] {
  return [
    openInvestmentCase(organization),
    instantiatePlaybook(organization),
    proposeThesis(organization),
    startAgentRun(organization),
    failAgentRun(organization),
  ]
}
