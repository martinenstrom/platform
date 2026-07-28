# Phase C1A — command foundation

Planning gate. No implementation until approved.

C1A builds the machinery every later command depends on and **no workflow
command at all**. Nothing in `docs/phase-c-plan.md` §2 is implemented here.

---

## 1. The finding that shapes C1A

Your requirement — _"a command should never consist only of an anonymous
version increment; it must have a durable command/result identity or
corresponding event that can be queried"_ — cannot be met by
`idempotency_keys` as it stands. The table holds `(key, command_type,
result_ref, created_at)` and is **granted `DELETE`**, expires at 30 days, and
is described in the schema as "operational rather than institutional".

What you have specified is not an idempotency table. It is a **command log**:
every command, its scope, its actor, its result, its provenance, retained. That
is an institutional record, not an operational one, and it should stop being
deletable.

**Decision D-C1A-1: rename `analysis.idempotency_keys` to `analysis.commands`,
extend it, replace the `IdempotencyStore` port with `CommandLog`, and revoke
the `DELETE` grant.**

Consequences worth stating: the schema then has **no deletable table at all**,
which is consistent with "nothing is deleted" but removes the retention story
§10 of the storage plan wrote for idempotency keys. A command log grows with
commands issued rather than with records kept — at the workload in the storage
plan that is thousands of rows a year, not millions.

---

## 2. File scope

### Domain

| File                           | Contents                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| `domain/analysis/authority.ts` | **New.** Organizational mandate as pure functions over `Organization` |
| `domain/analysis/index.ts`     | Export `authority`, `COMMAND_CONTRACT_VERSION`                        |

`authority.ts` is domain, not application: "only Verification may issue a
verification verdict" is a rule about the firm, expressible over the
organization graph with no I/O. Putting it in the application layer would make
it untestable without a container.

### Application

| File                                              | Contents                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `application/analysis/commands/envelope.ts`       | `CommandEnvelope`, `CommandResult`, `DomainRejection`, `CommandProbe` |
| `application/analysis/commands/actor.ts`          | `AssertedActor`, `ResolvedActor`, resolution against the organization |
| `application/analysis/commands/runCommand.ts`     | The transaction wrapper and result mapping                            |
| `application/analysis/commands/resolveCommand.ts` | Ambiguous-commit resolution                                           |
| `application/analysis/commandLog.ts`              | The `CommandLog` port (replaces `IdempotencyStore`)                   |
| `application/analysis/organizationReader.ts`      | Port for the seeded organization graph                                |
| `application/analysis/repositories.ts`            | `idempotency: IdempotencyStore` → `commands: CommandLog`              |
| `application/analysis/provenance.ts`              | `RuntimeProvenance`, extending `StorageProvenance`                    |

### Infrastructure

| File                                                     | Contents                                  |
| -------------------------------------------------------- | ----------------------------------------- |
| `infrastructure/analysis/container.ts`                   | **The composition root.** PostgreSQL only |
| `infrastructure/analysis/postgres/commandLog.ts`         | Adapter                                   |
| `infrastructure/analysis/postgres/organizationReader.ts` | Adapter + per-process cache               |
| `infrastructure/analysis/postgres/provenance.ts`         | Provenance resolution and upsert          |
| `infrastructure/analysis/inMemoryRepositories.ts`        | `CommandLog` implementation, for parity   |
| `db/migrations/0013_command_log_and_provenance.sql`      | Schema                                    |

### Tests

Domain authority; envelope and result contracts; `runCommand` through the
**shared repository contract** so both adapters are held to it; ambiguous-commit
resolution under deterministic fault injection; composition-root refusals;
the restart-durability harness; four new fitness rules.

**C1A ships no production command.** The machinery is exercised by a
**test-only probe command** living in the test tree — it writes one case row
and one event, and exists solely to drive `runCommand`. Shipping a real command
early would put a workflow decision inside a foundation stage.

---

## 3. Command envelope and result

```ts
export const COMMAND_CONTRACT_VERSION = '1'

export interface CommandEnvelope {
  commandId: string // caller-supplied ULID, stable across retries
  commandType: string // e.g. 'OpenInvestmentCase'
  correlationId: string
  actor: AssertedActor
  occurredAt: string // from the Clock, never the database
  /** Required only by commands that move case-level state. See §7. */
  expectedVersion?: number
}

export type CommandResult<T> =
  | { outcome: 'committed'; value: T; record: CommandRecord }
  | { outcome: 'rejected'; rejection: DomainRejection }
  | { outcome: 'failed'; error: StorageError }
  | { outcome: 'unresolved'; probe: CommandProbe }

export interface DomainRejection {
  /** Bounded, from a closed set. Never free text in a metric label. */
  code:
    | 'unknown-actor'
    | 'not-authorised'
    | 'illegal-prior-state'
    | 'aggregate-conflict'
    | 'invariant-violated'
    | 'not-found'
  /** For a human. May name records; never carries thesis or claim content. */
  detail: string
}
```

