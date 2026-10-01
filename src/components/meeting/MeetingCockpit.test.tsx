/**
 * The Meeting Cockpit, rendered against the record and driven through the
 * workflow: read the rich client, inspect the changes and the promises,
 * edit the agenda, ask the meeting-scoped question, open the client update
 * to close the meeting — and read the quiet client, who gets a calm page.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { askAboutClient } from '~/application/advisory/askAboutClient'
import { completeCommitment } from '~/application/advisory/completeCommitment'
import { confirmClientUpdate } from '~/application/advisory/confirmClientUpdate'
import { askBeforeMeeting, meetingCockpit } from '~/application/advisory/meetingCockpit'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { recordClientUpdate } from '~/application/advisory/recordClientUpdate'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { renderInRouter } from '~/test/renderInRouter'
import { MeetingCockpit } from './MeetingCockpit'
import type { MeetingActions } from './meetingActions'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

function actionsOver(context: AdvisoryContext, clientId: string): MeetingActions {
  return {
    client: {
      recordUpdate: (input) => recordClientUpdate(context, { clientId, ...input }),
      confirmUpdate: (candidateId, decisions) =>
        confirmClientUpdate(context, { candidateId, decisions }),
      completeCommitment: (id) => completeCommitment(context, id),
      ask: (question) => askAboutClient(context, { clientId, question }),
    },
    askBeforeMeeting: (question) => askBeforeMeeting(context, { clientId, question }),
  }
}

async function renderCockpit(clientId: string) {
  const context = contextAt()
  const cockpit = (await meetingCockpit(context, clientId))!
  let changed = 0
  const rendered = await renderInRouter(
    <MeetingCockpit
      cockpit={cockpit}
      actions={actionsOver(context, clientId)}
      onChanged={async () => {
        changed += 1
      }}
    />,
    [
      '/clients/$clientId',
      '/clients',
      '/clients/$clientId/meeting-prep',
      '/clients/$clientId/meeting-pack',
    ],
  )
  return { rendered, cockpit, changes: () => changed }
}

const panel = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section')!

describe('the rich client, in the first viewport', () => {
  it('leads with identity, the meeting, one focus and the thirty-second brief', async () => {
    const { rendered } = await renderCockpit('cl-alvarsson')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Henrik Alvarsson' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Portföljgenomgång med jämförelse · 3 okt 2026 · om 10 dagar/),
    ).toBeInTheDocument()
    const focus = screen.getByRole('region', { name: 'Mötets huvudfokus' })
    expect(
      within(focus).getByText(/omläggningen av bolånet i november/),
    ).toBeInTheDocument()
    expect(within(focus).getByText(/Aktier 67 % mot strategi 60 %/)).toBeInTheDocument()
    const brief = panel('Klienten på 30 sekunder')
    expect(within(brief).getByText('Entreprenör')).toBeInTheDocument()
    expect(
      within(brief).getByText('Orolig över energiexponeringen efter nedgången'),
    ).toBeInTheDocument()
    rendered.unmount()
  })

  it('shows what changed since September, what was promised, and what the client may ask', async () => {
    const { rendered } = await renderCockpit('cl-alvarsson')
    const changes = panel('Sedan senaste mötet')
    expect(within(changes).getByText('Aktieandel')).toBeInTheDocument()
    expect(within(changes).getByText(/65 % → 67 %/)).toBeInTheDocument()
    expect(within(changes).getByText(/5,9 MSEK → 6,8 MSEK/)).toBeInTheDocument()
    const promises = panel('Du lovade')
    const before = within(promises).getByRole('region', { name: 'Före mötet' })
    expect(
      within(before).getByText('Ta fram jämförelse av två alternativ till energifonden'),
    ).toBeInTheDocument()
    const questions = panel('Klienten kan fråga')
    expect(
      within(questions).getByText('”Varför äger vi fortfarande energifonden?”'),
    ).toBeInTheDocument()
    expect(within(questions).getAllByText('Möjlig fråga').length).toBeGreaterThan(0)
    const toAsk = panel('Frågor att ställa')
    expect(within(toAsk).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
    expect(panel('Strategin')).toHaveTextContent(
      'Pröva om den nuvarande allokeringen fortfarande är avsiktlig.',
    )
    expect(panel('Finansiering')).toHaveTextContent('Bolån, Djursholm · 6,5 MSEK')
    rendered.unmount()
  })

  it('lets the advisor reorder, remove and add agenda items', async () => {
    const user = userEvent.setup()
    const { rendered } = await renderCockpit('cl-alvarsson')
    const agenda = panel('Förslag på agenda')
    const list = within(agenda).getByRole('list', { name: 'Agenda' })
    const initial = within(list).getAllByRole('listitem').length
    await user.click(
      within(agenda).getByRole('button', {
        name: 'Ta bort: Uppföljning sedan senaste mötet',
      }),
    )
    expect(within(list).getAllByRole('listitem')).toHaveLength(initial - 1)
    await user.click(
      within(agenda).getByRole('button', {
        name: /Flytta ned: Portfölj och strategisk allokering/,
      }),
    )
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'Klientens oro och marknadsutvecklingen',
    )
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(
      'Portfölj och strategisk allokering',
    )
    await user.type(
      within(agenda).getByRole('textbox', { name: 'Egen agendapunkt' }),
      'Skatteeffekter av gåvor',
    )
    await user.click(within(agenda).getByRole('button', { name: 'Lägg till' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(initial)
    expect(within(list).getByText('Skatteeffekter av gåvor')).toBeInTheDocument()
    rendered.unmount()
  })

  it('answers the meeting-scoped question from the cockpit', async () => {
    const user = userEvent.setup()
    const { rendered } = await renderCockpit('cl-alvarsson')
    const ask = screen.getByRole('region', { name: 'Fråga JARVIS inför mötet' })
    await user.type(
      within(ask).getByRole('textbox', { name: 'Fråga inför mötet' }),
      'Vad har jag inte gjort?',
    )
    await user.click(within(ask).getByRole('button', { name: 'Fråga' }))
    await waitFor(() =>
      expect(
        within(ask).getByRole('heading', { level: 3, name: 'Du lovade' }),
      ).toBeInTheDocument(),
    )
    expect(
      within(ask).getByText(/Ta fram jämförelse av två alternativ till energifonden/),
    ).toBeInTheDocument()
    expect(within(ask).getByText(/metod meeting-rules-v1/)).toBeInTheDocument()
    rendered.unmount()
  })

  it('closes the meeting through the existing client update', async () => {
    const user = userEvent.setup()
    const { rendered } = await renderCockpit('cl-alvarsson')
    await user.click(screen.getByRole('button', { name: 'Registrera mötesanteckning' }))
    expect(
      screen.getByRole('region', { name: 'Lägg till klientuppdatering' }),
    ).toBeInTheDocument()
    rendered.unmount()
  })
})

describe('the quiet client', () => {
  it('says there is little to report, and asks no invented questions', async () => {
    const { rendered } = await renderCockpit('cl-forsell')
    expect(panel('Sedan senaste mötet')).toHaveTextContent(
      'Få väsentliga förändringar sedan senaste mötet.',
    )
    expect(panel('Marknad sedan senaste mötet')).toHaveTextContent(
      'Inga marknadsrörelser i fönstret',
    )
    expect(panel('Klienten kan fråga')).toHaveTextContent(
      'Inget i registret pekar på en särskild fråga',
    )
    expect(panel('Strategin')).toHaveTextContent('Portföljen ligger inom mandatet')
    expect(
      screen.getByText(/Oplanerad avstämning|Halvårsgenomgång med Gunnar/),
    ).toBeInTheDocument()
    rendered.unmount()
  })
})

describe('the client without a baseline', () => {
  it('says so instead of inventing history', async () => {
    const { rendered } = await renderCockpit('cl-ceder')
    expect(panel('Sedan senaste mötet')).toHaveTextContent(
      'Ingen baslinje från ett tidigare möte finns',
    )
    rendered.unmount()
  })
})
