# Durable storage — planning gate

Resolves TD-19, the hard gate before AI Phase C. **Planning only; nothing is
implemented.**

---

## 0. Two findings before the technology question

### The ports cannot express a transaction

`AnalysisRepositories` has no unit of work. Every method is per-entity —
`save`, `get`, `listForCase`, `append`. Creating a case from a playbook must
atomically write one case row, six assignments and their transition events. On
the current ports that is six independent writes, and a crash between them
leaves exactly the half-created workflow the correctness properties forbid.

**This is a required change to the Phase B ports, and it is the real blocker —
not the database choice.** Proposed:

```ts
withTransaction<T>(work: (repos: AnalysisRepositories) => Promise<T>): Promise<T>
```

The callback receives transaction-scoped repositories. The Postgres adapter
opens a transaction; the in-memory adapter snapshots and rolls back on throw,
so unit tests exercise the same boundary. The port stays the application
boundary, which is one of the stated correctness properties.

### Every port query is a point lookup

There is not one join in the port surface: `get(id)`, `listForCase(caseId)`,
`listForDepartment(id)`, `recent(limit)`. Composition happens in the
application layer.

That matters two ways. It means **no ORM is needed** — these map to
single-table statements. And it means the joins that do exist live entirely in
the **headquarters snapshot**, which is a read model and can be one purpose-built
query set rather than something the ports have to anticipate.

---

## 1. Recommendation

**PostgreSQL** as the single authoritative store, in development and
production. SQLite is **not a supported backend** — integration tests and
production run against PostgreSQL only, though a narrow scratch role survives
(§11). No object storage yet. No document database.

|                    | Verdict                   | Why                                                                                                                                                              |
| ------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL**     | **chosen**                | Transactional consistency across an aggregate; genuine relational shape; jsonb where the shape is genuinely open; row-level security available when auth arrives |
| Managed PostgreSQL | **chosen for production** | Backups, PITR and patching are exactly the operational work worth buying at this size                                                                            |
| SQLite             | **not a backend**         | Never for integration or production. A narrow scratch role survives — see §11                                                                                    |
| Object storage     | **deferred**              | Nothing is large enough yet. Revisit at >1 MB or binary artifacts                                                                                                |
| Document database  | **rejected**              | Offers nothing here and costs the joins and transactions this workload is made of                                                                                |

### Why not a document database, specifically

The data is relational in the way that matters: reporting lines are a graph,
`case → thesis revision → claim → evidence` is a join, revision lineage is a
self-reference, and the headquarters snapshot is an aggregation across six
tables. Multi-row transactional consistency is a stated correctness property.
A document store would give us horizontal write scaling we have no use for —
the workload analysis puts the upper bound at ~1.6 GB and under two million
rows a year — in exchange for the two things this design actually depends on.

### Why not event sourcing

Transition events are append-only, which invites it. Rejected: current state is
read far more often than history, the aggregates are small, and rebuilding
state from events would add projection machinery to solve a problem we do not
have. Append-only event _storage_ alongside current-state tables gives the
audit trail without the rebuild cost.

---

## 2. Aggregate boundaries and concurrency

The subtle decision. If the whole case were one concurrency unit, every
concurrent contribution would conflict with every other — six departments
finishing at once would produce five retries.

**`cases.version` guards case-level state only** — stage, participants,
ownership. Everything else is either append-only or independently keyed:

| Entity              | Concurrency                                      |
| ------------------- | ------------------------------------------------ |
| `cases`             | optimistic, `version` compared on update         |
| `thesis_revisions`  | immutable once sealed; only `lifecycle` may move |
| `assignments`       | independently keyed; no case-version bump        |
| `runs`              | independently keyed                              |
| `claims`            | write-once, child of a run                       |
| `transition_events` | append-only                                      |
| `evidence_sets`     | content-addressed, immutable                     |
| `agent_results`     | content-addressed, write-once                    |
| `case_decisions`    | one per case, write-once                         |

So a lost update is possible in exactly one place — the case row — and that is
where the version guard sits.

---

## 3. Schema

Organization (seeded by migration; a new department is an `INSERT`, never a
code change):

