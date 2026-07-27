# Database

PostgreSQL schema, plain SQL migrations, and the seeded investment
organization. The design and its reasoning are in
[`docs/durable-storage-plan.md`](../docs/durable-storage-plan.md).

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
