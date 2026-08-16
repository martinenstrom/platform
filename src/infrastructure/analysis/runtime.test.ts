/**
 * The runtime's pieces: the playbook graph, recorded replay, the result store
 * and the repositories.
 *
 * Orchestration itself moved to `orchestration.test.ts` when the orchestrator
 * stopped writing through repositories and became a command caller — it now
 * needs the whole command stack around it, and a test that gave it less would
 * be exercising a shape that no longer ships.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildTransitionEvent,
  transitionCase,
  type InvestmentCase,
  type TransitionEvent,
} from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  type AnalysisRepositories,
} from '~/application/analysis/repositories'
import {
  blockedEntries,
  readyEntries,
  validatePlaybook,
  type CasePlaybook,
} from '~/application/analysis/playbooks'
import { resultKey } from '~/application/analysis/resultStore'
import { executionIdentityKey } from '~/domain/analysis'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { createInMemoryResultStore } from './inMemoryResultStore'
import {
  createRecordedContributionProvider,
  type RecordedContribution,
} from './providers'

/* ------------------------------------------------------------------ fixtures */

const NOW = new Date('2026-07-27T09:00:00.000Z')

const investmentCase = (over: Partial<InvestmentCase> = {}): InvestmentCase => ({
  id: 'case-1',
  version: 1,
  subject: { kind: 'equity', ref: 'eq:xsto:volv-b', displayName: 'Volvo B' },
  question: 'Is the valuation supported by the earnings trajectory?',
  stage: 'intake',
  openedAt: NOW.toISOString(),
  ownerEmployeeId: 'research-head',
  participatingDepartmentIds: ['macro', 'equity-research'],
  transitions: [],
  ...over,
})

const playbook: CasePlaybook = {
  id: 'single-stock-deep-dive',
  version: '1.0.0',
  caseKind: 'equity',
  name: 'Single-stock deep dive',
  entries: [
    {
      key: 'macro',
      departmentId: 'macro',
      brief: 'Policy backdrop',
      blockedBy: [],
      optionalInputs: [],
      requirement: 'required',
      priority: 5,
    },
    {
      key: 'news',
      departmentId: 'news',
      brief: 'Material headlines',
      blockedBy: [],
      optionalInputs: [],
      requirement: 'optional',
      priority: 4,
    },
    {
      key: 'equity',
      departmentId: 'equity-research',
      brief: 'Fundamentals',
      blockedBy: ['macro'],
      optionalInputs: [],
      requirement: 'required',
      priority: 3,
    },
    {
      key: 'quant',
      departmentId: 'quant',
      brief: 'Statistical validation',
      blockedBy: ['macro'],
      optionalInputs: [],
      requirement: 'required',
      priority: 3,
    },
    {
      key: 'risk',
      departmentId: 'risk',
      brief: 'Downside',
      blockedBy: ['equity', 'quant'],
      optionalInputs: [],
      requirement: 'required',
      priority: 2,
    },
  ],
}

const validationContext = {
  knownDepartmentIds: ['macro', 'news', 'equity-research', 'quant', 'risk'],
  handlesByDepartment: {},
}

/* ------------------------------------------------------------------ playbook */