```
roles(id, title, function, can_block_publication)
responsibilities(id, role_id, summary, interpretive)
departments(id, name, manager_employee_id, is_governance, tenant_id)
department_handles(department_id, discipline)
teams(id, name, department_id, lead_employee_id)
employees(id, display_name, role_id, department_id, team_id, reports_to, seniority)
```

Cases and theses:

```
cases(id, version, tenant_id, owner_employee_id,
      subject_kind, subject_ref, subject_display, question,
      stage, playbook_id, playbook_version, opened_at, closed_at)
case_participants(case_id, department_id)

thesis_revisions(revision_id PK, thesis_id, revision_number,
                 supersedes_revision_id, case_id, statement, position,
                 lifecycle, invalidation_criteria, horizon,
                 proposed_by_department_id, proposed_by_employee_id,
                 proposed_at, revised_at, revision_reason)
  UNIQUE (thesis_id, revision_number)
  CHECK  (revision_number >= 1)
  CHECK  (revision_number = 1) = (supersedes_revision_id IS NULL)

thesis_claim_links(revision_id, claim_id, relation)   -- supporting|opposing|cites
```

Work and contributions:

```
assignments(id PK, case_id, department_id, assignee_employee_id,
            playbook_entry_key, brief, status, priority,
            created_at, started_at, completed_at,
            waiting_on_kind, waiting_on_assignment_id, waiting_on_description,
            returned_reason)

runs(id PK, case_id, assignment_id, revision_id, department_id, employee_id,
     state, obsolete, agent_contract_version, output_schema_version,
     prompt_id, prompt_version, prompt_content_hash,
     model_id, model_provider, model_parameters_hash,
     evidence_set_id, started_at, completed_at, failure_reason,
     input_tokens, output_tokens, cost_minor_units, currency)

run_events(id PK, run_id, at, state, reason)          -- append-only

claims(id PK, run_id, type, statement, status,
       confidence_level, confidence_capped_by, confidence_basis jsonb,
       temporal_as_of, temporal_horizon,
       contests_claim_id, supports_revision_id, opposes_revision_id,
       causal_attribution jsonb)

claim_evidence(claim_id, evidence_set_id, observation_id, content_hash, stance)
```

Evidence:

```
evidence_sets(id PK, assembled_at, correlation_id,
              co_temporality jsonb, disagreements jsonb)

evidence_items(evidence_set_id, observation_id,
               subject_kind, subject, kind, observed_at,
               source_id, series_id, methodology, content_hash,
               value jsonb, provenance jsonb)
  PRIMARY KEY (evidence_set_id, observation_id)
```

Governance — one `reviews` table with a discriminator plus typed children,
rather than four parallel tables. The headquarters needs "what governance has
touched this revision" as one question, and four tables make that four queries:

```
reviews(id PK, kind, case_id, revision_id, by_employee_id, by_department_id,
        at, status, detail jsonb)                     -- kind-specific scalars

verification_findings(id PK, review_id, kind, claim_id, detail, blocking,
                      evidence_set_id, observation_id)

challenges(id PK, review_id, contests_claim_id, contests_revision_id,
           kind, argument, would_be_resolved_by, outcome)
challenge_evidence(challenge_id, evidence_set_id, observation_id, content_hash)
```

Decisions, events, results, idempotency:

```
case_decisions(case_id PK, aggregate_version, decided_at, decided_by_employee_id,
               selected_revision_id, evidence_set_id, rationale,
               governance jsonb, unresolved_dissent jsonb,
               reconsideration_triggers jsonb)
decision_revisions(case_id, revision_id, relation)    -- selected|not-selected|rejected

transition_events(event_id PK, subject, case_id, thesis_id, revision_id,
                  assignment_id, run_id, from_state, to_state,
                  actor_employee_id, actor_department_id, reason,
                  occurred_at, correlation_id, causation_id,
                  aggregate_version, corrects)        -- append-only

agent_results(key PK, claims jsonb, stored_at, inputs jsonb)   -- write-once
idempotency_keys(key PK, command_type, result_ref, created_at)
```

