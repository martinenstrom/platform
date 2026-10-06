/**
 * One office's book, rendered against the book the application derived
 * from the seed: only the office's clients, the office's figures, JARVIS's
 * reading, the first row of filters with the rest behind "Fler filter", a
 * search scoped to the office with the whole book one step away, and a
 * memory of its own that the whole book does not share.
 */

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  officeBook,
  officeBookOf,
  type OfficeBookView,
} from '~/application/advisory/officeBook'
import { clientDirectory } from '~/application/advisory/clientDirectory'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { renderInRouter } from '~/test/renderInRouter'
import { resetDirectoryState, useDirectoryState } from './directoryState'
import { OfficeBook } from './OfficeBook'

const TODAY = '2026-09-23'
const STUBS = ['/clients/$clientId', '/clients', '/clients/office/$officeId'] as const

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

async function strandvagen(): Promise<OfficeBookView> {
  return (await officeBook(contextAt(), 'of-strandvagen'))!
}

afterEach(() => resetDirectoryState())

describe('the office book', () => {
  it('opens on the office, its figures and only its clients', async () => {
    const book = await strandvagen()
    const view = await renderInRouter(<OfficeBook book={book} />, STUBS)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Strandvägen' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Office book')).toBeInTheDocument()
    const figures = screen.getByRole('region', { name: 'Kontorets nyckeltal' })
    expect(within(figures).getByText('Klienter').nextElementSibling).toHaveTextContent(
      '3',
    )
    expect(within(figures).getByText('Möjligheter')).toBeInTheDocument()
    const list = screen.getByRole('region', { name: 'Klientlista' })
    const hrefs = within(list)
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
      .filter((h) => h?.startsWith('/clients/cl-'))
    expect(hrefs.sort()).toEqual([
      '/clients/cl-alvarsson',
      '/clients/cl-berglund',
      '/clients/cl-ekstrand',
    ])
    /* The office's reading, from its counts. */
    const jarvis = screen.getByRole('region', { name: 'JARVIS · Strandvägen' })
    expect(jarvis).toHaveTextContent(/behöver uppmärksamhet/)
    view.unmount()
  })

  it('shows the first row of filters and keeps the rest behind "Fler filter"', async () => {
    const view = await renderInRouter(<OfficeBook book={await strandvagen()} />, STUBS)
    const user = userEvent.setup()
    const filters = screen.getByRole('list', { name: 'Filter' })
    expect(
      within(filters).getByRole('button', { name: /Behöver uppmärksamhet/ }),
    ).toBeInTheDocument()
    expect(
      within(filters).getByRole('button', { name: /^Möjligheter/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hög kassa/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Fler filter' }))
    expect(screen.getByRole('button', { name: /Hög kassa/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Försenat åtagande/ }))
    const list = screen.getByRole('region', { name: 'Klientlista' })
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
        .filter((h) => h?.startsWith('/clients/cl-')),
    ).toEqual(['/clients/cl-berglund'])
    view.unmount()
  })

  it('searches the office only, and offers the whole book beside it', async () => {
    const view = await renderInRouter(<OfficeBook book={await strandvagen()} />, STUBS)
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Sök klient' })
    await user.type(search, 'Grahn')
    expect(
      screen.getByText('Inga klienter på kontoret matchar urvalet.'),
    ).toBeInTheDocument()
    const everywhere = screen.getByRole('link', { name: 'Sök i alla klienter' })
    expect(everywhere).toHaveAttribute('href', '/clients?view=alla')
    await user.clear(search)
    await user.type(search, 'Berglund')
    const list = screen.getByRole('region', { name: 'Klientlista' })
    expect(
      within(list)
        .getAllByRole('link')
        .filter((l) => l.getAttribute('href')?.startsWith('/clients/cl-')),
    ).toHaveLength(1)
    view.unmount()
  })

  it('remembers its own selection, apart from the whole book', async () => {
    const book = await strandvagen()
    const user = userEvent.setup()
    const first = await renderInRouter(<OfficeBook book={book} />, STUBS)
    await user.type(screen.getByRole('searchbox', { name: 'Sök klient' }), 'Alv')
    await user.selectOptions(screen.getByRole('combobox', { name: /Sortera/ }), 'aum')
    first.unmount()

    const second = await renderInRouter(<OfficeBook book={book} />, STUBS)
    expect(screen.getByRole('searchbox', { name: 'Sök klient' })).toHaveValue('Alv')
    expect(screen.getByRole('combobox', { name: /Sortera/ })).toHaveValue('aum')
    second.unmount()

    /* The whole book's memory is untouched. */
    let whole: ReturnType<typeof useDirectoryState> | null = null
    function Probe() {
      whole = useDirectoryState('all')
      return null
    }
    const probe = await renderInRouter(<Probe />, STUBS)
    expect(whole).toMatchObject({ query: '', sort: 'priority' })
    probe.unmount()
  })

  it('renders an office with no clients calmly', async () => {
    const directory = await clientDirectory(contextAt())
    const empty = officeBookOf(
      {
        id: 'of-empty',
        name: 'Tomgatan',
        city: 'Uppsala',
        displayName: 'Tomgatan',
        shortName: 'Tomg.',
        status: 'active',
        archivedAt: null,
      },
      directory.rows,
      TODAY,
    )
    const view = await renderInRouter(
      <OfficeBook
        book={{
          ...empty,
          rows: [],
          today: TODAY,
          generatedAt: directory.generatedAt,
          method: 'rule-based-v1',
        }}
      />,
      STUBS,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tomgatan' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Inga klienter är kopplade till kontoret.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'JARVIS · Tomgatan' })).toHaveTextContent(
      'Inga kritiska klientärenden.',
    )
    view.unmount()
  })
})
