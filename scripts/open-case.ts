/**
 * Opens one real investment case, for development.
 *
 * **Bootstrap tooling, not a product surface.** Opening a case is a genuine
 * institutional act and will eventually be a capability a person exercises in
 * Financial OS with its own actor, mandate and interface. This is not that: it
 * exists because C2-2 Stage C commissions work against an *existing* open case,
 * and every case in the development database was opened under `macro-regime` v1
 * — a workflow that authorizes no live budget, and must keep authorizing none.
 *
 * ## What it does NOT do
 *
 * It writes no SQL, inserts no rows, and creates no fixture state. Every effect
 * here comes from `OpenInvestmentCase` and `InstantiatePlaybook` run through
 * `runCommand`, against the seeded organization, with a real employee as the
 * actor — so the mandate check, the version policy, the ledger entry, the
 * events and the assignments are all exactly what the product would produce.
 * A case this script opens is indistinguishable from one opened any other way,
 * because there is no other way.
 *
 * It also never runs by itself. Nothing imports it, no server function calls
 * it, and it is not wired into startup or into commissioning — it does
 * something only when a person types it.
 *
 * ## Pinned to whatever the registry currently approves
 *
 * The playbook is resolved through `resolveForCaseKind`, so the case pins the
 * highest registered version rather than a version named here. That is the
 * point: a second place naming a workflow version is a second answer to which
 * workflow the firm approves.
 *
 *   npm run dev:open-case -- --question "Where is the German 10y heading?"
 *
 * Options:
 *   --question   what the firm is asking. Required; a case without a question
 *                is a folder, not an investment case.
 *   --id         the case id. Defaults to a timestamped one.
 *   --ref        the subject reference. Defaults to `ecb`.
 *   --name       the subject's display name. Defaults to the reference.
 *   --owner      the employee opening it. Defaults to `research-director`.
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { runCommand } from '../src/application/analysis/commands/runCommand.ts'
import { openInvestmentCase } from '../src/application/analysis/commands/openInvestmentCase.ts'
import { instantiatePlaybook } from '../src/application/analysis/commands/instantiatePlaybook.ts'
import {
  resolveForCaseKind,
  requirePlaybook,
} from '../src/application/analysis/playbookRegistry.ts'
import { MACRO_REGIME_CASE_KIND } from '../src/application/analysis/macroPlaybook.ts'
import { systemClock } from '../src/domain/shared/clock.ts'

function option(name: string): string | undefined {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function refuse(why: string): never {
  console.error(`\n  ${why}\n`)
  process.exit(1)
}

const question = option('question')
if (!question) {
  refuse(
    'A case needs a question. ' +
      'npm run dev:open-case -- --question "Where is the German 10y heading?"',
  )
}

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) {
  refuse('ANALYSIS_DATABASE_URL is not configured. Run this through `npm run`.')
}

const caseId = option('id') ?? `dev-${Date.now()}`
const ref = option('ref') ?? 'ecb'
const displayName = option('name') ?? ref
const owner = option('owner') ?? 'research-director'

const container = await createAnalysisContainer({
  connectionString,
  buildId: 'dev-open-case',
  clock: systemClock,
})

try {
  const deps = await container.commandDeps()
  const repositories = container.repositories

  /* The version the registry currently approves, never one named here. */
  const approved = resolveForCaseKind(MACRO_REGIME_CASE_KIND)
  const playbook = requirePlaybook(approved.playbookId, approved.version)

  const envelope = (commandId: string, over: Record<string, unknown> = {}) => ({
    commandId,
    correlationId: caseId,
    actor: { kind: 'employee' as const, employeeId: owner },
    initiator: { kind: 'employee' as const, employeeId: owner },
    occurredAt: systemClock.isoNow(),
    ...over,
  })

  const opened = await runCommand(
    openInvestmentCase(deps.organization),
    {
      caseId,
      subject: { kind: MACRO_REGIME_CASE_KIND, ref, displayName },
      question,
      ownerEmployeeId: owner,
      participatingDepartmentIds: ['research-office'],
    },
    envelope(`${caseId}-open`),
    deps,
  )
  if (opened.outcome !== 'committed') {
    refuse(`OpenInvestmentCase did not commit: ${JSON.stringify(opened)}`)
  }

  const instantiated = await runCommand(
    instantiatePlaybook(deps.organization),
    {
      caseId,
      playbookId: playbook.id,
      playbookVersion: playbook.version,
      onBehalfOfDepartmentId: 'research-office',
    },
    envelope(`${caseId}-playbook`, {
      expectedVersion: (await repositories.cases.get(caseId))!.version,
    }),
    deps,
  )
  if (instantiated.outcome !== 'committed') {
    refuse(`InstantiatePlaybook did not commit: ${JSON.stringify(instantiated)}`)
  }

  /* ------------------------------------------- the prerequisite chain, read back */

  /*
   * Read from the store rather than reported from memory. An in-process object
   * proves the commands ran; only a read proves the institution kept what they
   * did — the same rule the C2-1 smoke proof follows.
   */
  const stored = (await repositories.cases.get(caseId))!
  const assignments = await repositories.assignments.listForCase(caseId)
  const evidence = await repositories.evidence.list(10)

  console.log(`\n  Case ${stored.id}`)
  console.log(`    question    ${stored.question}`)
  console.log(`    stage       ${stored.stage}`)
  console.log(`    workflow    ${stored.playbookId} v${stored.playbookVersion}`)
  console.log(`\n  Assignments`)
  for (const assignment of assignments) {
    console.log(
      `    ${assignment.playbookEntryKey?.padEnd(18) ?? '(ad-hoc)'.padEnd(18)}` +
        `${assignment.departmentId.padEnd(18)}${assignment.status}`,
    )
  }
  console.log(`\n  Evidence the institution holds (${evidence.length})`)
  for (const set of evidence) {
    const sources = [...new Set(set.items.map((i) => i.provenance.source.providerName))]
    console.log(
      `    ${set.id}  ${String(set.items.length).padStart(2)} obs  ` +
        `${sources.join(', ') || 'empty'}`,
    )
  }
  console.log('')
} finally {
  await container.close().catch(() => {})
}