### Where jsonb is used, and where it is not

Relational columns wherever something is queried, joined or constrained.
`jsonb` only where the shape is genuinely open and only ever read whole:
`confidence_basis`, `causal_attribution`, `co_temporality`, `disagreements`,
the evidence `value` and `provenance` payloads, and the decision's dissent and
trigger lists. An evidence `value` is a normalized domain object whose shape
differs per observation kind — modelling it relationally would mean a table per
domain type for data nothing queries into.

---

## 4. Enforcing the correctness properties

| Property                                   | Mechanism                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| No lost concurrent case updates            | `UPDATE cases SET … WHERE id = $1 AND version = $2`; zero rows → conflict |
| No duplicated assignments after retry      | `idempotency_keys` + `INSERT … ON CONFLICT DO NOTHING` on natural keys    |
| Thesis revisions immutable                 | Column-level trigger rejecting updates to anything but `lifecycle`        |
| Superseded revisions auditable             | Never deleted; `lifecycle = 'superseded'` and the row stays               |
| Reviews attached to the exact revision     | `reviews.revision_id` FK to `thesis_revisions.revision_id`                |
| Decisions reference exact revisions        | `case_decisions.selected_revision_id` FK, plus `decision_revisions`       |
| Transition history append-only             | `REVOKE UPDATE, DELETE` on `transition_events` for the app role           |
| Activity only from stored events           | The projection reads `transition_events` and `run_events`; nothing else   |
| Results write-once                         | `INSERT … ON CONFLICT DO NOTHING`; PK is the content hash                 |
| Evidence revisions don't mutate old claims | `claim_evidence.content_hash` is captured at citation time                |
| No half-created workflow                   | `withTransaction` — the port change in §0                                 |
| Restart loses nothing                      | Durable by definition                                                     |
| Ports remain the boundary                  | The adapter implements the existing interfaces unchanged                  |

The `REVOKE UPDATE, DELETE` on the event table is worth highlighting: it makes
append-only a **database permission** rather than a convention the application
is trusted to honour.

---

## 5. Transaction boundaries

One transaction per command:

| Command                 | Writes atomically                                             |
| ----------------------- | ------------------------------------------------------------- |
| Open case from playbook | case, participants, assignments, transition events            |
| Start contribution      | run, run event, assignment status, transition event           |
| Record contribution     | run, run events, claims, claim evidence, result, transitions  |
| Revise thesis           | new revision, old revision `lifecycle`, transition event      |
| Record review           | review, findings or challenges, transition event              |
| Record decision         | decision, decision_revisions, revision lifecycles, transition |

Evidence sets are written outside the case transaction — content-addressed and
immutable, so a set written by an abandoned command is harmless garbage rather
than a partial write.

---

## 6. Idempotency

Two mechanisms — natural keys where identity is derivable, and an explicit
`idempotency_keys` table for the three commands where it is not. Specified in
full in §17.

---

## 7. Headquarters snapshot queries

Seven queries, all indexed, all trivially fast at this volume:

1. Organization graph — five small tables, ~60 rows total, cacheable per process
2. Department workloads — `GROUP BY department_id, status` over open assignments
3. Active cases — `WHERE stage NOT IN ('published','withdrawn')`
4. Thesis revisions for those cases
5. Governance queues — reviews and assignments for `is_governance` departments
6. Activity — `ORDER BY occurred_at DESC LIMIT n`
7. Recent decisions — `ORDER BY decided_at DESC LIMIT n`

"Cases eligible for CIO review" is **not** a query. It is
`evaluateThesisEligibility` over lifecycle plus reviews — domain logic, computed
in the application layer from queries 4 and 5. Pushing it into SQL would put
the governance rules in two places.

### Indexes

```
cases (stage) WHERE stage NOT IN ('published','withdrawn')
cases (tenant_id)
assignments (department_id, status)
assignments (case_id)
runs (case_id), runs (assignment_id)
thesis_revisions (case_id), (thesis_id, revision_number) UNIQUE
claims (run_id), claim_evidence (claim_id)
evidence_items (evidence_set_id)
reviews (case_id), reviews (revision_id)
transition_events (occurred_at DESC), (case_id, occurred_at)
case_decisions (decided_at DESC)
```