`rejected` and `failed` stay separate because they are different facts: the
organization refused the work, versus the system could not record it.
Collapsing them makes "the CIO cannot decide this yet" indistinguishable from
"the database is down".

**`committed` is returned only after the PostgreSQL commit resolves.** There is
no degraded path and no volatile acknowledgement.

---

## 4. Actor model

```ts
/** What the caller claims. Deliberately minimal — nothing here is trusted. */
export type AssertedActor =
  | { kind: 'employee'; employeeId: string; assertion: AssertionSource }
  | { kind: 'system'; systemActorId: string; reason: string }

export type AssertionSource = 'system-asserted' | 'recorded-provider'

/** What the organization says. Produced by resolution, never by the caller. */
export interface ResolvedActor {
  kind: 'employee' | 'system'
  employeeId: string | null
  roleId: string | null
  roleFunction: RoleFunction | null
  departmentId: string | null
  assertion: AssertionSource | 'system'
  /** Never 'authenticated' in C1. */
  authentication: 'system-asserted'
}
```

**The caller supplies only an employee id. Role and department are looked up in
the seeded organization**, never accepted from the caller — otherwise anyone
could claim to be Verification, and authorization would be advisory.

Rules:

- an `employeeId` not present in the seeded organization → `unknown-actor`
- no free-form employee ids, no ad-hoc departments
- `recorded-provider` is permitted only for the employee the seeded
  organization gives as that department's member, so a fixture cannot act as
  the CIO
- **a `system` actor may not move a case.** Migration 0012 requires a real
  employee on any case movement, and system-initiated stage changes would be
  ownerless activity. System actors exist for retention, replay and schema
  operations
- nothing is ever described as an authenticated user. `authentication` is
  `'system-asserted'` and stays that way until TD-8

Recorded on every command: employee id or system actor id, role, department,
assertion source, authentication state.

---

## 5. Authorization — organizational mandate

`domain/analysis/authority.ts`, pure over `Organization`:

```ts
export type Mandate =
  | { kind: 'governance-verdict'; discipline: string }
  | { kind: 'department-contribution'; departmentId: string }
  | { kind: 'department-manager'; departmentId: string }
  | { kind: 'thesis-owner'; proposedByDepartmentId: string }
  | { kind: 'chief-decision' }

export function hasMandate(
  organization: Organization,
  actor: ResolvedActor,
  mandate: Mandate,
): boolean
```

**Data-driven, not hardcoded.** A governance verdict requires that the actor's
department **handles the discipline** and **is a governance department** — both
read from the seeded graph. No command names `'verification'` as a department
id, so adding a fifth control function is data, exactly as the organization
design promised.

| Mandate                 | Rule                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| governance verdict      | `department.isGovernance` and `handles.includes(discipline)`; role function `governance` |
| department contribution | actor's department is the assignment's department                                        |
| department manager      | `department.managerEmployeeId === actor.employeeId`                                      |
| thesis owner            | actor's department is the revision's proposing department                                |
| chief decision          | actor is `organization.chiefEmployeeId` and role function is `executive`                 |

Discipline mapping: verification→`verification`, devils-advocate→`challenge`,
risk→`risk`, compliance→`compliance` — the disciplines migration 0010 seeds.

Enforced in the command layer and tested there. UI hiding is not a control.

---

## 6. Transaction composition

```ts
runCommand(envelope, deps, work): Promise<CommandResult<T>>
```

1. Resolve the actor against the cached organization → `unknown-actor` on miss.
2. `repositories.withTransaction(async tx => {`
3. `work(tx, resolvedActor)` — domain checks, prior-state checks, writes.
4. `tx.commands.record({ … })` — **inside the same transaction.**
5. `})`
6. Map the outcome.

Every path a command can take:

| Inside                                   | Outcome                              |
| ---------------------------------------- | ------------------------------------ |
| `work` throws `DomainRejection`          | `rejected`; transaction rolled back  |
| `work` throws `ConcurrencyConflictError` | `rejected` with `aggregate-conflict` |
| `work` throws any `StorageError`         | `failed`; nothing written            |
| commit succeeds                          | `committed`                          |
| `AmbiguousCommitError`                   | `unresolved` with a probe            |

