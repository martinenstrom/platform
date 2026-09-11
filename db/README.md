# Database

PostgreSQL schema, plain SQL migrations, and the seeded investment
organization. The design and its reasoning are in
[`docs/durable-storage-plan.md`](../docs/durable-storage-plan.md).

## Two connection strings, never one

| Variable | Role | Used by |
| --- | --- | --- |
| `DATABASE_URL` | schema **owner** | `npm run db:migrate`, nothing else |
| `ANALYSIS_DATABASE_URL` | `finos_app` | the running application |

```sh
# migrations — the owner, which can create and alter tables
DATABASE_URL=postgres://owner:…@host/finos npm run db:migrate

# the app — the runtime role, which deliberately cannot
ANALYSIS_DATABASE_URL=postgres://finos_app:…@host/finos npm run dev
```

Separate on purpose. The request path serves pages to people, and the
Headquarters view reads institutional records through it; handing that path the
owner connection would give a page request the privilege to drop a table. The
whole point of `finos_app` (see **Roles**, below) is that it cannot alter the
schema or rewrite history — a privilege it does not hold cannot be misused by a
bug, and reusing `DATABASE_URL` for convenience would return it silently.

Without `ANALYSIS_DATABASE_URL` the analysis runtime does not start and the
Headquarters view reports `NOT_CONFIGURED`. It does not fall back to
`DATABASE_URL`, and it has no in-memory mode: a store that cannot keep what the
firm decides is not a store the institution may run on.

The test suites need neither variable. `npm run test:db` starts real PostgreSQL
binaries (`embedded-postgres`) and creates both roles itself; set
`TEST_DATABASE_URL` to point it at an existing server instead.

## Applying migrations

```sh
DATABASE_URL=postgres://owner:…@host/finos npm run db:migrate
```

Run as the **schema owner**, which is a different credential from the one the
application uses. The runtime role cannot create or alter tables and cannot
write to the migration history; running migrations with the application's
credentials would quietly remove that separation.

Migrations are forward-only. There are no down migrations and the runner will
never undo anything: a mistake is corrected by writing a new migration. A down
migration is written before the failure it is meant to handle, is almost never
executed, and for this schema would usually mean dropping institutional records
that are supposed to be permanent.

## Writing a migration

`NNNN_lower_snake_case.sql`, numbered after the highest existing file. The
runner refuses a file it cannot parse and refuses two files sharing a number.

Each migration runs inside a transaction, so a failure leaves nothing behind.
A migration that genuinely cannot (`CREATE INDEX CONCURRENTLY`) must say so
with `-- migrate:no-transaction` on its own line; the declaration is required
so nobody discovers the limitation from a production error.

**An applied migration is never edited.** Its checksum is recorded, and editing
it stops the next run with an error naming both checksums. Every database that
already ran it has the old version's effects, so an edit makes the history a
description of something that never happened.

### Schema existence does not prove runtime writability

Learned the hard way, twice, in one stage: migration `0040` added the agent
columns and `0041` had to add the table grants it omitted; then `0043` had to
add the **column-level** `UPDATE` grant it omitted as well. Both times the
column existed, the constraint allowed the value, every suite was green, and
the first real command failed with `StoragePermissionError`.

`finos_app` holds column-level `UPDATE` on several tables (`runs` since `0009`,
`assignments`, `thesis_revisions`). A new column on one of those is **not**
writable because the table is — the grant lists columns by name.

For any migration that introduces a writable table or column, check three
things, in this order:

1. **DDL** — schema, column, foreign key and `CHECK` shape are what the domain
   means.
2. **Privileges** — `SELECT`, `INSERT`, `UPDATE` as the write path needs them,
   **and** an explicit column-level `GRANT UPDATE (col)` wherever the table's
   `UPDATE` is column-restricted. An insert-only table needs no `UPDATE` and
   should not be given one.
3. **Runtime** — one real production command writes the new surface. Not a
   schema assertion and not a fixture: a green suite measures reachable code,
   and an ungranted column is reached only by the path that writes it.

## Roles

Migration `0009` creates two **NOLOGIN group roles**. They carry privileges;
they hold no credentials, so nothing secret appears in version control.

| Role               | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `finos_app`        | The application runtime                                      |
| `finos_readonly`   | Operational read access — dashboards, investigation, support |
| (the schema owner) | Whoever runs migrations. Not a role this schema creates      |

Deployment creates a login user and grants it the group role:

```sql
CREATE ROLE finos_runtime LOGIN PASSWORD '…';
GRANT finos_app TO finos_runtime;
GRANT CONNECT ON DATABASE finos TO finos_runtime;
```

`finos_app` deliberately **cannot**: create or alter tables, drop or disable a
trigger, write to `schema_migrations`, update or delete an append-only table
(`transition_events`, `run_events`, `claims`, `evidence_*`, `agent_results`,
`reviews`), rewrite a sealed thesis revision, rewrite a committed
`case_decision`, edit the organization, or grant itself anything further.

`idempotency_keys` is the one table anything may delete from — it is
operational rather than institutional and expires at 30 days. Everything else
is kept indefinitely, which is the point of the record.

## Testing

```sh
npm run test:db
```

Runs against real PostgreSQL. By default it starts an embedded cluster
(`embedded-postgres`, real PostgreSQL binaries); set `TEST_DATABASE_URL` to use
an existing server instead, which is what CI should do.

The permission tests connect **as the runtime role**, not as the owner. A
permission suite that runs as the owner proves only that the owner is the
owner.