---

## 8. Deduplication

Evidence sets and agent results are content-addressed, so deduplication is the
primary key doing its job. Two cases assembled from the same observations share
one `evidence_sets` row — which at normal volume is the difference between
~416 sets a year and rather fewer.

---

## 9. Migrations

Plain SQL files with a small runner, applied in order and recorded in a
`schema_migrations` table. No ORM and no migration framework: the schema is
~20 tables that change rarely, and the project's dependency list is
deliberately short. Forward-only; a mistake is corrected by a new migration.

---

## 10. Retention and audit

**Nothing is deleted.** Rejected theses, dissent, superseded revisions and
decisions stay indefinitely; that is the point of the record, and the workload
analysis shows no size pressure to reconsider. The one exception is
`idempotency_keys`, which is operational rather than institutional and expires
after 30 days.

A deletion policy becomes a real question only when user-owned data exists,
which is a post-authentication concern.

Auditability is already structural — append-only events, immutable revisions,
content-addressed results. No separate audit log is needed. What PostgreSQL
adds is that the append-only property becomes a permission rather than a
convention.

Backup, point-in-time recovery and restore validation are in §15.

---

## 11. Local development, testing, and where SQLite does and does not belong

**PostgreSQL is the only supported backend.** Integration tests run against
PostgreSQL, always. Production runs PostgreSQL. There is no second
implementation of the repository ports pretending to be equivalent.

### Why not SQLite as a backend

The schema leans on jsonb, partial indexes, `ON CONFLICT`, column-level
triggers and table-level permission revocation. SQLite supports none of those
the same way, so a SQLite schema would not be the production schema — and an
integration suite passing against a different schema than ships is worse than
having none, because the failures it misses are exactly the class this gate
exists to prevent: a trigger that does not fire, a permission that does not
apply, a conflict clause that behaves differently.

### Where SQLite does have value

Dismissing it entirely would be overcorrecting. Two narrow uses are legitimate,
and both share one property: **nothing that runs there is evidence about
production behaviour.**

| Use                                        | Verdict    | Note                                        |
| ------------------------------------------ | ---------- | ------------------------------------------- |
| Integration tests                          | **never**  | PostgreSQL only, without exception          |
| Production or staging                      | **never**  | Not a backend                               |
| A developer poking at query shapes offline | acceptable | Scratch work. No conclusions travel from it |
| Exporting a case for offline inspection    | acceptable | A read-only artifact, not a running system  |

Both are throwaway. Neither is wired into the composition root, neither
implements the repository ports, and neither may be cited as evidence that
something works. If either grows past that, it has become a second backend and
this decision should be re-opened deliberately rather than by drift.

### Three test tiers

| Tier               | Store                          | Purpose                                          |
| ------------------ | ------------------------------ | ------------------------------------------------ |
| Unit               | existing in-memory repos       | Fast, offline, no I/O. Unchanged; still the bulk |
| Integration        | real PostgreSQL in a container | The §4 correctness properties                    |
| Fitness / boundary | none                           | Unchanged                                        |

The in-memory adapter is **kept, not replaced**. It is what makes 774 tests run
in seconds, and after the port change it also serves as the reference
implementation of the transaction boundary.

---

## 12. Deployment

**Currently undefined, and this plan cannot settle it.** The repository has no
Docker, Vercel, Fly, Railway or Render configuration, and no database driver in
`package.json`. Adding PostgreSQL introduces the project's first infrastructure
dependency.

Managed options worth comparing when the host is chosen — Neon, Supabase, Fly
Postgres, RDS — all comfortably free or near-free at the normal volume. The
choice interacts with where the app itself runs, which is also undecided, so it
is an open decision rather than one resolved here.

The single-instance constraint from TD-6 is unaffected: a shared PostgreSQL for
the analysis runtime does not by itself make the market-data cache shared.

---

## 13. Authentication and tenancy

Durable storage does **not** wait for authentication, but the schema is shaped
so authentication is additive rather than a migration of every table:

