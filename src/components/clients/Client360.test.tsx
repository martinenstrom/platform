/**
 * Client 360, rendered against the record and driven through the daily
 * workflow: read the client, add what happened, confirm what JARVIS
 * understood, see it in the timeline; prepare the meeting; ask the memory.
 *
 * The actions are the application use cases over the same in-memory
 * context the server composes, so what the surface shows after a
 * confirmation is what the record holds — not what the form remembered.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { askAboutClient } from '~/application/advisory/askAboutClient'
import { client360 } from '~/application/advisory/client360'
import { completeCommitment } from '~/application/advisory/completeCommitment'
import { confirmClientUpdate } from '~/application/advisory/confirmClientUpdate'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { recordClientUpdate } from '~/application/advisory/recordClientUpdate'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { renderInRouter } from '~/test/renderInRouter'
import { Client360 } from './Client360'
import type { ClientActions } from './clientActions'

const TODAY = '2026-09-23'
const CLIENT = 'cl-alvarsson'
const NOTE =
  'Träffade Henrik i dag. Han är fortsatt orolig över energiallokeringen. Bolånet ska omsättas den 14 november. Nästa möte är bokat den 3 december. Jag lovade att återkomma med en jämförelse av två placeringsalternativ.'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

function actionsOver(context: AdvisoryContext): ClientActions {
  return {
    recordUpdate: (input) => recordClientUpdate(context, { clientId: CLIENT, ...input }),
    confirmUpdate: (candidateId, decisions) =>
      confirmClientUpdate(context, { candidateId, decisions }),
    completeCommitment: (id) => completeCommitment(context, id),
    ask: (question) => askAboutClient(context, { clientId: CLIENT, question }),
  }
}

async function renderClient(context: AdvisoryContext) {
  const view = (await client360(context, CLIENT))!
  let changed = 0
  const rendered = await renderInRouter(
    <Client360
      view={view}
      actions={actionsOver(context)}
      onChanged={async () => {
        changed += 1
      }}
    />,
    [
      '/clients/$clientId',
      '/clients',
      '/clients/$clientId/meeting-prep',
      '/clients/$clientId/meeting-pack',
      '/clients/office/$officeId',
    ],
  )
  return { rendered, view, changes: () => changed }
}

describe('understanding the client in ten seconds', () => {
  it('leads with identity, relationship state and the next best action', async () => {
    const { rendered, view } = await renderClient(contextAt())
    expect(
      screen.getByRole('heading', { level: 1, name: 'Henrik Alvarsson' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Entreprenör sedan 2024')).toBeInTheDocument()
    expect(screen.getByText('Rådgivare Martin')).toBeInTheDocument()
    /* The office, as relationship metadata beside the identity, and a door to its book. */
    expect(screen.getByRole('link', { name: 'Strandvägen' })).toHaveAttribute(
      'href',
      '/clients/office/of-strandvagen',
    )
    /* Three facts as pills: what the firm holds, who they are, how the relationship stands. */
    const pills = screen.getByRole('list', { name: 'Nyckelfakta' })
    expect(within(pills).getByText('AUM 21,0 MSEK')).toBeInTheDocument()
    expect(within(pills).getByText('Hög relationshälsa')).toBeInTheDocument()
    expect(screen.getByText('Senaste kontakt').nextElementSibling).toHaveTextContent(
      '12 sep',
    )
    expect(screen.getByText('Nästa möte').nextElementSibling).toHaveTextContent('3 okt')
    expect(view.nextBestAction?.signal.kind).toBe('excess-cash')
    expect(
      screen.getAllByText('Pröva om överskottslikviditeten ska placeras.').length,
    ).toBeGreaterThan(0)
    /* The door to the Meeting Cockpit: a page of its own, so a link. */
    expect(screen.getByRole('link', { name: 'Förbered möte' })).toHaveAttribute(
      'href',
      '/clients/cl-alvarsson/meeting-prep',
    )
    expect(
      screen.getByRole('button', { name: 'Lägg till klientuppdatering' }),
    ).toBeInTheDocument()
    rendered.unmount()
  })

  it('shows what is promised, what is coming and the original notes', async () => {
    const { rendered } = await renderClient(contextAt())
    /* A Panel is a section headed by an h2; it carries no label of its own. */
    const panel = (name: string) =>
      screen.getByRole('heading', { level: 2, name }).closest('section')!
    const promises = panel('Åtaganden')
    expect(
      within(promises).getByText(
        'Ta fram jämförelse av två alternativ till energifonden',
      ),
    ).toBeInTheDocument()
    const events = panel('Viktiga händelser')
    /* Once as the event, once as the reminder it raises. */
    expect(within(events).getAllByText('Omsättning av bolånet').length).toBeGreaterThan(0)
    const timeline = panel('Relationstidslinje')
    expect(within(timeline).getAllByText('Ursprunglig notering').length).toBeGreaterThan(
      0,
    )
    expect(within(timeline).getByText(/Träffade Henrik på kontoret/)).toBeInTheDocument()
    rendered.unmount()
  })

  it('names the drivers behind the health score rather than a bare number', async () => {
    const { rendered } = await renderClient(contextAt())
    /* The relationship lens: the score, its band, and every driver beneath it. */
    const lens = screen
      .getByRole('heading', { level: 2, name: 'Relationshälsa' })
      .closest('section')!
    const drivers = within(lens).getByRole('list', {
      name: 'Drivkrafter bakom relationshälsan',
    })
    expect(within(drivers).getByText('Kontakt för 11 dagar sedan')).toBeInTheDocument()
    expect(within(drivers).getByText('En aktiv oro')).toBeInTheDocument()
    rendered.unmount()
  })
})