**`work` never opens a transaction and never calls a repository outside `tx`.**
A fitness rule asserts no command file imports `infrastructure`.

**No handler calls another handler.** Composition happens above, by issuing a
second command, so every transaction boundary stays visible in the log.

---

## 7. `expectedVersion` policy — the exact list

Required on commands that move case-level state:

`InstantiatePlaybook`, `SubmitForVerification`, `SubmitForCioDecision`,
`RecordCaseDecision`, and later `CloseCase` / `ReopenCase`.

Not required, and rejected if supplied:

`OpenInvestmentCase` (creates), `ProposeThesis`, `ReviseThesis`,
`StartAgentRun`, `RecordContribution`, `FailAgentRun`, `AssembleEvidenceSet`,
the four governance commands, `AggregateManagerConclusion`.

`runCommand` enforces the list from a declaration on each command definition —
so a command that should be version-guarded cannot silently omit it, and one
that should not cannot silently acquire it.

Child writes are protected by immutable identity, exact revision references,
unique constraints and expected-current-state guards. Independent departments
are never serialized behind a shared counter.

---

## 8. Command log, idempotency and ambiguous commit

```ts
export interface CommandRecord {
  commandId: string
  commandType: string
  scope: { caseId?: string; revisionId?: string; runId?: string; assignmentId?: string }
  resultKind: string // 'case' | 'revision' | 'run' | 'review' | 'decision' | …
  resultRef: string
  correlationId: string
  occurredAt: string
  committedAt: string
  actor: ResolvedActor
  provenanceId: string
}

export interface CommandLog {
  find(commandId: string): Promise<CommandRecord | null>
  /** Idempotent on `commandId`: a replay returns the original record. */
  record(entry: CommandRecord): Promise<CommandRecord>
}
```

Written inside the command's own transaction, so the record and its effect
commit together — there is no window where one exists without the other.

**This closes the bare-version-bump gap.** A pure stage move now has a durable,
queryable identity: its `commands` row.

`resolveCommand(commandId)`:

| `commands` row | Meaning        | Returns                                                    |
| -------------- | -------------- | ---------------------------------------------------------- |
| present        | committed      | `committed`, effect re-read via `resultKind` + `resultRef` |
| absent         | did not commit | `failed`; safe to reissue with the same `commandId`        |
| unreachable    | still unknown  | `unresolved`                                               |

Never a blind retry. A caller reissues only after `failed`, and reissuing
carries the same `commandId`, so a second landing collides on the primary key.

---

## 9. Storage and runtime provenance

Two layers, because they answer different questions.

**Runtime provenance** — which code and which SQL. One row per distinct
combination, keyed on its own hash:

```
analysis.storage_provenance(
  id PK,                      -- hash of the coordinates below
  adapter_id, adapter_version,
  build_id,                   -- git commit, injected at build; 'dev' locally
  query_catalog_hash,
  schema_version,
  domain_contract_version,
  command_contract_version,
  first_seen_at
)
```

`adapter_version` is **derived**, not hand-maintained:

```
adapter_version = short hash of (build_id ∥ query_catalog_hash ∥ schema_version
                                 ∥ domain_contract_version ∥ command_contract_version)
```

The catalogue hash already covers the SQL automatically; `build_id` covers the
mapping code, which the constant never did. Closes TD-24.

**Execution provenance** — playbook id/version and contribution-provider
identity — is per run, not per runtime, so it belongs on `runs` and lands in
**C1C** with the run commands. C1A creates the table, the resolution and the
foreign key from `commands`; it does not add run columns for records that do
not exist yet.

Resolved once per process at container construction and upserted on first use.

---

## 10. Migration 0013

1. `analysis.storage_provenance`, as above.
2. `ALTER TABLE analysis.idempotency_keys RENAME TO commands` plus new columns:
   `scope_case_id`, `scope_revision_id`, `scope_run_id`, `scope_assignment_id`,
   `result_kind`, `correlation_id`, `occurred_at`, `committed_at`,
   `actor_kind`, `actor_employee_id`, `actor_role_id`, `actor_department_id`,
   `actor_assertion`, `provenance_id`.
3. `key` → `command_id` (still the primary key).
4. Foreign keys: `provenance_id`, `actor_employee_id` → `employees`,
   `scope_case_id` → `cases`.
