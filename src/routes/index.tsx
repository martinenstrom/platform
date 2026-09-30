import { createFileRoute } from '@tanstack/react-router'
import { LightCommandCenter } from '~/components/lightDashboard/LightCommandCenter'
import { getOverviewSnapshotFn } from '~/infrastructure/marketData/serverFns'
import { getCurrentOperatorFn } from '~/infrastructure/analysis/serverFns'
import { getMarketImpactFn } from '~/infrastructure/advisory/serverFns'

/**
 * Kommandocentralen — the Financial OS home, and the answer to *what is
 * happening in the world?*
 *
 * ## Why the market is here and the firm is not
 *
 * This page has changed hands twice, and the second move is the one that
 * settled it. The Command Center v1 gate put the institution on `/` and moved
 * the market overview to `/markets`; the ruling that followed reversed the
 * placement. Opening Financial OS lands on the world, not on the firm's own
 * floor — and the firm's floor is a destination you go to, at `/headquarters`,
 * where the CIO, the desks, the control functions and the work all live
 * together.
 *
 * **Nothing here was rebuilt for the move.** This is the same truthful market
 * experience that has been through the chart, globe and hero work, rendered by
 * the same `LightCommandCenter` from the same `OverviewSnapshot`. The route
 * moved; the screen did not change.
 *
 * ## What may never appear on this page
 *
 * No Agent Network, no CIO synthesis, no governance floor, no institutional
 * workflow. Those are the firm's own state, they belong on Huvudkontoret, and
 * rendering them in both places is what made the two pages one page twice
 * over. Market context is the whole subject here.
 *
 * **Nor the client work.** Sentinel's priorities and Market-to-Client's
 * affected clients stood here as modules for one stage, and the market
 * command centre became a client page with a globe on it. They live in the
 * JARVIS workspace now — `/sentinel`, `/market-impact` — behind the gateway
 * in the rail. What remains of them here is the quietest possible pointer:
 * a muted "3 klienter" beside a market row a client is meaningfully exposed
 * to, linking into that workspace. Nothing else about clients renders here.
 *
 * ## The one thing read from the firm: who is here
 *
 * The greeting used to address a literal — *Anders*, of *Private Banking* —
 * a person the product had never resolved. It now addresses the server-trusted
 * configured operator, resolved against the seeded organisation, and nobody
 * when none is configured. That is identity, not institutional state: it says
 * who the product is talking to, never what the firm thinks, and it is the
 * same fact the command ledger records as the actor.
 *
 * Data is assembled server-side into one `OverviewSnapshot` and handed to the
 * component as a prop, so first paint is fully rendered — no spinner, no layout
 * shift, and one coherent `asOf` across every panel.
 */
export const Route = createFileRoute('/')({
  loader: async () => {
    const [snapshot, operator, marketImpact] = await Promise.all([
      getOverviewSnapshotFn(),
      getCurrentOperatorFn(),
      /*
       * Market-to-Client: which clients the material moves touch, for the
       * row marks only. Read from the same market snapshot and the same
       * record, on the same clock; absent when the record cannot answer,
       * and the market screen renders complete without it.
       */
      getMarketImpactFn(),
    ])
    return { snapshot, operator, marketImpact }
  },
  component: HomePage,
})

function HomePage() {
  const { snapshot, operator, marketImpact } = Route.useLoaderData()
  return (
    <LightCommandCenter
      snapshot={snapshot}
      operator={operator.ok ? operator.operator : undefined}
      marketImpact={marketImpact.ok ? marketImpact.brief : undefined}
    />
  )
}