- `tenant_id` on `cases` and `departments` from the start, defaulting to a
  system tenant
- `owner_employee_id` on `cases`, set to the system CIO for system-created work
- **no anonymous ownerless rows** — a system-created case has an explicit
  system owner

When authentication arrives it adds a `users` table, a mapping to employees,
and row-level security policies keyed on `tenant_id`. PostgreSQL RLS is a large
part of why it is the right choice here: authorization becomes a policy rather
than a query rewrite across every call site.

Secrets follow the existing discipline — connection string from the
environment, never logged, never in a query string, never in the client bundle.
At-rest encryption comes from the managed provider; in-transit is TLS.

---

## 14. Implementation phases and the staged migration

The cutover is staged rather than a swap, so that at no point is correctness
taken on trust.

| Stage                    | State                                                              | Exit criterion                                         |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| **0. Port change**       | `withTransaction` added; in-memory implements it                   | Unit suite green; no database involved                 |
| **1. Schema**            | Migrations and the seeded organization exist                       | Applies cleanly from empty; rollback rehearsed         |
| **2. Postgres adapter**  | Implements the ports; not yet wired in                             | Integration suite proves every §4 property             |
| **3. Dual write**        | Both adapters write; **in-memory stays authoritative for reads**   | Every command writes both without error for a full run |
| **4. Read verification** | Reads served from memory; PostgreSQL read in parallel and compared | Zero divergences across the whole test corpus          |
| **5. Read switch**       | PostgreSQL authoritative for reads; in-memory still written        | Behaviour unchanged; snapshot queries inside budget    |
| **6. Remove memory**     | PostgreSQL only in the composition root                            | In-memory retained **for unit tests only**             |

Stages 3–5 exist because a repository swap is exactly the kind of change that
looks complete and is not. **Read verification is the stage that earns the
cutover**: it compares what each store returns for the same query and reports
divergence rather than assuming equivalence.

One divergence is expected and must be handled explicitly rather than waved
through — **ordering**. The in-memory adapter returns insertion order;
PostgreSQL returns whatever the plan produces unless `ORDER BY` says otherwise.
Every list query needs a deterministic sort, and read verification is where a
missing one surfaces.

**Stage 6 removes in-memory from the composition root, not from the codebase.**
It remains the unit-test adapter and the reference implementation of the
transaction semantics.

Stages 0 and 1 are independent and can run in parallel. Nothing after stage 2
proceeds until the integration suite is green.

---

## 15. Operations

### Backup

Managed PostgreSQL, daily automated backups with a 7-day minimum retention, and
continuous WAL archiving for point-in-time recovery. This is the main reason to
buy managed rather than self-host at this size: the work is real, and none of
it is differentiating.

### Point-in-time recovery

PITR to any moment inside the retention window. The recovery targets that
matter here are not hardware failures but **logical** ones: a bad migration, a
mistaken bulk update, a defect that wrote wrong lifecycle values across many
rows. Those are what PITR addresses and what a nightly backup alone does not.

### Restore validation

**A backup that has never been restored is a hypothesis.** Restore is exercised
on a schedule rather than assumed:

- a monthly restore into a scratch database from the most recent backup
- schema verified against the expected migration version
- a fixed set of invariant queries run against the restored copy — revision
  lineages intact, no orphaned reviews, every decision's selected revision
  present, event counts consistent with case counts
- the restore duration recorded, so the recovery-time assumption is measured
  rather than guessed

### Disaster recovery assumptions

Stated plainly so they can be argued with:

|                  | Assumption                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| RPO              | ≤ 5 minutes — WAL archiving; a few minutes of analysis may be lost      |
| RTO              | ≤ 4 hours — restore plus redeploy, and unmeasured until validation runs |
| Failure scope    | Single region. Multi-region is not justified at this size               |
| Data loss stance | Losing an in-flight case is acceptable; losing a `CaseDecision` is not  |
| Rebuild          | Market data is re-fetchable; **analysis is not** — it is the asset      |

That last row is the one that matters. Every market-data value in the system
can be fetched again from its source. A rejected thesis, a Devil's Advocate
challenge and the reasoning behind a decision cannot be reconstructed from
anywhere.