describe('the daily workflow: add what happened, confirm, see it in memory', () => {
  it('records the note, shows what JARVIS understood, and writes only after confirmation', async () => {
    const context = contextAt()
    const user = userEvent.setup()
    const { rendered, changes } = await renderClient(context)
    const before = await context.repositories.interactions.interactionsOf(CLIENT)

    await user.click(screen.getByRole('button', { name: 'Lägg till klientuppdatering' }))
    const flow = screen.getByRole('region', { name: 'Lägg till klientuppdatering' })
    expect(
      within(flow).getByRole('heading', { name: 'Vad hände med klienten?' }),
    ).toBeInTheDocument()

    const textarea = within(flow).getByRole('textbox', {
      name: 'Vad hände med klienten?',
    })
    await user.click(textarea)
    await user.paste(NOTE)
    await user.click(within(flow).getByRole('button', { name: /Spara & analysera/ }))

    await waitFor(() =>
      expect(
        within(flow).getByRole('heading', { name: 'JARVIS förstod' }),
      ).toBeInTheDocument(),
    )
    expect(within(flow).getByText(/^Klientens oro/)).toBeInTheDocument()
    expect(within(flow).getByText(/^Viktig händelse/)).toBeInTheDocument()
    expect(within(flow).getByText(/^Nästa möte/)).toBeInTheDocument()
    expect(within(flow).getByText(/^Åtagande/)).toBeInTheDocument()
    expect(
      within(flow).getByDisplayValue(
        'Återkomma med en jämförelse av två placeringsalternativ',
      ),
    ).toBeInTheDocument()
    /* Nothing is written yet. */
    expect(await context.repositories.interactions.interactionsOf(CLIENT)).toHaveLength(
      before.length,
    )

    await user.click(within(flow).getByRole('button', { name: 'Bekräfta alla' }))
    await waitFor(() =>
      expect(
        within(flow).getByText('Uppdateringen är sparad i relationstidslinjen.'),
      ).toBeInTheDocument(),
    )
    expect(
      within(flow).getByText('1 fakta, 1 åtaganden och 2 händelser bekräftade.'),
    ).toBeInTheDocument()
    expect(changes()).toBe(1)

    const after = await context.repositories.interactions.interactionsOf(CLIENT)
    expect(after).toHaveLength(before.length + 1)
    expect(after[0]?.noteText).toBe(NOTE)
    const commitments = await context.repositories.commitments.commitmentsOf(CLIENT)
    expect(
      commitments.some(
        (c) =>
          c.title === 'Återkomma med en jämförelse av två placeringsalternativ' &&
          c.status === 'open',
      ),
    ).toBe(true)
    rendered.unmount()
  })

  it('lets the advisor edit and remove before anything is written', async () => {
    const context = contextAt()
    const user = userEvent.setup()
    const { rendered } = await renderClient(context)
    const factsBefore = (await context.repositories.context.factsOf(CLIENT)).length

    await user.click(screen.getByRole('button', { name: 'Lägg till klientuppdatering' }))
    const flow = screen.getByRole('region', { name: 'Lägg till klientuppdatering' })
    await user.click(
      within(flow).getByRole('textbox', { name: 'Vad hände med klienten?' }),
    )
    await user.paste(NOTE)
    await user.click(within(flow).getByRole('button', { name: /Spara & analysera/ }))
    await waitFor(() =>
      expect(
        within(flow).getByRole('heading', { name: 'JARVIS förstod' }),
      ).toBeInTheDocument(),
    )

    const title = within(flow).getByRole('textbox', { name: 'Åtagande: formulering' })
    await user.clear(title)
    await user.type(title, 'Skicka jämförelsen till Henrik')
    const commitmentItem = title.closest('li')!
    await user.click(within(commitmentItem).getByRole('button', { name: 'Bekräfta' }))
    const concernItem = within(flow)
      .getByRole('textbox', { name: 'Klientens oro: formulering' })
      .closest('li')!
    await user.click(within(concernItem).getByRole('button', { name: 'Ta bort' }))

    await user.click(within(flow).getByRole('button', { name: /Spara 1 bekräftade/ }))
    await waitFor(() =>
      expect(
        within(flow).getByText('0 fakta, 1 åtaganden och 0 händelser bekräftade.'),
      ).toBeInTheDocument(),
    )
    expect((await context.repositories.context.factsOf(CLIENT)).length).toBe(factsBefore)
    expect(
      (await context.repositories.commitments.commitmentsOf(CLIENT)).some(
        (c) => c.title === 'Skicka jämförelsen till Henrik',
      ),
    ).toBe(true)
    rendered.unmount()
  })
})

