import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { CountryExplorer } from './CountryExplorer'
import { countryExplorerService } from '~/services/countryExplorerService'

/**
 * jsdom has no WebGL, so `CountryExplorer` always falls back to the
 * WebGL-unavailable message in this environment — exactly the code path
 * these tests need to drive every flow (select, back, Escape, loading,
 * error) without mounting three.js/react-globe.gl. Country selection goes
 * through `CountrySearch`, which renders unconditionally regardless of
 * WebGL support. Direct click-on-globe interaction isn't unit-testable
 * (react-globe.gl renders countries as WebGL meshes inside a `<canvas>`,
 * not addressable DOM nodes) — that path is covered by Playwright instead.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

async function selectCountryBySearch(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
) {
  const searchInput = screen.getByPlaceholderText(/Sök land eller marknad/i)
  await user.type(searchInput, query)
  const option = await screen.findByRole('button', { name: new RegExp(query, 'i') })
  await user.click(option)
}

describe('CountryExplorer', () => {
  it('shows the WebGL-unavailable fallback message with a working search', async () => {
    render(<CountryExplorer />)
    expect(
      await screen.findByText(/stödjer inte WebGL/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Sök land eller marknad/i)).toBeInTheDocument()
  })

  it('renders the Global Markets // Country Explorer header', async () => {
    render(<CountryExplorer />)
    expect(screen.getByText(/Global Markets \/\/ Country Explorer/i)).toBeInTheDocument()
  })

  it('selecting a full-data country via search shows its analysis', async () => {
    const user = userEvent.setup()
    render(<CountryExplorer />)

    await selectCountryBySearch(user, 'Sverige')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sweden' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Macro' }))
    expect(screen.getByText('Inflation (KPI)')).toBeInTheDocument()
  })

  it('selecting a basic-tier country shows the "not yet available" notice, not fabricated data', async () => {
    const user = userEvent.setup()
    render(<CountryExplorer />)

    await selectCountryBySearch(user, 'Norge')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Norway' })).toBeInTheDocument()
    })
    expect(screen.getByText(/inte tillgänglig ännu/i)).toBeInTheDocument()
  })

  it('the back button returns to the map', async () => {
    const user = userEvent.setup()
    render(<CountryExplorer />)

    await selectCountryBySearch(user, 'Sverige')
    await waitFor(() => screen.getByRole('heading', { name: 'Sweden' }))

    await user.click(screen.getByText(/Tillbaka till världskartan/i))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Sweden' })).not.toBeInTheDocument()
    })
    expect(screen.getByText(/Global Markets \/\/ Country Explorer/i)).toBeInTheDocument()
  })

  it('Escape returns from the country analysis to the map', async () => {
    const user = userEvent.setup()
    render(<CountryExplorer />)

    await selectCountryBySearch(user, 'Japan')
    await waitFor(() => screen.getByRole('heading', { name: 'Japan' }))

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Japan' })).not.toBeInTheDocument()
    })
  })

  it('shows a loading state while the country analysis is being fetched', async () => {
    let resolveAnalysis: (
      value: Awaited<ReturnType<typeof countryExplorerService.getCountryAnalysis>>,
    ) => void
    vi.spyOn(countryExplorerService, 'getCountryAnalysis').mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = resolve
      }),
    )

    const user = userEvent.setup()
    render(<CountryExplorer />)
    await selectCountryBySearch(user, 'Tyskland')

    expect(
      await screen.findByRole('status', { name: /Läser in landsanalys/i }),
    ).toBeInTheDocument()

    resolveAnalysis!(
      await import('~/data/countryExplorer').then((m) => m.getCountryAnalysis('DE')),
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Germany' })).toBeInTheDocument()
    })
  })

  it('shows an error state and a recovery path when the fetch fails', async () => {
    vi.spyOn(countryExplorerService, 'getCountryAnalysis').mockRejectedValue(
      new Error('network down'),
    )

    const user = userEvent.setup()
    render(<CountryExplorer />)
    await selectCountryBySearch(user, 'USA')

    expect(await screen.findByText(/Kunde inte hämta landsanalysen/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Tillbaka till världskartan/i }))
    await waitFor(() => {
      expect(
        screen.getByText(/Global Markets \/\/ Country Explorer/i),
      ).toBeInTheDocument()
    })
  })
})
