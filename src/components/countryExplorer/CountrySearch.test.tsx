import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CountrySearch } from './CountrySearch'

describe('CountrySearch', () => {
  it('shows autocomplete suggestions matching a Swedish name', async () => {
    const user = userEvent.setup()
    render(<CountrySearch onSelectCountry={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'Tysk')

    expect(await screen.findByRole('option', { name: /Tyskland/i })).toBeInTheDocument()
  })

  it('shows autocomplete suggestions matching an English name', async () => {
    const user = userEvent.setup()
    render(<CountrySearch onSelectCountry={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'German')

    expect(await screen.findByRole('option', { name: /Tyskland/i })).toBeInTheDocument()
  })

  it('calls onSelectCountry and clears the input when a suggestion is picked', async () => {
    const onSelectCountry = vi.fn()
    const user = userEvent.setup()
    render(<CountrySearch onSelectCountry={onSelectCountry} />)

    const input = screen.getByRole('combobox')
    await user.type(input, 'Japan')
    // The li carries role="option"; the actual click handler lives on the
    // button nested inside it.
    await user.click(await screen.findByRole('button', { name: /Japan/i }))

    expect(onSelectCountry).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: 'JP' }),
    )
    expect(input).toHaveValue('')
  })

  it('shows no suggestions for a query matching no country', async () => {
    const user = userEvent.setup()
    render(<CountrySearch onSelectCountry={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'xyzxyz')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
