/**
 * The relationship book, rendered against a directory the application
 * derived from the synthetic seed — the same read model the route receives,
 * so the page is held to numbers the rules produced rather than rows written
 * here. Office by office first; every relationship on request.
 */

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clientDirectory,
  type ClientDirectory,
} from '~/application/advisory/clientDirectory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { formatMsek } from '~/presentation/advisory/format'
import { renderInRouter } from '~/test/renderInRouter'
import { ClientCommandCentre } from './ClientCommandCentre'
import { resetDirectoryState } from './directoryState'

const TODAY = '2026-09-23'

async function directoryAt(today = TODAY): Promise<ClientDirectory> {
  return clientDirectory({
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(today)),
    clock: new FakeClock(`${today}T10:00:00.000Z`),
  })
}

const STUBS = ['/clients/$clientId', '/clients', '/clients/office/$officeId'] as const

/* The book remembers its selection across mounts; each test starts it fresh. */
afterEach(() => resetDirectoryState())

describe('the relationship book, office by office', () => {
  it('opens on the office folders and the whole book’s figures, and no client cards', async () => {
    const directory = await directoryAt()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} />,
      STUBS,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Klienter' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Client Intelligence')).toBeInTheDocument()
    /* Whose book it is: the advisor's name, role and portrait in the hero. */
    expect(screen.getByText('Martin Enström')).toBeInTheDocument()
    expect(screen.getByText('Private Banking')).toBeInTheDocument()
    expect(
      document.querySelector('[data-advisor-portrait="adv-martin"] img'),
    ).toHaveAttribute('src', '/data/advisors/martin-enstrom.jpg')
    const metrics = screen.getByRole('region', { name: 'Nyckeltal' })
    expect(within(metrics).getByText('Klienter').nextElementSibling).toHaveTextContent(
      '7',
    )
    expect(within(metrics).getAllByRole('term')).toHaveLength(6)

    const offices = screen.getByRole('region', { name: 'Kontor' })
    /* One folder per active office; the door to the archived offices stands beside them, not among them. */
    const folders = within(offices).getAllByRole('link', { name: /^Öppna kontor/ })
    expect(folders).toHaveLength(directory.offices.length)
    expect(
      within(offices).getByRole('link', { name: 'Arkiverade kontor →' }),
    ).toHaveAttribute('href', '/clients/offices/archived')
    expect(folders[0]).toHaveAccessibleName('Öppna kontor Strandvägen')
    expect(folders[0]).toHaveAttribute('href', '/clients/office/of-strandvagen')
    expect(screen.queryByRole('region', { name: 'Klientlista' })).toBeNull()

    /* The folder carries the book's own sums. */
    const strandvagen = directory.offices.find((b) => b.office.id === 'of-strandvagen')!
    expect(folders[0]).toHaveTextContent('3 klienter')
    expect(folders[0]).toHaveTextContent(formatMsek(strandvagen.metrics.totalAum))
    expect(folders[0]).toHaveTextContent('behöver uppmärksamhet')
    expect(folders[0]).toHaveTextContent('Öppna kontor')
    /* The tile's plate and its six figures, the insight beneath them. */
    expect(
      folders[0]!.querySelector('[data-plate="of-strandvagen"] .office-tile-plate-img'),
    ).toHaveStyle({ backgroundImage: 'url(/data/offices/strandvagen.jpg)' })
    expect(
      within(folders[0]!)
        .getAllByRole('term')
        .map((t) => t.textContent),
    ).toEqual([
      'Total förmögenhet',
      'Behöver uppmärksamhet',
      'Möten',
      'Åtaganden',
      'Möjligheter',
      'Nästa möte',
    ])
    expect(folders[0]).toHaveTextContent('JARVIS insikt')

    const switcher = screen.getByRole('navigation', { name: 'Vy' })
    expect(within(switcher).getByRole('link', { name: 'Kontor' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(switcher).getByRole('link', { name: 'Alla klienter' })).toHaveAttribute(
      'href',
      '/clients?view=alla',
    )
    view.unmount()
  })
})

