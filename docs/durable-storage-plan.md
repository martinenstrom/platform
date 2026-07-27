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
production. **No SQLite. No object storage yet. No document database.**

|                     | Verdict                   | Why                                                                                                                                                              |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL**      | **chosen**                | Transactional consistency across an aggregate; genuine relational shape; jsonb where the shape is genuinely open; row-level security available when auth arrives |
| Managed PostgreSQL  | **chosen for production** | Backups, PITR and patching are exactly the operational work worth buying at this size                                                                            |
| SQLite (local/test) | **rejected**              | See §11 — the divergence costs more than it saves                                                                                                                |
| Object storage      | **deferred**              | Nothing is large enough yet. Revisit at >1 MB or binary artifacts                                                                                                |
| Document database   | **rejected**              | Offers nothing here and costs the joins and transactions this workload is made of                                                                                |

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

Two layers. **Natural keys** where identity is derivable — assignment id from
`(case_id, playbook_entry_key)`, event id, revision id, result content hash —
all `ON CONFLICT DO NOTHING`. **An explicit `idempotency_keys` table** for
commands whose identity is not derivable, chiefly "open a case", where the
caller supplies a key and a replay returns the original case id.

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

## 10. Backup, retention, audit

Managed Postgres gives daily backups and point-in-time recovery — the main
reason to pay for managed rather than self-hosted at this size.

**Retention: nothing is deleted.** Rejected theses, dissent, superseded
revisions and decisions stay indefinitely; that is the point of the record, and
the workload analysis shows no size pressure to reconsider. Deletion policy
becomes a real question only when user-owned data exists, which is a
post-authentication concern.

Auditability is already structural — append-only events, immutable revisions,
content-addressed results — so no separate audit log is needed. What Postgres
adds is that the append-only property is enforced by permissions.

---

## 11. Local development and testing — and why not SQLite

**Recommendation: Postgres locally too, via a container. No SQLite anywhere.**

This differs from the initial expectation, so the reasoning matters. The schema
leans on jsonb, partial indexes, `ON CONFLICT`, column-level triggers and table
permissions. SQLite supports none of those the same way, so the local schema
would not be the production schema — and a test suite that passes against a
different schema than the one that ships is worse than no integration test at
all. The failure it would miss is exactly the class this gate exists to
prevent.

Three test tiers instead:

| Tier               | Store                        | Purpose                                          |
| ------------------ | ---------------------------- | ------------------------------------------------ |
| Unit               | existing in-memory repos     | Fast, offline, no I/O. Unchanged; still the bulk |
| Integration        | real Postgres in a container | The correctness properties in §4                 |
| Fitness / boundary | none                         | Unchanged                                        |

The in-memory adapter is **kept, not replaced** — it is what makes 774 tests
run in seconds, and it now also serves as the reference implementation of the
transaction boundary.

---

## 12. Deployment

**Currently undefined, and this plan cannot settle it.** The repository has no
Docker, Vercel, Fly, Railway or Render configuration, and no database driver in
`package.json`. Adding Postgres introduces the project's first infrastructure
dependency.

Managed options worth comparing when the host is chosen — Neon, Supabase, Fly
Postgres, RDS — all comfortably free or near-free at the normal volume. The
choice interacts with where the app runs, which is itself undecided, so it is
listed as an open decision rather than resolved here.

The single-instance constraint from TD-6 is unaffected: a shared Postgres does
not by itself make the market-data cache shared.

---

## 13. Authentication and tenancy

Durable storage does **not** wait for authentication, but the schema is shaped
so authentication is additive rather than a migration of every table:

- `tenant_id` on `cases` and `departments` from the start, defaulting to a
  system tenant
- `owner_employee_id` on `cases`, set to the system CIO for system-created work
- **No anonymous ownerless rows** — a system-created case has an explicit
  system owner, per the requirement

When authentication arrives it adds a `users` table, a mapping to employees,
and row-level security policies keyed on `tenant_id`. Postgres RLS is a large
part of why it is the right choice here: authorization becomes a policy rather
than a query rewrite across every call site.

Secrets follow the existing discipline — connection string from the
environment, never logged, never in a query string, never in the client bundle.
At-rest encryption comes from the managed provider; in-transit is TLS.

---

## 14. Implementation phases

1. **Port change** — `withTransaction` on `AnalysisRepositories`, implemented
   in the in-memory adapter. No database involved. Unblocks everything else.
2. **Schema and migrations** — SQL files, the runner, the seeded organization.
3. **Postgres adapter** — implements the existing ports unchanged.
4. **Integration suite** — the §4 correctness properties against real Postgres.
5. **Composition** — the runtime uses Postgres; unit tests keep in-memory.

Phases 1 and 2 are independent and could run in parallel.

---

## 15. Open decisions

|          | Decision                                     | Recommendation                                                         |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| **D-S1** | Add `withTransaction` to the ports           | **Yes — required.** Half-created workflows are otherwise unpreventable |
| **D-S2** | SQLite for local development                 | **No.** Divergent schema defeats the integration tests                 |
| **D-S3** | Organization as seeded tables vs code config | Seeded tables — a department must be data                              |
| **D-S4** | One `reviews` table vs four                  | One, with typed children — the headquarters asks one question          |
| **D-S5** | Where Postgres runs in production            | **Open** — depends on the undecided app host                           |
| **D-S6** | Migration tooling                            | Plain SQL + small runner, no framework                                 |

**D-S1 is the one that matters.** It is a change to Phase B's ports, and
without it several stated correctness properties cannot be met by any database.

---

## 16. Risks

**The port change touches approved Phase B code.** Small and additive, but it
is a modification to something already signed off.

**No deployment target exists.** Implementation can proceed regardless — the
adapter does not care where Postgres runs — but the phase cannot be called
production-ready until D-S5 is settled.

**First infrastructure dependency.** Everything so far runs from a clean
checkout with no external services. After this, the analysis runtime needs a
database. The market-data side is unaffected and stays fully offline in fixture
mode.

**Trigger-enforced immutability is unusual in this codebase.** Correctness has
so far been enforced in TypeScript. Moving part of it into the database is
right — the guarantee should not depend on every future caller — but it means
two places to look when something is refused.

---

## 17. Technical Debt & Future Improvements

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