describe('playbook validation', () => {
  it('accepts a well-formed playbook', () => {
    expect(() => validatePlaybook(playbook, validationContext)).not.toThrow()
  })

  it('rejects a dependency cycle', () => {
    const cyclic: CasePlaybook = {
      ...playbook,
      entries: [
        {
          key: 'a',
          departmentId: 'macro',
          brief: '',
          blockedBy: ['b'],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
        },
        {
          key: 'b',
          departmentId: 'quant',
          brief: '',
          blockedBy: ['a'],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
        },
      ],
    }
    expect(() => validatePlaybook(cyclic, validationContext)).toThrow(/dependency cycle/)
  })

  it('rejects self-dependency', () => {
    const selfDep: CasePlaybook = {
      ...playbook,
      entries: [
        {
          key: 'a',
          departmentId: 'macro',
          brief: '',
          blockedBy: ['a'],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
        },
      ],
    }
    expect(() => validatePlaybook(selfDep, validationContext)).toThrow(
      /names itself as a blocking dependency/,
    )
  })

  it('rejects an unknown department', () => {
    const unknown: CasePlaybook = {
      ...playbook,
      entries: [
        {
          key: 'a',
          departmentId: 'astrology',
          brief: '',
          blockedBy: [],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
        },
      ],
    }
    expect(() => validatePlaybook(unknown, validationContext)).toThrow(
      /unknown department/,
    )
  })

  it('rejects duplicate entry keys', () => {
    const duplicate: CasePlaybook = {
      ...playbook,
      entries: [
        {
          key: 'a',
          departmentId: 'macro',
          brief: '',
          blockedBy: [],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
        },
        {
          key: 'a',
          departmentId: 'quant',
          brief: '',
          blockedBy: [],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
        },
      ],
    }
    expect(() => validatePlaybook(duplicate, validationContext)).toThrow(
      /duplicate entry keys/,
    )
  })

  it('rejects a required entry depending on an optional one', () => {
    // The optional entry may never complete, which would leave the required
    // one — and the case — permanently blocked with no way forward.
    const fragile: CasePlaybook = {
      ...playbook,
      entries: [
        {
          key: 'opt',
          departmentId: 'news',
          brief: '',
          blockedBy: [],
          optionalInputs: [],
          requirement: 'optional',
          priority: 1,
        },
        {
          key: 'req',
          departmentId: 'macro',
          brief: '',
          blockedBy: ['opt'],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
        },
      ],
    }
    expect(() => validatePlaybook(fragile, validationContext)).toThrow(
      /may legitimately never complete/,
    )
  })

  it('enforces a department mandate when a discipline is named', () => {
    const outside: CasePlaybook = {
      ...playbook,
      entries: [
        {
          key: 'a',
          departmentId: 'macro',
          brief: '',
          blockedBy: [],
          optionalInputs: [],
          requirement: 'required',
          priority: 1,
          disciplineTag: 'valuation',
        },
      ],
    }
    expect(() =>
      validatePlaybook(outside, {
        knownDepartmentIds: ['macro'],
        handlesByDepartment: { macro: ['macro', 'rates'] },
      }),
    ).toThrow(/does not handle/)
  })

  it('schedules only entries whose dependencies completed', () => {
    expect(
      readyEntries(playbook, [])
        .map((e) => e.key)
        .sort(),
    ).toEqual(['macro', 'news'])
    expect(
      readyEntries(playbook, ['macro', 'news'])
        .map((e) => e.key)
        .sort(),
    ).toEqual(['equity', 'quant'])
  })

  it('reports downstream work as blocked, not ready, after a failure', () => {
    const blocked = blockedEntries(playbook, ['macro'])
      .map((e) => e.key)
      .sort()
    // equity and quant depend on macro; risk depends on both.
    expect(blocked).toEqual(['equity', 'quant', 'risk'])
  })
})

/* ------------------------------------------------------ recorded replay */