describe('ask the memory', () => {
  it('answers "vad har jag lovat" from the record, and says how', async () => {
    const user = userEvent.setup()
    const { rendered } = await renderClient(contextAt())
    const ask = screen.getByRole('region', { name: 'Fråga JARVIS om klienten' })
    await user.type(
      within(ask).getByRole('textbox', { name: 'Fråga om klienten' }),
      'Vad har jag lovat?',
    )
    await user.click(within(ask).getByRole('button', { name: 'Fråga' }))
    await waitFor(() =>
      expect(within(ask).getByText('Öppna åtaganden')).toBeInTheDocument(),
    )
    expect(
      within(ask).getByText('Ta fram jämförelse av två alternativ till energifonden'),
    ).toBeInTheDocument()
    expect(
      within(ask).getByText(/metod lexicon-v1 · svar ur strukturerat minne/),
    ).toBeInTheDocument()
    rendered.unmount()
  })

  it('closes a promise from the rail and asks the page to re-read', async () => {
    const context = contextAt()
    const user = userEvent.setup()
    const { rendered, changes } = await renderClient(context)
    await user.click(
      screen.getByRole('button', {
        name: 'Markera "Ta fram jämförelse av två alternativ till energifonden" som klart',
      }),
    )
    await waitFor(() => expect(changes()).toBe(1))
    expect(
      (await context.repositories.commitments.commitmentById('co-alv-1'))?.status,
    ).toBe('done')
    rendered.unmount()
  })
})
