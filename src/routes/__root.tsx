import type { ReactNode } from 'react'
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'
import { AppLayout } from '~/components/layout/AppLayout'
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

function RootComponent() {
  /*
   * `/markets` is the full-bleed light market overview and brings its own
   * navigation column; every other route, the Command Center included, keeps
   * the dark institutional shell.
   *
   * It used to be `/`. The Command Center took that route, and the market
   * screen kept its layout rather than being rebuilt into the shell — moving
   * it was an information-architecture decision, not a visual one.
   */
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const fullBleed = pathname === '/markets'

  return (
    <RootDocument>
      {fullBleed ? (
        <Outlet />
      ) : (
        <AppLayout>
          <Outlet />
        </AppLayout>
      )}
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
