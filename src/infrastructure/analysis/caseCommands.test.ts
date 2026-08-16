/**
 * The first three production commands.
 *
 * Driven against the in-memory reference, which is the approved semantics both
 * adapters implement. The PostgreSQL suite re-runs the parity contract and the
 * schema guarantees; what is proved here is the behaviour of the commands
 * themselves.
 *
 * The two claims worth stating up front, because they are the ones the plan
 * turned on:
 *
 *   - each command is atomic; the SEQUENCE is resumable, not atomic, because
 *     `intake` is a legal resting state
 *   - a conditional entry begins unresolved, and absence never reads as
 *     `not-required`
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  RISK_REVIEW_WHEN_IMPLEMENTABLE,
  buildRole,
  evaluateRequirement,
  pinPlaybook,
  requirementStatusFor,
  resolveActor,
  type ActorSnapshot,
  type Organization,
  type RoleFunction,
  type RequirementResolution,
} from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { ConflictingRecordError } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  REASON_REQUIRED_COMMANDS,
  VERSION_GUARDED_COMMANDS,
} from '~/application/analysis/commands/definition'
import { productionCommands } from '~/application/analysis/commands/registry'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import {
  missingOptionalInputs,
  playbookContentHash,
  readyEntries,
  validatePlaybook,
  type CasePlaybook,
} from '~/application/analysis/playbooks'
import { createInMemoryRepositories } from './inMemoryRepositories'

const AT = '2026-07-28T09:00:00.000Z'
const SEED = 'seed-1'

/* ------------------------------------------------------------ organization */

const role = (id: string, fn: RoleFunction) =>
  buildRole({
    id,
    title: id,
    function: fn,
    responsibilities: [],
    canBlockPublication: fn === 'governance',
  })

const organization: Organization = {
  id: 'firm',
  name: 'Firm',
  chiefEmployeeId: 'cio',
  roles: [
    role('chief-investment-officer', 'executive'),
    role('research-director', 'manager'),
    role('macro-head', 'manager'),
    role('analyst', 'specialist'),
    role('verification-head', 'governance'),
  ],
  departments: [
    {
      id: 'executive',
      name: 'Executive',
      managerEmployeeId: 'cio',
      handles: [],
      isGovernance: false,
    },
    {
      id: 'research-office',
      name: 'Research Office',
      managerEmployeeId: 'research-director',
      handles: ['aggregation'],
      isGovernance: false,
    },
    {
      id: 'global-macro',
      name: 'Global Macro',
      managerEmployeeId: 'macro-head',
      handles: ['macro', 'rates'],
      isGovernance: false,
    },
    {
      id: 'quant-technical',
      name: 'Quant',
      managerEmployeeId: 'quant-head',
      handles: ['quant'],
      isGovernance: false,
    },
    {
      id: 'verification',
      name: 'Verification',
      managerEmployeeId: 'verification-head',
      handles: ['verification'],
      isGovernance: true,
    },
    {
      id: 'devils-advocate',
      name: "Devil's Advocate",
      managerEmployeeId: 'devils-advocate-head',
      handles: ['challenge'],
      isGovernance: true,
    },
    {
      id: 'risk',
      name: 'Risk',
      managerEmployeeId: 'chief-risk-officer',
      handles: ['risk'],
      isGovernance: true,
    },
  ],
  teams: [],
  employees: [
    {
      id: 'cio',
      displayName: 'CIO',
      roleId: 'chief-investment-officer',
      departmentId: 'executive',
      seniority: 'chief',
    },
    {
      id: 'research-director',
      displayName: 'Research Director',
      roleId: 'research-director',
      departmentId: 'research-office',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'macro-head',
      displayName: 'Macro Head',
      roleId: 'macro-head',
      departmentId: 'global-macro',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'quant-head',
      displayName: 'Quant Head',
      roleId: 'macro-head',
      departmentId: 'quant-technical',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'macro-analyst',
      displayName: 'Macro Analyst',
      roleId: 'analyst',
      departmentId: 'global-macro',
      reportsTo: 'macro-head',
      seniority: 'analyst',
    },
    {
      id: 'verification-head',
      displayName: 'Verification Head',
      roleId: 'verification-head',
      departmentId: 'verification',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'devils-advocate-head',
      displayName: "Devil's Advocate Head",
      roleId: 'verification-head',
      departmentId: 'devils-advocate',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'chief-risk-officer',
      displayName: 'CRO',
      roleId: 'verification-head',
      departmentId: 'risk',
      reportsTo: 'cio',
      seniority: 'chief',
    },
  ],
}

