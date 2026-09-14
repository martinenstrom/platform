import type { ReactNode } from 'react'
import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { AppLayout } from '~/components/layout/AppLayout'
import { JarvisPresence } from '~/components/jarvis/JarvisPresence'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'dark' },
      { title: 'Financial OS' },
      {
        name: 'description',
        /*
         * This used to claim every value in the app was example data. That
         * stopped being true once the Overview, Bevakning and Marknader routes
         * began serving real quotes. Neither blanket claim is accurate any
         * more, so this states the mix instead of picking a side.
         */
        content:
          'Stack är ett operativsystem för analysagenter, med portfölj- och marknadsöversikt. Delar av innehållet är fördröjda marknadsnoteringar, övrigt är exempeldata.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

/**
 * The root of every page, and the one component that never unmounts.
 *
 * One shell for every route. `/markets` once bypassed it as a full-bleed page;
 * that route has redirected to `/` since the market overview returned home,
 * so the branch could never render and is gone. Which routes own their own
 * shell is `AppLayout`'s decision, and it is made in one place.
 *
 * This is also the seam the persistent presence mounts on. A sibling of the
 * `Outlet` here keeps its identity and state while the routed page beneath it
 * changes — measured, not assumed: see `docs/jarvis-hq-measurement.md` §5.
 * JARVIS is that sibling: mounted once, beside every page, never inside one.
 */
function RootComponent() {
  return (
    <RootDocument>
      <AppLayout>
        <Outlet />
      </AppLayout>
      <JarvisPresence />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="sv">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
