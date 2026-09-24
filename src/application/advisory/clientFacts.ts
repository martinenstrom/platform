/**
 * The one assembly of everything the rules read about a client.
 *
 * Health, signals, the next best action and the meeting briefing are all
 * derived from this shape, so it is built once per request and handed to
 * every derivation — never rebuilt by a surface from parts.
 */

import { balanceSheetOf, type ClientFacts, type ClientId } from '~/domain/advisory'
import { todayOf, type AdvisoryContext } from './ports'

export async function assembleClientFacts(
  context: AdvisoryContext,
  clientId: ClientId,
): Promise<ClientFacts | null> {
  const { repositories } = context
  const client = await repositories.clients.byId(clientId)
  if (!client) return null

  const [
    assets,
    liabilities,
    portfolio,
    goals,
    interactions,
    contextFacts,
    commitments,
    events,
    opportunities,
  ] = await Promise.all([
    repositories.wealth.assetsOf(clientId),
    repositories.wealth.liabilitiesOf(clientId),
    repositories.portfolios.portfolioOf(clientId),
    repositories.goals.goalsOf(clientId),
    repositories.interactions.interactionsOf(clientId),
    repositories.context.factsOf(clientId),
    repositories.commitments.commitmentsOf(clientId),
    repositories.events.eventsOf(clientId),
    repositories.opportunities.opportunitiesOf(clientId),
  ])

  return {
    client,
    balanceSheet: balanceSheetOf(assets, liabilities),
    portfolio,
    goals,
    interactions,
    contextFacts,
    commitments,
    events,
    opportunities,
    liabilities,
    today: todayOf(context),
  }
}
