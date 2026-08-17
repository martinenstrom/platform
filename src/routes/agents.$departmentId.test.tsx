/**
 * One desk, rendered against the real Global Macro desk.
 *
 * The same fixture the floor is proved with, and the same governing rule: two
 * institutional states that would lead a reader to do different things must not
 * render the same.
 *
 * What this page adds over the floor is the full record of each run — what
 * produced it, what it was authorised to spend, what it actually spent, and
 * either why it failed or why a person declined it. Every one of those is a
 * fact the run carries, and the assertions below are that the page shows them
 * as they are rather than as a summary somebody would find friendlier.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AgentDeskPage } from './agents.$departmentId'
import floor from '~/test/fixtures/agentFloor.mixed.json'
import type { AgentDesk } from '~/application/analysis/agentDirectory'
import {
  REJECTION_CODE_LABEL,
  RUN_FAILURE_LABEL,
  RUN_STATE_LABEL,
} from '~/presentation/analysis/runText'

const desks = floor as unknown as readonly AgentDesk[]
const macro = desks.find((desk) => desk.departmentId === 'global-macro')!
const quant = desks.find((desk) => desk.departmentId === 'quant-technical')!
const verification = desks.find((desk) => desk.departmentId === 'verification')!

async function withRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const children = [
    createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/cases/$caseId',
      component: () => null,
    }),
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test tree, not the app's */
  return render(<RouterProvider router={router as any} />)
}

const renderDesk = (desk: AgentDesk = macro) =>
  withRouter(<AgentDeskPage response={{ ok: true, desk }} />)

const runsCard = () =>
  screen.getByRole('heading', { name: /^Körningar/ }).closest('section')!

describe('the desk is the one the organisation seeded', () => {
  it('names the department and the person who owns it', async () => {
    await renderDesk()
    expect(screen.getByRole('heading', { name: 'Global Macro' })).toBeInTheDocument()
    expect(screen.getByText(/Head of Macro/)).toBeInTheDocument()
  })

  it('shows the responsibilities the firm actually recorded', async () => {
    await renderDesk()
    for (const responsibility of macro.responsibilities) {
      expect(screen.getByText(responsibility.summary)).toBeInTheDocument()
    }
  })

  it('shows the disciplines it handles', async () => {
    await renderDesk()
    for (const discipline of macro.handles) {
      expect(screen.getByText(discipline)).toBeInTheDocument()
    }
  })

  it('shows the work the registered playbook assigns it, with its brief', async () => {
    await renderDesk()
    const work = macro.assignableWork[0]!
    /*
     * Scoped to the card. The entry key also names each run below — the same
     * identifier in two roles, which is correct: a run is an execution of an
     * entry, and the page would be hiding the connection if it renamed either.
     */
    const card = screen
      .getByRole('heading', { name: /^Uppdrag i arbetsflödet/ })
      .closest('section')!
    expect(within(card).getByText(work.entryKey)).toBeInTheDocument()
    expect(within(card).getByText(work.brief)).toBeInTheDocument()
    /* The exact version, because a case pinned to an older one is still live. */
    expect(
      screen.getByText(`${work.playbookId} v${work.playbookVersion}`),
    ).toBeInTheDocument()
  })
})

describe('every run reads as what it is', () => {
  it('shows all three of the desk’s runs in their real states', async () => {
    await renderDesk()
    const card = runsCard()

    expect(screen.getByRole('heading', { name: `Körningar (${macro.runs.length})` }))
      .toBeInTheDocument()
    expect(within(card).getByText(RUN_STATE_LABEL.completed)).toBeInTheDocument()
    expect(
      within(card).getByText(RUN_STATE_LABEL['awaiting-acceptance']),
    ).toBeInTheDocument()
    expect(within(card).getByText(RUN_STATE_LABEL.rejected)).toBeInTheDocument()
  })

  it('gives a rejection its code AND the prose a person wrote', async () => {
    await renderDesk()
    const card = runsCard()
    const rejected = macro.runs.find((run) => run.state === 'rejected')!

    /*
     * Both halves. A code nobody can learn from and prose nobody can count are
     * each half a record, which is why the command requires both — and a page
     * showing only the code would put the half a person needs out of reach.
     */
    expect(
      within(card).getByText(new RegExp(REJECTION_CODE_LABEL[rejected.rejection!.code])),
    ).toBeInTheDocument()
    expect(within(card).getByText(rejected.rejection!.detail)).toBeInTheDocument()
    expect(
      within(card).getByText(new RegExp(rejected.rejection!.rejectedByEmployeeId)),
    ).toBeInTheDocument()
  })

  it('shows a failure with its bounded category, and never a provider message', async () => {
    await renderDesk(quant)
    const card = runsCard()
    const failed = quant.runs.find((run) => run.state === 'failed')!

    expect(
      within(card).getByText(new RegExp(RUN_FAILURE_LABEL[failed.failure!.category])),
    ).toBeInTheDocument()
    /* The failure vocabulary is closed, so nothing a provider returned is here. */
    expect(within(card).queryByText(/stack|Error:|at Object/)).not.toBeInTheDocument()
  })

  it('never shows a rejection and a failure on the same run', async () => {
    await renderDesk()
    for (const run of macro.runs) {
      expect(run.failure && run.rejection).toBeFalsy()
    }
  })

  it('states what was authorised beside what was spent', async () => {
    await renderDesk()
    const card = runsCard()

    /*
     * A stub cannot spend tokens or money, and the budget says so rather than
     * showing a blank — "the producer cannot consume this" and "nobody decided
     * a limit" are different facts about the firm.
     */
    expect(within(card).getAllByText(/Tokens: inte tillämpligt/).length).toBeGreaterThan(0)
    expect(within(card).getAllByText('Förbrukade ingenting').length).toBe(macro.runs.length)
  })

  it('links every run to the case it belongs to', async () => {
    await renderDesk()
    const hrefs = within(runsCard())
      .getAllByRole('link')
      .map((node) => node.getAttribute('href'))

    for (const run of macro.runs) {
      expect(hrefs).toContain(`/cases/${run.caseId}`)
    }
  })

  it('has no progress indicator, because a run reports no fraction', async () => {
    await renderDesk()
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
  })
})

describe('a desk that has done nothing says so', () => {
  it('does not imply a failure where there was simply no work', async () => {
    await renderDesk(verification)
    expect(
      screen.getByText(/Avdelningen har inte kört något ännu/),
    ).toBeInTheDocument()
    expect(screen.queryByText(RUN_STATE_LABEL.failed)).not.toBeInTheDocument()
  })
})

describe('the failed states', () => {
  it('explains a desk that does not exist without exposing a code', async () => {
    await withRouter(<AgentDeskPage response={{ ok: false, code: 'NOT_FOUND' }} />)
    expect(
      screen.getByText('Avdelningen finns inte, eller tilldelas inget arbete.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/NOT_FOUND/)).not.toBeInTheDocument()
  })

  it('distinguishes an unreachable database from a missing configuration', async () => {
    await withRouter(
      <AgentDeskPage response={{ ok: false, code: 'SERVICE_UNAVAILABLE' }} />,
    )
    expect(screen.getByText('Analysmiljön svarar inte just nu.')).toBeInTheDocument()
  })
})
