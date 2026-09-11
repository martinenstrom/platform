import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/markets` is the home page's old address.
 *
 * The market overview lived here for exactly one gate. When the institution
 * was moved off `/` and onto `/headquarters`, the market experience returned
 * to the home page it came from — and keeping a second route rendering the
 * same `LightCommandCenter` would have left the product maintaining two copies
 * of one dashboard and offering them as two destinations in the navigation.
 *
 * There was nothing market-specific left here to preserve: this route's own
 * content — a ticker list of indices, FX and crypto — was already absorbed
 * into the overview, which also carries yields, the curve, sectors, sentiment,
 * news and the watchlist. So this redirects rather than duplicating, and the
 * URL keeps working for anything already pointing at it.
 *
 * `/watchlist` is untouched: it is a genuinely distinct market drill-down and
 * remains its own page.
 */
export const Route = createFileRoute('/markets')({
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})
