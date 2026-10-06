import type { ReactNode } from 'react'
import {
  Outlet,
  createRootRoute,
  HeadContent,
  redirect,
  Scripts,
} from '@tanstack/react-router'
import { AppLayout } from '~/components/layout/AppLayout'
import { JarvisPresence } from '~/components/jarvis/JarvisPresence'
import { getCurrentOperatorFn } from '~/infrastructure/analysis/serverFns'
import { getSystemStatusFn } from '~/infrastructure/platform/serverFns'
import { systemGate } from '~/presentation/platform/systemText'
import appCss from '~/styles/app.css?url'

/*
 * The dossier's display serif. Fetched from Google Fonts; where it does not
 * arrive, `--font-display` falls back to Georgia and nothing breaks.
 */
const DISPLAY_FONT_URL =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap'

export const Route = createRootRoute({
  /*
   * Who is here, for the shell's identity mark — the same server-asserted
   * operator the home page greets — and what the system is: whether the
   * record exists and opened. Read once and kept, since neither changes
   * within a session; a page that acts on the system invalidates the
   * router. No record yet sends the reader to the first-run page; a record
   * that refused to open sends them to Recovery Mode, before anything else
   * is read.
   */
  loader: async ({ location }) => {
    const [operator, system] = await Promise.all([getCurrentOperatorFn(), getSystemStatusFn()])
    const gate = systemGate(system, location.pathname)
    if (gate) throw redirect({ to: gate })
    return { ...operator, system }
  },
  staleTime: Infinity,
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
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: DISPLAY_FONT_URL },
    ],
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
      {/* First in the document, so the keyboard reaches the rail before the page: Tab lands on the spine, then the work. */}
      <JarvisPresence />
      <AppLayout>
        <Outlet />
      </AppLayout>
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