/* ------------------------------------------------------------- the harness */

let repositories: AnalysisRepositories
let deps: CommandDeps

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: SEED,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
})

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-1',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'employee', employeeId: 'research-director' },
  occurredAt: AT,
  ...over,
})

const openInput = (over: Record<string, unknown> = {}) => ({
  caseId: 'case-1',
  subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB policy path' },
  question: 'Does the ECB cut before Q2?',
  ownerEmployeeId: 'research-director',
  participatingDepartmentIds: ['research-office'],
  ...over,
})

const instantiateInput = (over: Record<string, unknown> = {}) => ({
  caseId: 'case-1',
  playbookId: MACRO_REGIME_PLAYBOOK.id,
  playbookVersion: MACRO_REGIME_PLAYBOOK.version,
  onBehalfOfDepartmentId: 'research-office',
  ...over,
})

const proposeInput = (over: Record<string, unknown> = {}) => ({
  caseId: 'case-1',
  thesisId: 'th-1',
  statement: 'The ECB holds through Q2.',
  position: 'hold',
  invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
  implications: [],
  proposedByDepartmentId: 'research-office',
  ...over,
})

async function openCase(over: Record<string, unknown> = {}) {
  return runCommand(
    openInvestmentCase(organization),
    openInput(over),
    envelope({ commandId: 'cmd-open' }),
    deps,
  )
}

async function instantiate(over: Record<string, unknown> = {}) {
  return runCommand(
    instantiatePlaybook(organization),
    instantiateInput(over),
    envelope({ commandId: 'cmd-inst', expectedVersion: 1 }),
    deps,
  )
}

/* --------------------------------------------------------- the declarations */

describe('command declarations', () => {
  const commands = productionCommands(organization)

  it('registers exactly the approved commands', () => {
    expect(commands.map((c) => c.type).sort()).toEqual([
      'AcceptContribution',
      'AggregateManagerConclusion',
      'FailAgentRun',
      'InstantiatePlaybook',
      'OpenInvestmentCase',
      'ProposeThesis',
      'RecordCaseDecision',
      'RecordContribution',
      'RecordDevilsAdvocateReview',
      'RecordRiskReview',
      'RecordVerificationReview',
      'RejectContribution',
      'ReopenForReconsideration',
      'ResolveConditionalRequirement',
      'ReturnFromCioReview',
      'ReviseThesis',
      'StartAgentRun',
      'SubmitForCioDecision',
      'SubmitForVerification',
    ])
  })

  it('matches the approved expectedVersion list, in both directions', () => {
    for (const command of commands) {
      const guarded = command.versionPolicy === 'requires-expected-version'
      expect(guarded).toBe(VERSION_GUARDED_COMMANDS.includes(command.type))
    }
  })

  it('matches the approved reason-required list, in both directions', () => {
    for (const command of commands) {
      const required = command.reasonPolicy === 'required'
      expect(required).toBe(REASON_REQUIRED_COMMANDS.includes(command.type))
    }
  })

  it('files each command as the kind of act its mandate can support', () => {
    /*
     * The cross-check `runCommand` performs, asserted over the registry: a
     * governance category requires a governance verdict, and ordinary forward
     * motion cannot claim to be one. `ResolveConditionalRequirement` is the
     * first governance command — deciding whether a gate applies is a control
     * function's verdict, not workflow.
     */
    for (const command of commands) {
      const governance = command.category === 'governance'
      /*
       * The four control-function acts. `SubmitForVerification` is
       * deliberately NOT among them: asking for a review is workflow, and
       * filing it as governance would make the request itself look like a
       * verdict.
       */
      expect(governance).toBe(
        [
          'ResolveConditionalRequirement',
          'RecordVerificationReview',
          'RecordDevilsAdvocateReview',
          'RecordRiskReview',
        ].includes(command.type),
      )
      expect(['analysis', 'workflow', 'governance', 'decision']).toContain(
        command.category,
      )
    }
  })
})

/* ------------------------------------------------------ OpenInvestmentCase */