describe('recorded contributions', () => {
  const recording: RecordedContribution = {
    departmentId: 'macro',
    evidenceSetId: 'set-1',
    agentContractVersion: '1.0.0',
    outputSchemaVersion: '1.0.0',
    captured: {
      prompt: { id: 'macro', version: '3', contentHash: 'ph' },
      model: { id: 'm', provider: 'anthropic', parameters: {}, parametersHash: 'mh' },
    },
    claims: [],
    observedStates: ['running'],
  }

  it('replays deterministically', async () => {
    const provider = createRecordedContributionProvider([recording])
    const request = {
      caseId: 'case-1',
      assignmentId: 'a1',
      departmentId: 'macro',
      employeeId: 'macro-analyst',
      brief: 'x',
      evidenceSetId: 'set-1',
      inputs: {},
      budget: { tokens: null, costMinorUnits: null, currency: null, deadlineMs: null },
      signal: new AbortController().signal,
    }
    const first = await provider.contribute(request)
    const second = await provider.contribute(request)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('refuses a recording made against different evidence', async () => {
    // Replaying it would attribute claims to evidence they never saw.
    const provider = createRecordedContributionProvider([recording])
    await expect(
      provider.contribute({
        caseId: 'case-1',
        assignmentId: 'a1',
        departmentId: 'macro',
        employeeId: 'macro-analyst',
        brief: 'x',
        evidenceSetId: 'set-DIFFERENT',
        inputs: {},
        budget: { tokens: null, costMinorUnits: null, currency: null, deadlineMs: null },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/never saw/)
  })
})

/* ------------------------------------------------------------ result store */

describe('the result store is exact-match only', () => {
  const inputs = {
    evidenceSetId: 'set-1',
    caseId: 'case-1',
    executionIdentity: executionIdentityKey({
      kind: 'model',
      prompt: { id: 'macro', version: '3', contentHash: 'ph' },
      model: { id: 'm', provider: 'anthropic', parameters: {}, parametersHash: 'mh' },
    }),
    agentContractVersion: '1',
    outputSchemaVersion: '1',
    canonicalizationVersion: '1',
    agentImplementationVersion: '1',
    departmentId: 'macro',
  }

  it('is stable for identical inputs', () => {
    expect(resultKey(inputs)).toBe(resultKey({ ...inputs }))
  })

  it.each([
    'evidenceSetId',
    'executionIdentity',
    'agentContractVersion',
    'outputSchemaVersion',
    'canonicalizationVersion',
    'agentImplementationVersion',
  ] as const)('changes when %s changes', (field) => {
    expect(resultKey({ ...inputs, [field]: 'different' })).not.toBe(resultKey(inputs))
  })

  it('distinguishes a playbook version where one applies', () => {
    expect(resultKey({ ...inputs, playbookVersion: '2.0.0' })).not.toBe(resultKey(inputs))
  })

  it('writes once and never overwrites', async () => {
    const store = createInMemoryResultStore()
    const key = resultKey(inputs)
    const provenance = await createInMemoryRepositories().provenance()
    const stored = { key, claims: [], providerKind: 'recorded' as const, inputs }
    await store.put({ ...stored, storedAt: 'T1' }, provenance)
    const second = await store.put({ ...stored, storedAt: 'T2' }, provenance)
    // A differing result under the same key means something is wrong;
    // overwriting would hide it.
    expect(second.storedAt).toBe('T1')
  })

  it('returns nothing for a key it has not seen', async () => {
    const store = createInMemoryResultStore()
    expect(await store.get('unknown')).toBeNull()
  })
})

/* ------------------------------------------------- persistence & concurrency */

describe('repositories', () => {
  let repos: AnalysisRepositories
  beforeEach(() => {
    repos = createInMemoryRepositories()
  })

  it('creates a case idempotently', async () => {
    const first = await repos.cases.create(investmentCase())
    const second = await repos.cases.create(investmentCase({ question: 'different' }))
    // A replayed create returns what is stored rather than duplicating or
    // clobbering it.
    expect(second.question).toBe(first.question)
  })

  it('rejects a stale write', async () => {
    await repos.cases.create(investmentCase())
    const moved = transitionCase(investmentCase(), 'research', {
      employeeId: 'e',
      departmentId: 'macro',
      at: NOW.toISOString(),
    })
    await repos.cases.save(moved, 1)

    // A second department computed its change against version 1 too.
    const stale = transitionCase(investmentCase(), 'research', {
      employeeId: 'other',
      departmentId: 'quant',
      at: NOW.toISOString(),
    })
    await expect(repos.cases.save(stale, 1)).rejects.toBeInstanceOf(
      ConcurrencyConflictError,
    )
  })

  it('loses no update when the loser re-reads and retries', async () => {
    await repos.cases.create(investmentCase())
    const first = transitionCase(investmentCase(), 'research', {
      employeeId: 'e',
      departmentId: 'macro',
      at: NOW.toISOString(),
    })
    await repos.cases.save(first, 1)

    const current = await repos.cases.get('case-1')
    const retried = transitionCase(current!, 'aggregation', {
      employeeId: 'other',
      departmentId: 'quant',
      at: NOW.toISOString(),
    })
    const saved = await repos.cases.save(retried, current!.version)

    expect(saved.stage).toBe('aggregation')
    expect(saved.version).toBe(3)
  })

  it('appends events idempotently', async () => {
    const event: TransitionEvent = buildTransitionEvent({
      eventId: 'e1',
      subject: 'case',
      caseId: 'case-1',
      fromState: 'intake',
      toState: 'research',
      // A case movement names its actor. The domain refuses to build one
      // without: `CaseTransition` requires both, and the adapter used to fill
      // the gap with an empty string.
      actorEmployeeId: 'research-director',
      actorDepartmentId: 'research-office',
      occurredAt: NOW.toISOString(),
      correlationId: 'c1',
      aggregateVersion: 2,
    })
    await repos.events.append(event)
    await repos.events.append(event)
    expect(await repos.events.listForCase('case-1')).toHaveLength(1)
  })

  it('offers no way to rewrite history', () => {
    // The port's shape is the guarantee: append and read, nothing else. A
    // correction is a new appended event, never an edit to an old one.
    const port = repos.events as unknown as Record<string, unknown>
    for (const mutator of ['update', 'delete', 'remove', 'replace', 'clear']) {
      expect(port[mutator]).toBeUndefined()
    }
    expect(typeof repos.events.append).toBe('function')
  })

  /*
   * Decision coverage moves to C1D-1B with the repository it tests. The
   * shape it asserted no longer exists: migration 0020 restructures
   * `case_decisions`, and the C1D-1 review removed the governance
   * snapshot whose compliance field had to be invented.
   */

  it('treats an evidence set as immutable', async () => {
    const set = {
      id: 'set-1',
      items: [],
      coTemporality: { kind: 'empty' as const },
      disagreements: [],
      assembledAt: 'T',
      correlationId: 'c',
    }
    await repos.evidence.save(set)
    const again = await repos.evidence.save({ ...set, assembledAt: 'LATER' })
    expect(again.assembledAt).toBe('T')
  })
})