---

## 16. Observability

Extends the existing recorder rather than introducing a parallel system — the
same `Metrics` interface, the same bounded registry, the same Prometheus
exporter, and the same label-cardinality discipline that caps series at 2000.

New metrics, namespaced `analysis.db.*` to sit beside `marketdata.*`:

| Metric                                         | Type      | Why it earns a series                                                              |
| ---------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `analysis.db.transaction`                      | counter   | Labelled `outcome=committed / rolled-back`; the rollback rate is the health signal |
| `analysis.db.transaction.latency_ms`           | histogram | Long transactions hold locks and are the first sign of trouble                     |
| `analysis.db.rollback`                         | counter   | Labelled `reason=conflict / error / deadlock`                                      |
| `analysis.db.deadlock`                         | counter   | PostgreSQL `40P01`. Should be zero; anything else is a design defect               |
| `analysis.db.conflict`                         | counter   | Optimistic-concurrency losses. A rising rate means aggregates are too coarse       |
| `analysis.db.retry`                            | counter   | Retries after conflict, labelled by outcome                                        |
| `analysis.db.query.latency_ms`                 | histogram | Labelled by `operation`, **never by id**                                           |
| `analysis.db.pool.size` / `.idle` / `.waiting` | gauge     | `waiting` above zero means the pool is the bottleneck                              |
| `analysis.db.pool.acquire_wait_ms`             | histogram | Distinguishes a slow query from a starved pool                                     |

**Slow-query logging** reuses the existing structured logger and its sampling:
statements above a threshold (200 ms initially) log operation, duration and
correlation id. **Never the parameters** — a query's parameters contain case and
thesis content, and the discipline that keeps provider keys out of logs applies
equally here.

Two labelling rules carry over from Phase 3.5, because they are what keeps a
metrics registry bounded: labels come from a fixed allowlist, and no label ever
carries an id, a hash or a query string.

---

## 17. Idempotency — exactly what, and how

Two mechanisms. Most operations have a **derivable identity** and need no key;
a small set genuinely does not.

### Derivable identity — no key required

| Operation               | Natural key                                    | Enforcement                         |
| ----------------------- | ---------------------------------------------- | ----------------------------------- |
| Create assignment       | `(case_id, playbook_entry_key)`                | `UNIQUE` + `ON CONFLICT DO NOTHING` |
| Append transition event | `event_id`, caller-generated deterministically | PK + `ON CONFLICT DO NOTHING`       |
| Append run event        | `(run_id, at, state)`                          | `UNIQUE` + `ON CONFLICT DO NOTHING` |
| Save evidence set       | content hash                                   | PK; re-save is a no-op              |
| Store agent result      | `resultKey(...)` content hash                  | PK; **write-once**                  |
| Create thesis revision  | `revision_id`                                  | PK                                  |
| Record claim            | `claim_id`                                     | PK                                  |
| Record decision         | `case_id`                                      | PK; one per case, write-once        |

### Explicit idempotency keys — required

Three operations have no derivable identity, because the caller decides when
they happen:

| Operation                    | Why a key is needed                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| **Open a case**              | Two calls are indistinguishable from one retried call; without a key a retry opens a second |
| **Start a contribution run** | The run id is minted by the caller; a retry before the first response would mint a second   |
| **Record a review**          | A reviewer submitting twice must not double-count a blocker and make a case look worse      |

Enforced through `idempotency_keys(key PK, command_type, result_ref,
created_at)`, written **inside the same transaction as the effect**. A replay
finds the key, returns `result_ref`, and does no work. Because the insert and
the effect share a transaction, there is no window in which the key exists
without its effect or the reverse.

Keys are retained 30 days — long enough for any realistic retry, short enough
that the table stays small. They are the one thing in this schema that is
deleted, and the reason is that they are operational rather than institutional.

---

## 18. The final repository surface

`withTransaction` lives on the **container**, not on any individual repository.
A transaction spans repositories — opening a case writes cases, assignments and
events — so a per-repository transaction could not express it.