describe('the whole book', () => {
  it('shows one card per client, each naming its office and linking to its page', async () => {
    const directory = await directoryAt()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} view="alla" />,
      STUBS,
    )
    expect(screen.queryByRole('region', { name: 'Kontor' })).toBeNull()
    const list = screen.getByRole('region', { name: 'Klientlista' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(7)
    const berglund = links.find((link) =>
      link.textContent?.includes('Margareta Berglund'),
    )
    expect(berglund).toHaveAttribute('href', '/clients/cl-berglund')
    expect(berglund).toHaveTextContent('Private Banking · Strandvägen · PB sedan 2011')
    const alvarsson = links.find((link) => link.textContent?.includes('Henrik Alvarsson'))
    expect(alvarsson).toHaveTextContent('21,0 MSEK')
    expect(within(list).getAllByText('JARVIS rekommenderar')).toHaveLength(7)
    view.unmount()
  })

  it('searches across offices, by name and by office', async () => {
    const directory = await directoryAt()
    const user = userEvent.setup()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} view="alla" />,
      STUBS,
    )
    const list = screen.getByRole('region', { name: 'Klientlista' })
    const search = screen.getByRole('searchbox', { name: 'Sök klient' })

    await user.type(search, 'Arbetargatan')
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
        .sort(),
    ).toEqual(['/clients/cl-dahlqvist', '/clients/cl-forsell', '/clients/cl-grahn'])

    await user.clear(search)
    await user.type(search, 'Forsell')
    expect(within(list).getAllByRole('link')).toHaveLength(1)
    view.unmount()
  })

  it('filters by the flags the rules set', async () => {
    const directory = await directoryAt()
    const user = userEvent.setup()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} view="alla" />,
      STUBS,
    )
    const list = screen.getByRole('region', { name: 'Klientlista' })

    await user.click(screen.getByRole('button', { name: /Försenat åtagande/ }))
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
        .sort(),
    ).toEqual(['/clients/cl-berglund', '/clients/cl-dahlqvist', '/clients/cl-grahn'])

    await user.click(screen.getByRole('button', { name: /Hög kassa/ }))
    const hrefs = within(list)
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
    expect(hrefs).toContain('/clients/cl-grahn')
    expect(hrefs).not.toContain('/clients/cl-forsell')
    view.unmount()
  })

  it('sorts', async () => {
    const directory = await directoryAt()
    const user = userEvent.setup()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} view="alla" />,
      STUBS,
    )
    const list = screen.getByRole('region', { name: 'Klientlista' })
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

  it('remembers the search, the filter and the order when the page comes back', async () => {
    const directory = await directoryAt()
    const user = userEvent.setup()
    const first = await renderInRouter(
      <ClientCommandCentre directory={directory} view="alla" />,
      STUBS,
    )
    await user.type(screen.getByRole('searchbox', { name: 'Sök klient' }), 'Gra')
    await user.selectOptions(screen.getByRole('combobox', { name: /Sortera/ }), 'aum')
    first.unmount()

    const second = await renderInRouter(
      <ClientCommandCentre directory={directory} view="alla" />,
      STUBS,
    )
    expect(screen.getByRole('searchbox', { name: 'Sök klient' })).toHaveValue('Gra')
    expect(screen.getByRole('combobox', { name: /Sortera/ })).toHaveValue('aum')
    const list = screen.getByRole('region', { name: 'Klientlista' })
    expect(within(list).getAllByRole('link')).toHaveLength(1)
    second.unmount()
  })

  it('says the clients are synthetic and which date the derivations used', async () => {
    const directory = await directoryAt()
    const view = await renderInRouter(
      <ClientCommandCentre directory={directory} view="alla" />,
      STUBS,
    )
    expect(screen.getByText(/syntetiska klienter/)).toBeInTheDocument()
    expect(screen.getByText(/23 sep 2026/)).toBeInTheDocument()
    view.unmount()
  })
})

describe('an unavailable directory', () => {
  it('renders nothing invented', async () => {
    const empty: ClientDirectory = {
      rows: [],
      offices: [],
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
    const view = await renderInRouter(<ClientCommandCentre directory={empty} />, STUBS)
    expect(screen.getByText('Inga kontor i registret.')).toBeInTheDocument()
    view.unmount()
    const all = await renderInRouter(
      <ClientCommandCentre directory={empty} view="alla" />,
      STUBS,
    )
    expect(screen.getByText('Inga klienter matchar urvalet.')).toBeInTheDocument()
    all.unmount()
  })
})