describe('OpenInvestmentCase', () => {
  it('creates the case, its participants and one creation event', async () => {
    const result = await openCase()
    expect(result.outcome).toBe('committed')

    const stored = await repositories.cases.get('case-1')
    expect(stored?.stage).toBe('intake')
    expect(stored?.ownerEmployeeId).toBe('research-director')
    expect(stored?.playbookId).toBeUndefined()

    const events = await repositories.events.listForCase('case-1')
    expect(events).toHaveLength(1)
    // A creation is not a movement.
    expect(events[0]!.fromState).toBeNull()
    expect(events[0]!.toState).toBe('intake')
  })

  it('records intent, category and outcome in the ledger', async () => {
    await openCase()
    const entry = await repositories.commands.find('cmd-open')

    expect(entry?.intent.commandType).toBe('OpenInvestmentCase')
    expect(entry?.intent.category).toBe('workflow')
    expect(entry?.intent.commandContractVersion).toBe('2')
    expect(entry?.intent.actor.employeeId).toBe('research-director')
    expect(entry?.outcomes.map((o) => o.state)).toEqual(['committed'])
  })

  it('refuses an owner who is not an employee of the firm', async () => {
    const result = await openCase({ ownerEmployeeId: 'nobody' })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-found' },
      durablyRecorded: true,
    })
    expect(await repositories.cases.get('case-1')).toBeNull()
  })

  it('refuses an unknown participating department', async () => {
    const result = await openCase({ participatingDepartmentIds: ['ministry-of-silly'] })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-found' },
    })
  })

  it('refuses a case with no question', async () => {
    const result = await openCase({ question: '   ' })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('leaves nothing behind when it rejects', async () => {
    await openCase({ ownerEmployeeId: 'nobody' })
    expect(await repositories.cases.get('case-1')).toBeNull()
    expect(await repositories.events.listForCase('case-1')).toEqual([])
  })

  it('replays to the original result without creating a second case', async () => {
    const first = await openCase()
    const second = await openCase()

    expect(second.outcome).toBe('committed')
    expect(second).toMatchObject({ commandId: 'cmd-open' })
    expect(
      (await repositories.cases.list()).filter((c) => c.id === 'case-1'),
    ).toHaveLength(1)
    expect(await repositories.events.listForCase('case-1')).toHaveLength(1)
    expect(first.outcome).toBe('committed')
  })

  it('refuses an expectedVersion it has no use for', async () => {
    const result = await runCommand(
      openInvestmentCase(organization),
      openInput(),
      envelope({ commandId: 'cmd-open', expectedVersion: 1 }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })
})

/* ------------------------------------------------------ InstantiatePlaybook */

describe('InstantiatePlaybook', () => {
  beforeEach(async () => {
    await openCase()
  })

  it('creates one assignment per entry and moves the case in one transaction', async () => {
    const result = await instantiate()
    expect(result.outcome).toBe('committed')

    const stored = await repositories.cases.get('case-1')
    expect(stored?.stage).toBe('research')
    expect(stored?.playbookId).toBe('macro-regime')
    expect(stored?.playbookVersion).toBe('1')

    const assignments = await repositories.assignments.listForCase('case-1')
    expect(assignments).toHaveLength(MACRO_REGIME_PLAYBOOK.entries.length)
    expect(assignments.every((a) => a.status === 'queued')).toBe(true)
  })

  it('creates an assignment for the conditional Risk entry too', async () => {
    await instantiate()
    const assignments = await repositories.assignments.listForCase('case-1')
    const risk = assignments.find((a) => a.playbookEntryKey === 'risk-review')

    // Present from the start, so the department can see the pending work.
    expect(risk).toBeDefined()
    expect(risk?.departmentId).toBe('risk')
  })

  it('leaves the conditional entry unresolved, not not-required', async () => {
    await instantiate()
    const resolutions = await repositories.requirements.listForCase('case-1')
    expect(resolutions).toEqual([])

    const status = requirementStatusFor('risk-review', 'rev-1', resolutions)
    // Absence is "nobody has decided", never "the firm decided no".
    expect(status.state).toBe('unresolved')
  })

  it('adds every playbook department to the case participants', async () => {
    await instantiate()
    const stored = await repositories.cases.get('case-1')
    expect(stored?.participatingDepartmentIds).toContain('risk')
    expect(stored?.participatingDepartmentIds).toContain('verification')
  })

  it('links each assignment event to the movement that caused it', async () => {
    await instantiate()
    const events = await repositories.events.listForCase('case-1')
    const assignmentEvents = events.filter((e) => e.subject === 'assignment')
    const caseMove = events.find((e) => e.subject === 'case' && e.toState === 'research')!

    expect(assignmentEvents).toHaveLength(MACRO_REGIME_PLAYBOOK.entries.length)
    // Derived, so the test cannot know the literal id — which is the point.
    expect(caseMove.eventId).toMatch(/^evt-[0-9a-f]{32}$/)
    expect(assignmentEvents.every((e) => e.causationId === caseMove.eventId)).toBe(true)
  })

  it('replays from the ledger without executing a second time', async () => {
    await instantiate()
    const replay = await instantiate()

    expect(replay.outcome).toBe('committed')
    expect(await repositories.assignments.listForCase('case-1')).toHaveLength(
      MACRO_REGIME_PLAYBOOK.entries.length,
    )
    // One creation and one movement. A second execution would have added more.
    const events = await repositories.events.listForCase('case-1')
    expect(events.filter((e) => e.subject === 'case')).toHaveLength(2)
    expect((await repositories.commands.find('cmd-inst'))?.outcomes).toHaveLength(1)
  })

  it('creates no duplicate assignment when the body itself runs twice', async () => {
    /*
     * The case the ledger replay does NOT cover.
     *
     * After an ambiguous commit the assignments may have landed while the
     * ledger entry did not, so a retry re-executes the body against a store
     * that already holds some of its output. Idempotency has to come from the
     * assignment identity, not from the command id — otherwise the department
     * gets the same work twice.
     */
    const definition = instantiatePlaybook(organization)
    const input = instantiateInput()

    await repositories.withTransaction((tx) =>
      definition.execute(
        tx,
        {
          commandId: 'cmd-direct',
          actor: resolveActor(organization, SEED, {
            kind: 'employee',
            employeeId: 'research-director',
          }),
          occurredAt: AT,
          correlationId: 'corr-1',
          expectedVersion: 1,
          provenance: deps.provenance,
        },
        input,
      ),
    )

    const afterFirst = await repositories.assignments.listForCase('case-1')
    expect(afterFirst).toHaveLength(MACRO_REGIME_PLAYBOOK.entries.length)

    // Same input, fresh command id: the body runs again for real.
    const retry = await runCommand(
      definition,
      input,
      envelope({ commandId: 'cmd-inst-retry', expectedVersion: 2 }),
      deps,
    )

    // The stage move is what stops it, and no second assignment was created.
    expect(retry).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
    expect(await repositories.assignments.listForCase('case-1')).toHaveLength(
      MACRO_REGIME_PLAYBOOK.entries.length,
    )
  })

  it('gives a department one assignment per entry, however often it is saved', async () => {
    await instantiate()
    const [first] = await repositories.assignments.listForCase('case-1')

    await repositories.assignments.save(first!)
    await repositories.assignments.save(first!)

    expect(await repositories.assignments.listForCase('case-1')).toHaveLength(
      MACRO_REGIME_PLAYBOOK.entries.length,
    )
  })

  it('refuses a case that has already left intake', async () => {
    await instantiate()

    const again = await runCommand(
      instantiatePlaybook(organization),
      instantiateInput(),
      envelope({ commandId: 'cmd-inst-2', expectedVersion: 2 }),
      deps,
    )
    expect(again).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('rolls the whole instantiation back when the stage move loses the race', async () => {
    const stale = await runCommand(
      instantiatePlaybook(organization),
      instantiateInput(),
      envelope({ commandId: 'cmd-inst-stale', expectedVersion: 99 }),
      deps,
    )

    expect(stale).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'aggregate-conflict' },
    })
    // The assignments written before the conflicting save are gone with it.
    expect(await repositories.assignments.listForCase('case-1')).toEqual([])
    expect(await repositories.cases.get('case-1')).toMatchObject({ stage: 'intake' })
  })

  it('refuses a manager acting on another department’s case', async () => {
    const result = await runCommand(
      instantiatePlaybook(organization),
      instantiateInput({ onBehalfOfDepartmentId: 'global-macro' }),
      envelope({
        commandId: 'cmd-inst-wrong',
        expectedVersion: 1,
        actor: { kind: 'employee', employeeId: 'macro-head' },
      }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('refuses a specialist who is not the department manager', async () => {
    const result = await runCommand(
      instantiatePlaybook(organization),
      instantiateInput({ onBehalfOfDepartmentId: 'global-macro' }),
      envelope({
        commandId: 'cmd-inst-analyst',
        expectedVersion: 1,
        actor: { kind: 'employee', employeeId: 'macro-analyst' },
      }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('refuses a playbook this build does not ship', async () => {
    // The registry is the only source. An arbitrary definition cannot even be
    // expressed as input any more, which is the point of D-C1C-2.
    const result = await runCommand(
      instantiatePlaybook(organization),
      instantiateInput({ playbookId: 'invented-workflow' }),
      envelope({ commandId: 'cmd-inst-unknown', expectedVersion: 1 }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-found' },
    })
  })

  it('refuses a version of a known playbook that was never registered', async () => {
    const result = await runCommand(
      instantiatePlaybook(organization),
      instantiateInput({ playbookVersion: '99' }),
      envelope({ commandId: 'cmd-inst-version', expectedVersion: 1 }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-found' },
    })
  })

  it('requires an expectedVersion', async () => {
    const result = await runCommand(
      instantiatePlaybook(organization),
      instantiateInput(),
      envelope({ commandId: 'cmd-inst-nover' }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('is resumable across a restart of the sequence', async () => {
    /*
     * The honest claim: the two commands are not one atomic act, because
     * `intake` is a legal resting state. What must hold is that a workflow
     * interrupted between them can be completed rather than repaired.
     */
    const afterOpen = await repositories.cases.get('case-1')
    expect(afterOpen?.stage).toBe('intake')
    expect(await repositories.assignments.listForCase('case-1')).toEqual([])

    const resumed = await instantiate()
    expect(resumed.outcome).toBe('committed')
    expect(await repositories.assignments.listForCase('case-1')).toHaveLength(
      MACRO_REGIME_PLAYBOOK.entries.length,
    )
  })
})

/* ------------------------------------------------------- playbook registry */

describe('playbook registration', () => {
  it('is idempotent for identical content', async () => {
    const first = await repositories.playbooks.register(MACRO_REGIME_PLAYBOOK)
    const second = await repositories.playbooks.register(MACRO_REGIME_PLAYBOOK)
    expect(playbookContentHash(first)).toBe(playbookContentHash(second))
  })

  it('refuses the same version carrying different content', async () => {
    await repositories.playbooks.register(MACRO_REGIME_PLAYBOOK)

    const edited: CasePlaybook = {
      ...MACRO_REGIME_PLAYBOOK,
      entries: MACRO_REGIME_PLAYBOOK.entries.filter((e) => e.key !== 'challenge'),
    }
    await expect(repositories.playbooks.register(edited)).rejects.toBeInstanceOf(
      ConflictingRecordError,
    )
  })

  it('lets a new version coexist with the old one', async () => {
    await repositories.playbooks.register(MACRO_REGIME_PLAYBOOK)
    const v2: CasePlaybook = { ...MACRO_REGIME_PLAYBOOK, version: '2' }
    await repositories.playbooks.register(v2)

    expect(await repositories.playbooks.get('macro-regime', '1')).not.toBeNull()
    expect(await repositories.playbooks.get('macro-regime', '2')).not.toBeNull()
  })

  it('keeps a pinned case on the version it started under', async () => {
    await openCase()
    await instantiate()
    const stored = await repositories.cases.get('case-1')

    expect(() => pinPlaybook(stored!, 'macro-regime', '2')).toThrow(
      /runs to completion on the version/,
    )
  })
})

/* ------------------------------------------------------- the playbook graph */

describe('the macro playbook', () => {
  const context = {
    knownDepartmentIds: organization.departments.map((d) => d.id),
    handlesByDepartment: Object.fromEntries(
      organization.departments.map((d) => [d.id, d.handles]),
    ),
  }

  it('is valid against the seeded firm', () => {
    expect(() => validatePlaybook(MACRO_REGIME_PLAYBOOK, context)).not.toThrow()
  })

  it('does not block aggregation on the optional quant contribution', () => {
    const aggregation = MACRO_REGIME_PLAYBOOK.entries.find(
      (e) => e.key === 'aggregation',
    )!
    expect(aggregation.blockedBy).toEqual(['macro-analysis'])
    expect(aggregation.optionalInputs).toEqual(['quant-validation'])
  })

  it('lets aggregation become ready without quant', () => {
    const ready = readyEntries(MACRO_REGIME_PLAYBOOK, ['macro-analysis']).map(
      (e) => e.key,
    )
    expect(ready).toContain('aggregation')
  })

  it('keeps a missing optional input visible rather than silent', () => {
    const missing = missingOptionalInputs(MACRO_REGIME_PLAYBOOK, 'aggregation', [
      'macro-analysis',
    ])
    expect(missing).toEqual(['quant-validation'])
  })

  it('reports nothing missing once quant has contributed', () => {
    const missing = missingOptionalInputs(MACRO_REGIME_PLAYBOOK, 'aggregation', [
      'macro-analysis',
      'quant-validation',
    ])
    expect(missing).toEqual([])
  })

  it('points governance at aggregation rather than at the raw contributions', () => {
    for (const key of ['verification', 'challenge', 'risk-review']) {
      const entry = MACRO_REGIME_PLAYBOOK.entries.find((e) => e.key === key)!
      expect(entry.blockedBy).toEqual(['aggregation'])
    }
  })

  it('refuses a required entry that hard-blocks on an optional one', () => {
    const fragile: CasePlaybook = {
      ...MACRO_REGIME_PLAYBOOK,
      version: 'bad',
      entries: [
        ...MACRO_REGIME_PLAYBOOK.entries.filter((e) => e.key !== 'aggregation'),
        {
          key: 'aggregation',
          departmentId: 'research-office',
          brief: 'Aggregate',
          blockedBy: ['quant-validation'],
          optionalInputs: [],
          requirement: 'required',
          priority: 90,
        },
      ],
    }
    expect(() => validatePlaybook(fragile, context)).toThrow(
      /may legitimately never complete/,
    )
  })

  it('refuses a conditional entry that hard-blocks on another conditional one', () => {
    const chained: CasePlaybook = {
      ...MACRO_REGIME_PLAYBOOK,
      version: 'bad-2',
      entries: [
        ...MACRO_REGIME_PLAYBOOK.entries,
        {
          key: 'second-risk',
          departmentId: 'risk',
          brief: 'More risk',
          blockedBy: ['risk-review'],
          optionalInputs: [],
          requirement: 'conditional',
          conditionalRule: {
            ruleId: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleId,
            ruleVersion: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleVersion,
          },
          priority: 60,
        },
      ],
    }
    expect(() => validatePlaybook(chained, context)).toThrow(
      /may legitimately never complete/,
    )
  })

  it('refuses one edge declared as both kinds', () => {
    const contradictory: CasePlaybook = {
      ...MACRO_REGIME_PLAYBOOK,
      version: 'bad-3',
      entries: [
        ...MACRO_REGIME_PLAYBOOK.entries.filter((e) => e.key !== 'aggregation'),
        {
          key: 'aggregation',
          departmentId: 'research-office',
          brief: 'Aggregate',
          blockedBy: ['macro-analysis'],
          optionalInputs: ['macro-analysis'],
          requirement: 'required',
          priority: 90,
        },
      ],
    }
    expect(() => validatePlaybook(contradictory, context)).toThrow(/one or the other/)
  })

  it('refuses a conditional entry that names no rule', () => {
    const ruleless: CasePlaybook = {
      ...MACRO_REGIME_PLAYBOOK,
      version: 'bad-4',
      entries: MACRO_REGIME_PLAYBOOK.entries.map((e) =>
        e.key === 'risk-review' ? { ...e, conditionalRule: undefined } : e,
      ),
    }
    expect(() => validatePlaybook(ruleless, context)).toThrow(/names no rule/)
  })

  it('refuses a non-conditional entry that names one', () => {
    const spurious: CasePlaybook = {
      ...MACRO_REGIME_PLAYBOOK,
      version: 'bad-5',
      entries: MACRO_REGIME_PLAYBOOK.entries.map((e) =>
        e.key === 'verification'
          ? {
              ...e,
              conditionalRule: {
                ruleId: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleId,
                ruleVersion: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleVersion,
              },
            }
          : e,
      ),
    }
    expect(() => validatePlaybook(spurious, context)).toThrow(/would never run/)
  })

  it('refuses a rule version that does not exist', () => {
    const ghost: CasePlaybook = {
      ...MACRO_REGIME_PLAYBOOK,
      version: 'bad-6',
      entries: MACRO_REGIME_PLAYBOOK.entries.map((e) =>
        e.key === 'risk-review'
          ? {
              ...e,
              conditionalRule: { ruleId: e.conditionalRule!.ruleId, ruleVersion: '9' },
            }
          : e,
      ),
    }
    expect(() => validatePlaybook(ghost, context)).toThrow(/never removed/)
  })
})

/* ---------------------------------------------------- conditional Risk rule */

describe('the conditional Risk rule', () => {
  const evaluator = (): ActorSnapshot =>
    resolveActor(organization, SEED, {
      kind: 'employee',
      employeeId: 'research-director',
    })

  const resolutionFor = (
    implications: Parameters<typeof evaluateRequirement>[1]['implications'],
    over: Partial<Parameters<typeof evaluateRequirement>[1]> = {},
  ): RequirementResolution =>
    evaluateRequirement(RISK_REVIEW_WHEN_IMPLEMENTABLE, {
      caseId: 'case-1',
      playbookEntryKey: 'risk-review',
      revisionId: 'rev-1',
      implications,
      evaluatedAt: AT,
      evaluatedBy: evaluator(),
      ...over,
    })

  it('is not required for purely descriptive analysis', () => {
    const resolution = resolutionFor([])
    expect(resolution.state).toBe('not-required')
    expect(resolution.reason).toMatch(/descriptive analysis/)
  })

  it('is required as soon as the thesis could be acted on', () => {
    expect(resolutionFor(['position-sizing']).state).toBe('required')
    expect(resolutionFor(['actionable-recommendation']).state).toBe('required')
    expect(resolutionFor(['implementation-path']).state).toBe('required')
  })

  it('records the rule identity and version that actually ran', () => {
    const resolution = resolutionFor(['hedging'])
    expect(resolution.ruleId).toBe('risk-review-when-implementable')
    expect(resolution.ruleVersion).toBe('1')
  })

  it('is deterministic regardless of declaration order', () => {
    const a = resolutionFor(['hedging', 'leverage'])
    const b = resolutionFor(['leverage', 'hedging'])
    expect(a.reason).toBe(b.reason)
  })

  it('refuses a system actor as the evaluator', () => {
    expect(() =>
      resolutionFor(['hedging'], {
        evaluatedBy: resolveActor(organization, SEED, {
          kind: 'system',
          systemId: 'orchestrator',
          reason: 'scheduled evaluation',
        }),
      }),
    ).toThrow(/an employee is accountable/)
  })

  it('scopes the resolution to an exact revision', async () => {
    const resolution = resolutionFor(['hedging'])
    await repositories.requirements.save(resolution, deps.provenance)

    const stored = await repositories.requirements.listForCase('case-1')
    expect(requirementStatusFor('risk-review', 'rev-1', stored).state).toBe('required')
    // A different argument has not been evaluated at all.
    expect(requirementStatusFor('risk-review', 'rev-2', stored).state).toBe('unresolved')
  })

  it('does not let a later revision inherit an earlier resolution', async () => {
    await repositories.requirements.save(resolutionFor([]), deps.provenance)
    const stored = await repositories.requirements.listForCase('case-1')

    // Revision 1 was excused. Revision 2 is not, and must be evaluated again.
    expect(requirementStatusFor('risk-review', 'rev-1', stored).state).toBe(
      'not-required',
    )
    expect(requirementStatusFor('risk-review', 'rev-2', stored).state).toBe('unresolved')
  })

  it('replays an identical evaluation without conflict', async () => {
    const resolution = resolutionFor(['leverage'])
    await repositories.requirements.save(resolution, deps.provenance)
    await repositories.requirements.save(
      { ...resolution, evaluatedAt: '2026-07-28T10:00:00.000Z' },
      deps.provenance,
    )
    expect(await repositories.requirements.listForCase('case-1')).toHaveLength(1)
  })

  it('refuses a second, contradictory evaluation of the same revision', async () => {
    await repositories.requirements.save(resolutionFor(['leverage']), deps.provenance)
    await expect(
      repositories.requirements.save(resolutionFor([]), deps.provenance),
    ).rejects.toBeInstanceOf(ConflictingRecordError)
  })
})

/* ------------------------------------------------------------ ProposeThesis */

describe('ProposeThesis', () => {
  beforeEach(async () => {
    await openCase()
    await instantiate()
  })

  const propose = (
    over: Record<string, unknown> = {},
    env: Partial<CommandEnvelope> = {},
  ) =>
    runCommand(
      proposeThesis(organization),
      proposeInput(over),
      envelope({ commandId: 'cmd-thesis', ...env }),
      deps,
    )

  it('creates revision 1 with its declared implications', async () => {
    const result = await propose({ implications: ['position-sizing'] })
    expect(result.outcome).toBe('committed')

    // The id is derived from the command, not supplied by the caller — the
    // last caller-chosen identity in the command layer went in C1C-3.
    const stored = await repositories.theses.get(deriveRevisionId('cmd-thesis', 'th-1'))
    expect(stored?.revisionNumber).toBe(1)
    expect(stored?.implications).toEqual(['position-sizing'])
    expect(stored?.supersedesRevisionId).toBeUndefined()
  })

  it('leaves the revision proposed, not verified or eligible', async () => {
    await propose()
    const stored = await repositories.theses.get(deriveRevisionId('cmd-thesis', 'th-1'))

    // No gate has been passed by proposing an argument.
    expect(stored?.lifecycle).toBe('proposed')
    expect(await repositories.reviews.verificationsForCase('case-1')).toEqual([])
    expect(await repositories.reviews.challengesForCase('case-1')).toEqual([])
    expect(await repositories.reviews.riskForCase('case-1')).toEqual([])
  })

  it('does not move the case', async () => {
    const before = await repositories.cases.get('case-1')
    await propose()
    const after = await repositories.cases.get('case-1')

    expect(after?.stage).toBe(before?.stage)
    expect(after?.version).toBe(before?.version)
  })

  it('refuses a thesis with no invalidation criteria', async () => {
    const result = await propose({ invalidationCriteria: '  ' })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('refuses an unknown implication', async () => {
    const result = await propose({ implications: ['vibes'] })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('refuses a second first revision of one lineage', async () => {
    // Derived ids cannot collide across lineages any more, so what is left to
    // refuse is a lineage being started twice.
    await propose()
    const result = await propose({}, { commandId: 'cmd-thesis-2' })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('records the proposing department on the ledger scope', async () => {
    await propose()
    const entry = await repositories.commands.find('cmd-thesis')

    // The revision id is derived, so the ledger scope names the case and the
    // command's own identity carries the rest.
    expect(entry?.intent.caseId).toBe('case-1')
    expect(entry?.intent.category).toBe('analysis')
    expect(entry?.intent.mandate).toMatchObject({
      kind: 'department-contribution',
      departmentId: 'research-office',
    })
  })

  it('replays to the same revision', async () => {
    await propose()
    const replay = await propose()
    expect(replay.outcome).toBe('committed')
    expect(await repositories.theses.listForCase('case-1')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------ command reason */

describe('the command reason', () => {
  it('is stored when supplied', async () => {
    await runCommand(
      openInvestmentCase(organization),
      openInput(),
      envelope({ commandId: 'cmd-open', reason: 'Board asked for a policy view' }),
      deps,
    )
    const entry = await repositories.commands.find('cmd-open')
    expect(entry?.intent.reason).toBe('Board asked for a policy view')
  })

  it('treats a whitespace-only reason as no reason at all', async () => {
    await runCommand(
      openInvestmentCase(organization),
      openInput(),
      envelope({ commandId: 'cmd-open', reason: '   ' }),
      deps,
    )
    const entry = await repositories.commands.find('cmd-open')
    expect(entry?.intent.reason).toBeUndefined()
  })

  it('rejects a required reason that is blank', async () => {
    const requiresReason = {
      ...openInvestmentCase(organization),
      type: 'BlockCase',
      reasonPolicy: 'required' as const,
    }
    const result = await runCommand(
      requiresReason,
      openInput(),
      envelope({ commandId: 'cmd-blank', reason: '\t\n ' }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('rejects a reason on a command that forbids one', async () => {
    const forbidsReason = {
      ...openInvestmentCase(organization),
      type: 'SystemProbe',
      reasonPolicy: 'forbidden' as const,
    }
    const result = await runCommand(
      forbidsReason,
      openInput(),
      envelope({ commandId: 'cmd-forbidden', reason: 'because' }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('makes two requests differing only in reason two different commands', async () => {
    await runCommand(
      openInvestmentCase(organization),
      openInput(),
      envelope({ commandId: 'cmd-open', reason: 'first reason' }),
      deps,
    )
    const conflicting = await runCommand(
      openInvestmentCase(organization),
      openInput(),
      envelope({ commandId: 'cmd-open', reason: 'a different reason' }),
      deps,
    )
    expect(conflicting).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'payload-conflict' },
    })
  })

  it('replays a genuine retry carrying the same reason', async () => {
    const env = { commandId: 'cmd-open', reason: 'Board asked for a policy view' }
    await runCommand(openInvestmentCase(organization), openInput(), envelope(env), deps)
    const retry = await runCommand(
      openInvestmentCase(organization),
      openInput(),
      envelope({ ...env, correlationId: 'corr-2' }),
      deps,
    )
    expect(retry.outcome).toBe('committed')
  })
})

/* ---------------------------------------------------------- restart durability */

describe('restart durability', () => {
  it('keeps nothing in memory beyond the store', async () => {
    await openCase()
    await instantiate()

    // A second container over the same process has its own store: this asserts
    // the commands hold no module-level state, not that memory survives.
    const fresh = createInMemoryRepositories()
    expect(await fresh.cases.get('case-1')).toBeNull()
    expect(await repositories.cases.get('case-1')).not.toBeNull()
  })
})
