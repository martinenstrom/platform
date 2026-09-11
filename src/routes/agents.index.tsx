import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/agents` is now a way into the floor, not a floor of its own.
 *
 * The Command Center v1 gate merged the desk directory and the case list into
 * one Headquarters, because the firm has one investment floor and had two
 * screens claiming to be it — one of which was already called *Huvudkontor*
 * while holding no desks.
 *
 * The route is kept and redirects rather than being deleted: links, bookmarks
 * and the desk pages beneath it (`/agents/$departmentId`) all still resolve,
 * and a URL the firm has been using should not start returning nothing because
 * the navigation was reorganised.
 */
export const Route = createFileRoute('/agents/')({
  beforeLoad: () => {
    throw redirect({ to: '/headquarters' })
  },
})
