/**
 * The queue and the dashboard module, rendered against the brief the
 * application derives from the seed on the frozen clock — so what the
 * surfaces show is what Sentinel decided, not rows written here.
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AdvisoryContext } from '~/application/advisory/ports'
import {
  disposePriority,
  sentinelBrief,
  type SentinelBrief,
} from '~/application/advisory/sentinel'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { renderInRouter } from '~/test/renderInRouter'
import { SentinelBriefList, SentinelGreeting } from './SentinelBrief'
import { SentinelQueue } from './SentinelQueue'
import type { SentinelActions } from './sentinelActions'

const TODAY = '2026-09-23'
const STUBS = ['/clients/$clientId', '/sentinel'] as const

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T07:30:00.000Z`),
  }
}

const actionsOver = (context: AdvisoryContext): SentinelActions => ({
  dispose: (input) => disposePriority(context, input),
})

describe('the dashboard module', () => {
  it('says how many need attention and lists the highest-ranked, each with a door to the client', async () => {
    const brief = await sentinelBrief(contextAt())
    const view = await renderInRouter(
      <SentinelBriefList brief={brief} limit={4} />,
      STUBS,
    )
    expect(screen.getByText(/5 klienter behöver din uppmärksamhet/)).toBeInTheDocument()
    expect(screen.getByText(/1 utan prioritet/)).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('01')
    expect(items[0]).toHaveTextContent('Margareta Berglund')
    expect(items[0]).toHaveTextContent('Kritisk')
    expect(items[0]).toHaveTextContent('Försenat åtagande')
    expect(within(items[0]!).getByRole('link', { name: /Öppna klient/ })).toHaveAttribute(
      'href',
      '/clients/cl-berglund',
    )
    expect(items[3]).toHaveTextContent('Johan Ceder')
    view.unmount()
  })

  it('the greeting line carries the three counts and the door to the queue', async () => {
    const brief = await sentinelBrief(contextAt())
    const view = await renderInRouter(<SentinelGreeting brief={brief} />, STUBS)
    expect(
      screen.getByText(
        /5 klienter behöver din uppmärksamhet i dag · 2 möten kommande 7 dagar · 4 försenade åtaganden/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Öppna prioriteringarna/ })).toHaveAttribute(
      'href',
      '/sentinel',
    )
    view.unmount()
  })

  it('says so when nobody needs attention', async () => {
    const brief = await sentinelBrief(contextAt())
    const empty: SentinelBrief = {
      ...brief,
      entries: [],
      quiet: brief.entries.map((e) => e.client),
      metrics: { ...brief.metrics, clientsNeedingAttention: 0, quietClients: 7 },
    }
    const view = await renderInRouter(<SentinelBriefList brief={empty} />, STUBS)
    expect(
      screen.getByText(/Ingen klient behöver din uppmärksamhet i dag/),
    ).toBeInTheDocument()
    view.unmount()
  })
})

describe('the queue', () => {
  it('sections the morning by horizon and names the quiet client', async () => {
    const context = contextAt()
    const brief = await sentinelBrief(context)
    const view = await renderInRouter(
      <SentinelQueue
        brief={brief}
        actions={actionsOver(context)}
        onChanged={async () => {}}
      />,
      STUBS,
    )
    const section = (name: string) =>
      screen.getByRole('heading', { level: 2, name }).closest('section')!
    expect(within(section('Behöver åtgärd nu')).getAllByRole('listitem')).toHaveLength(4)
    expect(within(section('Kommande')).getAllByRole('listitem')).toHaveLength(2)
    expect(within(section('Bevaka')).getByText('Inget att bevaka.')).toBeInTheDocument()
    expect(
      within(section('Möjligheter')).getByText(/Inga möjligheter vars tidpunkt är nära/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Utan prioritet i dag:/)).toHaveTextContent('Viktor Ekstrand')
    expect(screen.getByText('Att agera på i dag').nextElementSibling).toHaveTextContent(
      '4',
    )
    view.unmount()
  })

  it('groups the queue by office on request, without re-ranking anything', async () => {
    /*
     * Sentinel decides nothing per office: the same entries, shown for one
     * office at a time. "Alla kontor" is the queue as ranked.
     */
    const context = contextAt()
    const brief = await sentinelBrief(context)
    const user = userEvent.setup()
    const view = await renderInRouter(
      <SentinelQueue
        brief={brief}
        actions={actionsOver(context)}
        onChanged={async () => {}}
      />,
      STUBS,
    )
    const section = (name: string) =>
      screen.getByRole('heading', { level: 2, name }).closest('section')!
    const office = screen.getByRole('combobox', { name: 'Kontor' })
    expect(
      within(office).getByRole('option', { name: 'Alla kontor' }),
    ).toBeInTheDocument()

    await user.selectOptions(office, 'of-arbetargatan')
    const now = within(section('Behöver åtgärd nu')).getAllByRole('listitem')
    expect(now.map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Anna & Per Dahlqvist')]),
    )
    expect(section('Behöver åtgärd nu')).not.toHaveTextContent('Margareta Berglund')
    expect(now.length).toBeLessThan(4)

    await user.selectOptions(office, 'all')
    expect(within(section('Behöver åtgärd nu')).getAllByRole('listitem')).toHaveLength(4)
    view.unmount()
  })

  it('explains a combined priority on request, with every driver and its sources', async () => {
    const context = contextAt()
    const brief = await sentinelBrief(context)
    const user = userEvent.setup()
    const view = await renderInRouter(
      <SentinelQueue
        brief={brief}
        actions={actionsOver(context)}
        onChanged={async () => {}}
      />,
      STUBS,
    )
    const henrik = screen.getByRole('link', { name: 'Henrik Alvarsson' }).closest('li')!
    expect(henrik).toHaveTextContent(
      'Förbered finansieringsdiskussionen inför mötet 3 okt',
    )
    await user.click(
      within(henrik).getByRole('button', { name: 'Varför ser jag detta?' }),
    )
    const evidence = within(henrik).getByRole('list', {
      name: 'Underlag för prioriteringen',
    })
    expect(evidence).toHaveTextContent('Omsättning av bolån om 53 dagar')
    expect(evidence).toHaveTextContent('6,5 MSEK')
    expect(evidence).toHaveTextContent('6,8 MSEK i likvida medel')
    expect(evidence).toHaveTextContent('ev-alv-refi')
    view.unmount()
  })

  it('snoozes a priority until a date and asks the page to re-read', async () => {
    const context = contextAt()
    const brief = await sentinelBrief(context)
    const user = userEvent.setup()
    let changed = 0
    const view = await renderInRouter(
      <SentinelQueue
        brief={brief}
        actions={actionsOver(context)}
        onChanged={async () => {
          changed += 1
        }}
      />,
      STUBS,
    )
    const row = screen.getByRole('link', { name: 'Margareta Berglund' }).closest('li')!
    await user.click(
      within(row).getByRole('button', { name: 'Snooza Margareta Berglund' }),
    )
    fireEvent.change(within(row).getByLabelText('Till'), {
      target: { value: '2026-09-30' },
    })
    await user.type(within(row).getByLabelText('Skäl'), 'Semester')
    await user.click(within(row).getByRole('button', { name: 'Bekräfta' }))
    await waitFor(() => expect(changed).toBe(1))
    const after = await sentinelBrief(context)
    expect(after.entries.find((e) => e.client.id === 'cl-berglund')).toMatchObject({
      status: 'snoozed',
      disposition: { until: '2026-09-30', reason: 'Semester' },
    })
    view.unmount()
  })

  it('refuses a snooze without a future date, in words', async () => {
    const context = contextAt()
    const brief = await sentinelBrief(context)
    const user = userEvent.setup()
    const view = await renderInRouter(
      <SentinelQueue
        brief={brief}
        actions={actionsOver(context)}
        onChanged={async () => {}}
      />,
      STUBS,
    )
    const row = screen.getByRole('link', { name: 'Margareta Berglund' }).closest('li')!
    await user.click(
      within(row).getByRole('button', { name: 'Snooza Margareta Berglund' }),
    )
    fireEvent.change(within(row).getByLabelText('Till'), { target: { value: TODAY } })
    await user.click(within(row).getByRole('button', { name: 'Bekräfta' }))
    await waitFor(() =>
      expect(within(row).getByRole('alert')).toHaveTextContent(
        'Ange ett datum efter i dag.',
      ),
    )
    view.unmount()
  })

  it('lists a snoozed priority under the set-aside section with its date', async () => {
    const context = contextAt()
    await disposePriority(context, {
      priorityId: 'cl-grahn:overdue-commitment',
      status: 'snoozed',
      until: '2026-10-01',
      reason: null,
    })
    const brief = await sentinelBrief(context)
    const view = await renderInRouter(
      <SentinelQueue
        brief={brief}
        actions={actionsOver(context)}
        onChanged={async () => {}}
      />,
      STUBS,
    )
    const section = screen
      .getByRole('heading', { level: 2, name: 'Vilande, avfärdade och utan prioritet' })
      .closest('section')!
    expect(within(section).getByText(/vilande till 1 okt 2026/)).toBeInTheDocument()
    expect(
      within(
        screen
          .getByRole('heading', { level: 2, name: 'Behöver åtgärd nu' })
          .closest('section')!,
      ).getAllByRole('listitem'),
    ).toHaveLength(3)
    view.unmount()
  })
})
