/**
 * Every case the firm is holding, as a queue rather than a table.
 *
 * The Headquarters entry point. A portfolio manager opening this needs to know
 * what is waiting on them and what is waiting on somebody else — not an
 * inventory of rows.
 *
 * ## The same standing as the case page
 *
 * Each entry carries the standing produced by `standingForCase`, the identical
 * derivation the case page uses. A cheaper approximation for the list is
 * precisely how a queue starts disagreeing with the case it links to, and "the
 * list said Risk, the case said the CIO" is the firm holding two beliefs about
 * where its own work is.
 *
 * ## Ordering is institutional, not chronological
 *
 * Newest-first is a filing convention. What a reader needs first is what is
 * owed: cases waiting on somebody, before cases already settled. Within each
 * group the repository's order is preserved, which is `openedAt` descending.
 */

import type { CaseStanding, InvestmentCase, Organization } from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import { standingForCase } from './caseStandingFor'

export interface CaseListing {
  investmentCase: InvestmentCase
  standing: CaseStanding
}

/**
 * Settled last.
 *
 * Not sorted by stage name, and not by "progress": a case in `blocked` is not
 * further along than one in `research`, and ranking them would invent a
 * hierarchy the firm does not have. The only ordering claim made here is that
 * work still owed comes before work finished.
 */
function outstandingFirst(a: CaseListing, b: CaseListing): number {
  if (a.standing.settled === b.standing.settled) return 0
  return a.standing.settled ? 1 : -1
}

export async function caseListing(input: {
  repositories: AnalysisRepositories
  organization: Organization
  /** Domain time, from the Clock. Never the database's. */
  now: string
}): Promise<readonly CaseListing[]> {
  const { repositories, organization, now } = input

  const cases = await repositories.cases.list()

  /*
   * Sequential rather than parallel. Each standing runs several queries, and
   * firing them all at once for every case would take the connection pool from
   * the request path -- the page would get slower under exactly the load that
   * makes it matter. See TD-71.
   */
  const listings: CaseListing[] = []
  for (const investmentCase of cases) {
    listings.push({
      investmentCase,
      standing: await standingForCase({
        repositories,
        organization,
        investmentCase,
        now,
      }),
    })
  }

  /* `sort` is stable in ES2019+, so the repository's order survives within groups. */
  return listings.sort(outstandingFirst)
}
