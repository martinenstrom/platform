/**
 * The command centre, rendered against a directory the application derived
 * from the synthetic seed — the same read model the route receives, so the
 * page is held to numbers the rules produced rather than rows written here.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  clientDirectory,
  type ClientDirectory,
} from '~/application/advisory/clientDirectory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { renderInRouter } from '~/test/renderInRouter'
import { ClientCommandCentre } from './ClientCommandCentre'

const TODAY = '2026-09-23'

async function directoryAt(today = TODAY): Promise<ClientDirectory> {
  return clientDirectory({
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(today)),
    clock: new FakeClock(`${today}T10:00:00.000Z`),
  })
}

const STUBS = ['/clients/$clientId'] as const

describe('the client command centre', () => {
  it('shows the metrics and one row per client, each linking to its page', async () => {
    const directory = await directoryAt()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} />,
      STUBS,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: /klientintelligens/i }),
    ).toBeInTheDocument()
    const metrics = screen.getByRole('region', { name: 'Nyckeltal' })
    expect(within(metrics).getByText('Klienter').nextElementSibling).toHaveTextContent(
      '7',
    )
    expect(
      within(metrics).getByText('Försenade åtaganden').nextElementSibling,
    ).toHaveTextContent(String(directory.metrics.overdueCommitments))

    const list = screen.getByRole('region', { name: 'Klientlista' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(7)
    const alvarsson = links.find((link) => link.textContent?.includes('Henrik Alvarsson'))
    expect(alvarsson).toHaveAttribute('href', '/clients/cl-alvarsson')
    expect(alvarsson).toHaveTextContent('21,0 MSEK')
    view.unmount()
  })

  it('carries JARVIS’s next best action on every row', async () => {
    const directory = await directoryAt()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} />,
      STUBS,
    )
    const list = screen.getByRole('region', { name: 'Klientlista' })
    expect(within(list).getAllByText('JARVIS rekommenderar')).toHaveLength(7)
    view.unmount()
  })

  it('filters by the flags the rules set', async () => {
    const directory = await directoryAt()
    const user = userEvent.setup()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} />,
      STUBS,
    )
    const list = screen.getByRole('region', { name: 'Klientlista' })

    await user.click(screen.getByRole('button', { name: /Försenat åtagande/ }))
    const overdue = within(list)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(overdue.sort()).toEqual([
      '/clients/cl-berglund',
      '/clients/cl-dahlqvist',
      '/clients/cl-grahn',
    ])

    await user.click(screen.getByRole('button', { name: /Hög kassa/ }))
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toContain('/clients/cl-grahn')
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).not.toContain('/clients/cl-forsell')
    view.unmount()
  })

  it('searches and sorts', async () => {
    const directory = await directoryAt()
    const user = userEvent.setup()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} />,
      STUBS,
    )
    const list = screen.getByRole('region', { name: 'Klientlista' })

    await user.type(screen.getByRole('searchbox', { name: 'Sök klient' }), 'Forsell')
    expect(within(list).getAllByRole('link')).toHaveLength(1)
    await user.clear(screen.getByRole('searchbox', { name: 'Sök klient' }))

    await user.selectOptions(screen.getByRole('combobox', { name: /Sortera/ }), 'aum')
    expect(within(list).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/clients/cl-ekstrand',
    )

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Sortera/ }),
      'last-contact',
    )
    expect(within(list).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/clients/cl-ceder',
    )
    view.unmount()
  })

  it('says the clients are synthetic and which date the derivations used', async () => {
    const directory = await directoryAt()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} />,
      STUBS,
    )
    expect(screen.getByText(/syntetiska klienter/)).toBeInTheDocument()
    expect(screen.getByText(/23 sep 2026/)).toBeInTheDocument()
    view.unmount()
  })
})

describe('an unavailable directory', () => {
  it('renders nothing invented', () => {
    const empty: ClientDirectory = {
      rows: [],
      metrics: {
        totalClients: 0,
        totalAum: 0,
        estimatedWealth: 0,
        needingAttention: 0,
        upcomingMeetings: 0,
        openCommitments: 0,
        overdueCommitments: 0,
        activeOpportunities: 0,
        opportunityValue: 0,
      },
      today: TODAY,
      generatedAt: `${TODAY}T10:00:00.000Z`,
      method: 'rule-based-v1',
    }
    const view = render(<ClientCommandCentre directory={empty} />)
    expect(screen.getByText('Inga klienter matchar urvalet.')).toBeInTheDocument()
    view.unmount()
  })
})