5. CHECK: an `employee` actor has employee/role/department; a `system` actor has
   none of them — so an ownerless command row is not representable.
6. `REVOKE DELETE ON analysis.commands FROM finos_app`; `GRANT SELECT, INSERT`.
7. Index `(scope_case_id, committed_at DESC)` for "what has been asked of this
   case", and `(committed_at DESC)` for the operational view.

The table is empty in every environment, so the rename carries no data risk —
and the migration says so rather than assuming it.

---

## 11. Composition root

`infrastructure/analysis/container.ts`:

```ts
createAnalysisContainer({
  connectionString, // required; never logged
  buildId, // from the environment; 'dev' locally
  clock,
  metrics,
  logger,
  contributionProvider, // recorded | stub — unused until C1C
})
```

Refusals, all at construction and all loud:

| Condition                                   | Behaviour                              |
| ------------------------------------------- | -------------------------------------- |
| no connection string                        | throw; no fallback to memory, ever     |
| schema version below the code's expectation | throw, naming both                     |
| organization not seeded                     | throw — commands cannot resolve actors |

Migrations are **not** run at startup: deployment runs them as the schema owner,
and the runtime holds no grant to. The container verifies and refuses.

Fitness rules added:

1. no file outside `infrastructure/analysis/` and tests constructs
   `createInMemoryRepositories`
2. no file in `application/analysis/commands/` imports `infrastructure`
3. the container never references `createInMemoryRepositories`
4. no command file writes a repository outside a `withTransaction`

---

## 12. Restart durability harness

C1A builds the harness and proves it on the probe command:

```ts
withRestart(async ({ container, restart }) => {
  await issue(probeCommand)
  const fresh = await restart()        // close, rebuild against the same database
  expect(await fresh.cases.get(id)).toEqual(…)
})
```

`restart()` closes the pool and constructs a new container against the same
database — a real process boundary as far as the runtime is concerned. Later
stages reuse it for the full workflow.

---

## 13. Tests

Authority: every mandate, positive and negative; a fifth governance department
added as data works without code change; a specialist cannot issue a governance
verdict; a non-chief cannot decide.

Actor: unknown employee rejected; caller-supplied role and department ignored in
favour of the organization's; system actor refused on a case movement; nothing
reports `authenticated`.

`runCommand`: each of the five outcome paths; command log written in the same
transaction; rollback leaves no command row; replay returns the original;
`expectedVersion` required where declared and refused where not.

Ambiguous commit: deterministic fault injection at COMMIT; `resolveCommand`
returns `committed` when the row landed and `failed` when it did not; reissue
with the same `commandId` collides.

Composition root: each refusal; and a fitness assertion that no LLM client and
no UI file changed.

The **shared repository contract suite gains `CommandLog`**, so both adapters
are held to the same behaviour.

---

## 14. Decisions requiring approval

| #       | Decision                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-C1A-1 | Rename `idempotency_keys` → `commands`, extend it, replace `IdempotencyStore` with `CommandLog`, revoke `DELETE`. The schema then has no deletable table |
| D-C1A-2 | `authority.ts` lives in the **domain**, not the application                                                                                              |
| D-C1A-3 | Actor role and department are **resolved from the organization**, never accepted from the caller                                                         |
| D-C1A-4 | A `system` actor may not move a case; `system` is an actor kind, not an assertion source                                                                 |
| D-C1A-5 | Execution provenance (playbook, provider) deferred to C1C; runtime provenance lands now                                                                  |
| D-C1A-6 | C1A ships a **test-only probe command**, no production command                                                                                           |
| D-C1A-7 | `expectedVersion` is declared per command and enforced by `runCommand` in both directions                                                                |

---

## 15. Out of scope for C1A

No workflow command; no orchestrator wiring; no headquarters read model; no
route or UI change; no LLM; no contribution provider use; no market-data
change; `services/investmentLetter` untouched.

---

## 16. Technical debt

- Authentication and real actor identity (TD-8) — the actor model is shaped for
  it and explicitly not it
- Authorization beyond organizational mandate: per-user permissions, tenancy, RLS
- Agents headquarters migration (D-C4), before C2
- Compliance and Editorial publication pipeline; Close/Reopen administration
- Outcome review and institutional learning
- LLM provider, cost authorization, prompt deployment registry, model fallback
- Production database host; CI PostgreSQL container (TD-23); operational
  runbook; backup and restore automation; alert thresholds
- Command-log growth and archival, now that nothing is deletable
- Deferred dual-write design (`docs/dual-write-plan.md`)