```ts
export interface AnalysisRepositories {
  cases: CaseRepository
  theses: ThesisRepository
  assignments: AssignmentRepository
  runs: RunRepository
  reviews: ReviewRepository
  events: EventRepository
  evidence: EvidenceRepository
  decisions: DecisionRepository
  results: ResultStore
  idempotency: IdempotencyStore

  /**
   * Runs `work` inside one transaction. The repositories handed to the
   * callback are transaction-scoped; the outer ones are not and must not be
   * used inside it.
   */
  withTransaction<T>(work: (tx: TransactionalRepositories) => Promise<T>): Promise<T>
}

/** Everything except the transaction opener — transactions do not nest. */
export type TransactionalRepositories = Omit<AnalysisRepositories, 'withTransaction'>
```

Three consequences worth stating:

**`TransactionalRepositories` omits `withTransaction`**, so a nested
transaction is a compile error rather than a runtime surprise. No command in §5
needs savepoints.

**`ResultStore` and `IdempotencyStore` move onto the container.** The result
store was standalone in Phase B; the idempotency store is new. Both must
participate in the transaction — an idempotency key committed outside the
effect's transaction would be exactly the window it exists to close.

**The application layer never sees a driver type.** No `Pool`, no `Client`, no
SQL. `withTransaction` is the whole of the abstraction, and the ports remain
the application boundary as required.

---

## 19. Institutional memory

This database becomes the institutional memory of Financial OS. It holds not
only what was decided but what was rejected, contested and later proved wrong.
Much of what is above is in service of five questions the system must answer
years later.

| Question                            | Answered from                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Why did we make this decision?**  | `case_decisions.rationale`, the governance snapshot as it stood at decision time, and the transitions leading to it                             |
| **What evidence existed?**          | `evidence_sets` + `evidence_items` via `case_decisions.evidence_set_id` — the exact observations, with provenance, as they read that day        |
| **Which thesis was rejected?**      | `decision_revisions` where `relation` is `not-selected` or `rejected`, joined to the full revision and its claims                               |
| **Who disagreed?**                  | `challenges` with their counter-evidence, plus `case_decisions.unresolved_dissent` — objections the CIO acknowledged and decided against anyway |
| **Which assumptions proved wrong?** | `thesis_revisions.invalidation_criteria` and `reconsideration_triggers`, read against what subsequently happened                                |

That last one is why `invalidationCriteria` is a required field rather than a
nicety. A thesis that recorded what would falsify it can be graded later; one
that did not, cannot — and the difference between an institution that learns and
one that merely accumulates is whether it wrote down what would have changed its
mind.

Three design choices exist for this and would otherwise look like overhead:

- **Nothing is deleted.** Rejected theses, superseded revisions and dissent are
  retained indefinitely. The workload analysis confirms there is no size
  pressure to reconsider.
- **Revisions are immutable and superseded ones are kept**, so "what did we
  believe in March" has an exact answer rather than a reconstructed one.
- **Evidence is content-addressed and citations carry the content hash**, so a
  later revision of an observation cannot silently rewrite what a past decision
  rested on. The decision stays attached to what it actually saw.

An outcome-review capability — grading decisions against what happened — is
**not** in scope for this phase. What this phase guarantees is that the data to
do it will exist, and will not have been quietly overwritten in the meantime.

---

## 20. Technical Debt & Future Improvements

- **Outcome review** — grading past decisions against what subsequently
  happened, using `invalidationCriteria` and `reconsiderationTriggers`.
  The data is preserved for it; the capability is future work.
- **Object storage** — not justified now. Revisit for published documents,
  charts or raw model transcripts, i.e. anything above ~1 MB or binary.
- **Read replicas / caching for the headquarters snapshot** — unnecessary at
  this volume; note the query set so it is easy to cache later.
- **Event-sourced projections** — deliberately rejected; revisit only if
  history reads come to dominate current-state reads.
- **Retention and deletion policy** — deferred until user-owned data exists.
- **TD-6 shared cache store** — unchanged and unrelated; a Postgres for the
  analysis runtime does not make the market-data cache shared.
- **Deployment target** — the open decision above, tracked to a separate gate.
