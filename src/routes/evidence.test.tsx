/**
 * The evidence desk, rendered.
 *
 * What matters on this page is not that it draws cards. It is that a person can
 * see, before they act, **what the firm holds** and **how an existing set came
 * to exist** — and that a set assembled before the governed act existed says so
 * rather than showing a blank where its selection rule would be.
 *
 * The governing rule the case surfaces are held to applies here too: if two
 * institutional states would lead a reader to do different things, they must
 * not render the same. A set with a recorded selection and a set without one
 * are exactly that pair.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { EvidencePage } from './evidence'
import type { EvidenceDeskView } from '~/application/analysis/evidenceDesk'
import type {
  EvidenceDeskResponse,
  OperatorIdentitiesResponse,
} from '~/infrastructure/analysis/serverFns'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'

const identities: readonly OperatorIdentity[] = [
  {
    employeeId: 'research-director',
    displayName: 'Research Director',
    roleTitle: 'Research Director',
    roleFunction: 'manager',
    seniority: 'head',
    departmentId: 'research-office',
    departmentName: 'Research Office',
    isGovernance: false,
  },
]

const view: EvidenceDeskView = {
  rules: [
    {
      ruleId: 'sovereign-yield-curve@1',
      states: 'Every par-yield observation the firm holds for the named curve family.',
      families: [{ id: 'us-par-curve', sourceId: 'treasury', subjectCount: 11 }],
    },
  ],
  holdings: {
    ruleId: 'sovereign-yield-curve@1',
    subjectFamily: 'us-par-curve',
    from: '2026-08-01',
    to: '2026-08-31',
    knownAt: '2026-08-20T09:00:00.000Z',
    subjects: [
      {
        subject: 'rate:us2y',
        observationCount: 3,
        earliestReferencePeriod: '2026-08-12',
        latestReferencePeriod: '2026-08-14',
      },
      {
        subject: 'rate:us30y',
        observationCount: 0,
        earliestReferencePeriod: null,
        latestReferencePeriod: null,
      },
    ],
    totalObservations: 3,
    derivableCount: 1,
  },
  recent: [
    {
      assembly: {
        assemblyId: 'asm-1',
        evidenceSetId: 'abc123def456abc7',
        selection: {
          ruleId: 'sovereign-yield-curve@1',
          subjectFamily: 'us-par-curve',
          from: '2026-08-01',
          to: '2026-08-31',
          knownAt: '2026-08-20T09:00:00.000Z',
        },
        selectedSubjects: ['rate:us2y', 'rate:us10y'],
        observationCount: 6,
        derivedCount: 1,
        assembledAt: '2026-08-20T09:00:00.000Z',
        actorEmployeeId: 'research-director',
        onBehalfOfDepartmentId: 'research-office',
        correlationId: 'corr-1',
      },
      sources: ['U.S. Department of the Treasury'],
      disagreementCount: 0,
      revisionCount: 0,
      missing: false,
    },
  ],
}

async function withRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const children = [
    createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/agents/$departmentId/commission',
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

const ok = (v: EvidenceDeskView): EvidenceDeskResponse => ({ ok: true, view: v })
const operators: OperatorIdentitiesResponse = { ok: true, identities }

describe('the evidence desk', () => {
  it('shows what the firm holds per tenor, including the tenors it holds none of', async () => {
    await withRouter(<EvidencePage desk={ok(view)} operators={operators} />)

    expect(screen.getByText('rate:us2y')).toBeInTheDocument()
    /*
     * A tenor the firm holds nothing for is SHOWN as zero rather than omitted.
     * A missing row reads as a series the rule does not cover, which is a
     * different fact and would send a reader looking for the wrong problem.
     */
    expect(screen.getByText('rate:us30y')).toBeInTheDocument()
    expect(screen.getByText(/3 observationer i fönstret/)).toBeInTheDocument()
    expect(screen.getByText(/1 härledda observationer skulle beräknas/)).toBeInTheDocument()
  })

  it('states the rule, the window and the knowledge time of a recorded assembly', async () => {
    await withRouter(<EvidencePage desk={ok(view)} operators={operators} />)

    /* The rule id appears in the selector and again on the recorded act. */
    expect(screen.getAllByText(/sovereign-yield-curve@1/).length).toBeGreaterThan(0)
    expect(screen.getByText(/2026-08-01–2026-08-31/)).toBeInTheDocument()
    expect(
      screen.getByText(/Sammanställt av research-director för research-office/),
    ).toBeInTheDocument()
  })

  it('says nothing has been assembled rather than showing an empty list', async () => {
    await withRouter(
      <EvidencePage desk={ok({ ...view, recent: [] })} operators={operators} />,
    )
    expect(
      screen.getByText(/har inte sammanställt något underlag genom den bokförda handlingen/),
    ).toBeInTheDocument()
  })

  it('says the firm holds nothing rather than offering an assembly that would refuse', async () => {
    const empty: EvidenceDeskView = {
      ...view,
      holdings: {
        ...view.holdings!,
        subjects: view.holdings!.subjects.map((s) => ({
          ...s,
          observationCount: 0,
          earliestReferencePeriod: null,
          latestReferencePeriod: null,
        })),
        totalObservations: 0,
        derivableCount: 0,
      },
    }
    await withRouter(<EvidencePage desk={ok(empty)} operators={operators} />)
    expect(
      screen.getByText(/håller inga observationer för det här fönstret/),
    ).toBeInTheDocument()
  })

  it('reports a read failure as a failure, not as an empty firm', async () => {
    await withRouter(
      <EvidencePage
        desk={{ ok: false, code: 'SERVICE_UNAVAILABLE' }}
        operators={operators}
      />,
    )
    expect(screen.getByText('Analysmiljön svarar inte just nu.')).toBeInTheDocument()
    expect(screen.queryByText(/Sammanställ underlag/)).not.toBeInTheDocument()
  })

  it('refuses to offer the act when nobody can be named for it', async () => {
    await withRouter(
      <EvidencePage
        desk={ok(view)}
        operators={{ ok: false, code: 'SERVICE_UNAVAILABLE' }}
      />,
    )
    /*
     * An act the firm cannot book to a person is not offered at all. The
     * mandate would refuse it anyway; offering the button would make the
     * refusal look like a fault.
     */
    expect(screen.queryByRole('button', { name: /Sammanställ underlag/ })).toBeNull()
    expect(screen.getByText(/Medarbetarregistret kunde inte läsas/)).toBeInTheDocument()
  })
})
