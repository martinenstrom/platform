# Financial OS — persistent personal operating system: implementation plan

Written 2026-10-04. The contract for the phase that turns the prototype into a
persistent, single-advisor Windows application: lifecycle, SQLite, desktop,
backup and restore, designed together.

## 1. Current persistence architecture

- **Advisory record.** `infrastructure/advisory/container.ts` composes one
  `AdvisoryContext` per server process over `createSyntheticAdvisoryRepositories`
  (`Map`s seeded from `syntheticClients(today)`). The ports in
  `application/advisory/ports.ts` are the seam: clients/offices/households/
  advisors (read-only), wealth, portfolios, goals, interactions + memory
  candidates, context facts, commitments, events, opportunities, Sentinel
  dispositions, the market-event ledger, meeting snapshots, and the identity
  mint. Nothing survives a restart (TD-104, TD-110, TD-111).
- **Documents.** `infrastructure/documents/meetingPackStore.ts` keeps generated
  packs in a process-local map and writes files to `.generated/meeting-packs`
  beside the repository.
- **Institution (HQ).** `infrastructure/analysis` has in-memory and PostgreSQL
  adapters judged by one contract, migrated by `scripts/db-migrate.ts`. Out of
  scope here: the desktop runs the institution on its in-memory adapter.
- **Server.** TanStack Start 1.168 on Vite 7. `vite build` emits
  `dist/client` (static) and `dist/server/server.js`, which exports a Fetch
  handler (`server.fetch(request)`), not a listener.
- **JARVIS.** `infrastructure/jarvis/serverFns.ts` reaches the record only via
  `advisoryContext()` in `infrastructure/advisory/serverFns.ts`.

## 2. Mutation points today (all process-local)

`recordClientUpdate` (candidate), `confirmClientUpdate` (interaction, facts,
commitments, events, meeting snapshot), `completeCommitment`, `disposePriority`
(Sentinel), `marketEvents.replace` (ledger, derived), `meetingSnapshots.save`,
`generateMeetingPack` (store + file). No client, office or household is ever
created or changed: the seed is the register.

## 3. Client lifecycle model

`domain/advisory/lifecycle.ts`:

- `LifecycleStatus = 'onboarding' | 'active' | 'former'`; `Client` gains
  `lifecycle: { status, since, closure: { effectiveDate, reason, note } | null }`.
- `ClosureReason = CLIENT_CHOICE | COMPETITOR | NO_LONGER_ELIGIBLE |
DECEASED_OR_ESTATE | MOVED_OR_REASSIGNED | OTHER`.
- `LifecycleEvent { id, subject: 'client' | 'office', subjectId, kind,
effectiveDate, at, by, detail }`, kinds `CLIENT_CREATED, CLIENT_ACTIVATED,
CLIENT_MOVED_OFFICE, CLIENT_ADVISOR_CHANGED, CLIENT_UPDATED, CLIENT_CLOSED,
CLIENT_REACTIVATED, OFFICE_CREATED, OFFICE_UPDATED, OFFICE_ARCHIVED,
OFFICE_REACTIVATED`.
- `ClientOfficeHistory { clientId, officeId, from, to | null }` is the history;
  `Client.officeId` is the current office. Moving never rewrites history.
- Pure rules: `transition(status, act)` (onboarding→active, active→former,
  former→active only), `closureReview(facts)` (open commitments, booked
  meetings, future financing and important events, open opportunities),
  `onboardingOverview(facts)` (seven areas, "4 av 7 områden kartlagda"),
  `contributesToActiveBook(client)` = status active. Onboarding clients
  contribute to no active aggregate; their own book shows what is known.
  Former clients contribute nothing and are never Sentinel priorities.
- Duplicates: `similarClients(name, clients)` by normalised name
  (case/diacritics/whitespace) — warn; a former match offers reactivation.

## 4. Office lifecycle model

`Office.status: 'active' | 'archived'` (exists), plus `archivedAt`.
`archiveOffice` is blocked while active clients remain; the controlled assist
(choose destination, preview, confirm) moves them in the same transaction,
each with `CLIENT_MOVED_OFFICE`. Archived offices stay readable; former
clients keep their office history. Presentation image mapping stays in
`presentation/advisory/officePlates.ts` and the fallback material covers new
offices.

## 5. SQLite architecture

- Driver: Node's built-in `node:sqlite` (`DatabaseSync`), present in the test
  runtime (Node 24.18) and in Electron 44 (Node 24.21, SQLite 3.53). No native
  module, one driver everywhere. Online snapshots via `node:sqlite`'s
  `backup()`; `VACUUM INTO` as the second mechanism.
- `infrastructure/advisory/sqlite/database.ts`: open with
  `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
  `busy_timeout=5000`; `transaction(fn)` = `BEGIN IMMEDIATE … COMMIT/ROLLBACK`;
  `quickCheck()`, `foreignKeyCheck()`, `snapshotTo(path)`.
- `repositories.ts`: `createSqliteAdvisoryRepositories(db)` for every port,
  plus the new lifecycle ports. Rows map 1:1 to domain records; provenance is
  inline columns; only genuinely nested, frozen documents are JSON
  (performance series points, meeting-snapshot baseline, market-event payload,
  reminder rules, extracted candidate items).
- Relational tables: `advisors, offices, households, household_members,
clients, client_office_history, lifecycle_events, assets, liabilities,
portfolios, portfolio_allocations, holdings, portfolio_performance, goals,
interactions, memory_candidates, context_facts, commitments,
important_events, opportunities, sentinel_dispositions,
market_ledger_events, meeting_snapshots, generated_documents,
id_sequences, settings, schema_migrations`. Relationship health is a
  derivation and is not stored (store facts, not conclusions); financial
  snapshots are the meeting baselines already modelled.
- Unit of work: `AdvisoryRepositories.transaction<T>(fn)`; the synthetic
  adapter implements it with a snapshot of its maps restored on throw, so the
  contract tests exercise rollback on both adapters.
- Contract: `advisoryRepositoryContract.ts` runs against both adapters; the
  contract is the authority, never one store.
- Modes: `FINANCIAL_OS_MODE=desktop` (SQLite in the app-data directory, never
  seeded), `dev` (today's synthetic in-memory record unless
  `FINANCIAL_OS_STORE=sqlite`; seeding only with `FINANCIAL_OS_DEMO_SEED=1`),
  `test` (in-memory or a temp-dir SQLite file). The data directory is
  `FINANCIAL_OS_DATA_DIR` when set, else the desktop host's path, else
  `%LOCALAPPDATA%\Financial OS Dev`. Never the repository.

## 6. Migration strategy

`sqlite/migrations/index.ts` lists `{ version, name, sql, checksum }`;
`schema_migrations` records applied versions with checksums and
`PRAGMA user_version` mirrors the latest. On open: detect version; if behind
and the database is non-empty, snapshot to `backups/pre-migration/
v<from>-<ts>.db`; apply each migration in its own transaction; verify
(`quick_check`, `foreign_key_check`, expected version); on failure roll back,
leave the file untouched and report `MIGRATION_FAILED` to Recovery Mode.
A database newer than the application refuses to open (`SCHEMA_TOO_NEW`).

## 7. Desktop packaging architecture

Inspection finding: the entire backend — TanStack Start server functions,
document rendering (pptxgenjs, pdfmake), market-data providers, the Avanza
MCP stdio child, OpenAI — is Node code. Tauri's host is Rust and can only run
it as a bundled Node sidecar over loopback HTTP: two runtimes, a localhost
hop, and no Rust toolchain on this machine to verify a build. **Electron**
runs the same server bundle in-process and serves the UI over a private
`app://` scheme with no socket at all. The shell is isolated behind a
`DesktopHost` port (paths, dialogs, single instance, autostart), so another
shell can replace it.

- `desktop/main.mjs`: single instance (`requestSingleInstanceLock`), data
  directory from `app.getPath('userData')` → `Financial OS/{financial-os.db,
documents, backups, logs, config}`, open/health/migrate, then
  `protocol.handle('app', …)`: static files from `dist/client`, everything
  else to `server.fetch`. First run opens `/setup`; a damaged database opens
  `/recovery`; otherwise `/`. Controlled shutdown takes a snapshot.
- `desktop/preload.cjs` exposes only `chooseFolder`, `chooseFile`, `openPath`,
  `relaunch`, `autostart get/set` through `contextBridge`.
- electron-builder: NSIS installer, Start Menu and desktop shortcut, app icon,
  per-user install, `productName "Financial OS"`. Unsigned in V1.
- Dev keeps `vite dev`; the desktop loads the production bundle only.

## 8. Persistent document storage

`documents/meeting-packs/<clientId>/<fileName>` under the data directory;
`generated_documents` holds id, client, kind, version, format, path (relative),
byte length, fingerprint, SHA-256, generatedAt, meeting, depth, audience,
source as-of, counts. `MeetingPackStore` becomes SQLite-backed; versions stay
immutable; download reads the file and verifies its SHA-256.

## 9. Backup architecture

`infrastructure/backup/`:

- `snapshots.ts`: `backups/snapshots/financial-os-<ts>.db` via the SQLite
  backup API; retention 6 intra-day, 7 daily, 4 weekly; triggers: every 30
  minutes while running, after a migration, after a lifecycle act (debounced),
  at controlled shutdown, and on demand.
- `bundle.ts`: `.financialos` recovery bundle = AES-256-GCM over a ZIP of
  `manifest.json` (bundle id, createdAt, app version, schema version, counts,
  entries with SHA-256), the database snapshot and `documents/**`. Key from
  the user's passphrase by scrypt; header carries salt, nonce, KDF params.
  The passphrase is kept only in Electron `safeStorage` (Windows DPAPI) for
  unattended exports; never in Git, logs or source.
- `destinations.ts`: `BackupDestination { kind: 'LOCAL' | 'EXTERNAL', path }`;
  V1 external = a user-selected folder; daily and manual export; unavailable
  destination is reported, never silently skipped.

## 10. Disaster recovery

Startup: WAL file present before open = unexpected end; `quick_check` and
`foreign_key_check`; migration state. Healthy → open. Otherwise Recovery Mode
with the newest verified snapshot or bundle offered; the primary file is
never overwritten (restore writes beside it and renames). Deep checks
(`integrity_check`, document manifest, bundle checksums) run from the
Recovery Center or weekly.

## 11. Off-device recovery

The external destination carries the encrypted bundle; the Recovery Center
shows the last external backup and its verification. `verifyBundle(path,
passphrase)` checks manifest, every checksum and schema compatibility
without restoring.

## 12. First run and restore

`/setup`: CREATE NEW FINANCIAL OS (empty database, no demo data) or RESTORE
EXISTING FINANCIAL OS (choose bundle → passphrase → validate → summary: date,
clients, offices, documents, schema → ÅTERSTÄLL). Restore: safety snapshot of
the current database (when one exists), unpack to `financial-os.db.restoring`,
verify, swap by rename, restore documents with checksum checks, migrate if the
bundle's schema is older, relaunch.

## 13. Tests

Contract tests on both adapters; migration tests (fresh, upgrade, checksum
drift, failed migration keeps the old file); lifecycle use-case tests incl.
rollback through a failing repository; aggregates exclude former and
onboarding; Sentinel active-only; backup/bundle/restore tests in temp dirs
(corrupt bundle, bad checksum, wrong passphrase, missing document, schema too
new, destination unavailable); health and log-redaction tests; Public
Research firewall tests (existing); Electron smoke with Playwright (launch,
no listening socket for the PID, single instance, first run → create → add
client → relaunch → still there; restore on a fresh data dir).

## 14. Staged order

A desktop foundation · B SQLite + repositories + migrations · C client
lifecycle · D office lifecycle · E document paths · F crash safety · G
snapshots · H bundle · I restore · J external destination · K Recovery
Center. Relevant tests after each; the solo suite, build and package at the
end.

## 15. Implementation record (2026-10-06)

What was built against this plan, and where it departs from it — each
departure measured, not reasoned.

- **Driver.** `node:sqlite` is reached through `process.getBuiltinModule`,
  not a static import. The client build follows the composition root's
  dynamic import while mapping the graph, and a named import from a builtin
  Vite cannot stub is a hard error there. The composition root itself is kept
  out of the browser graph by handing every server function its own
  `() => import('./container')` loader inside the handler body, exactly as
  the market source is handed in (`advisoryContext(loadMarketSource,
  loadContainer)`).
- **First run.** `openAdvisoryStore(path, { createIfMissing: false })` answers
  `NOT_INITIALISED` for an absent file; the desktop, and development on SQLite
  without `FINANCIAL_OS_DEMO_SEED=1`, never create the record silently. The root
  route's loader reads `getSystemStatusFn` and `systemGate()` sends the reader
  to `/setup` (no record) or `/recovery` (record refused to open) before any
  page is read. CREATE NEW writes the one advisor the workspace is read for
  (`workspaceAdvisorRecord()`), nothing else.
- **Host ↔ application.** Two hooks by well-known symbol, no import either
  way: `financial-os:secrets` (the host lends `safeStorage`/DPAPI for the
  backup passphrase) and `financial-os:shutdown` (the application closes in
  order on `before-quit`: pending snapshot, checkpoint, close).
- **Scheme and CSRF.** Electron hands the scheme handler a request without
  `Origin`, `Referer` or `Sec-Fetch-Site`; TanStack Start's server-function
  guard refuses such a request. `desktop/serve.mjs` marks a request with no
  provenance as same-origin — the scheme is served to this window and nothing
  else — translates one that names the application scheme, and leaves a
  foreign origin to be judged as it stands. Measured: every server function
  call from the window was 403 until this.
- **Snapshots.** Retention 6 recent / 7 daily / 4 weekly, `pre-restore`
  protected; a snapshot is skipped when `total_changes()` has not moved since
  the last one; triggers startup (existing record), post-migration, 30 min,
  60 s after a committed unit of work, shutdown, manual, pre-restore.
- **Bundle.** `FOSB` · version · scrypt params · salt(16) · nonce(12) ·
  tag(16) · AES-256-GCM(ZIP{manifest.json, database/financial-os.db,
  documents/**}); scrypt N=2^14, r=8, p=1; a wrong passphrase and a damaged
  file are one refusal by design. V1 holds the archive in memory.
- **Restore.** Written beside the primary (`.restoring`), checked and migrated
  there, then the current set (`.db`, `-wal`, `-shm`) moved aside under one
  suffix and the restored file renamed into place; documents likewise.
  `restoreFromSnapshot` restores the database only.
- **Documents.** `MeetingPackStore` is an interface; `SqliteMeetingPackStore`
  keeps rows in `generated_documents` and files under
  `documents/meeting-packs/<clientId>/`, proving SHA-256 on download
  (`CORRUPT` is a code the preview shows). The synthetic record keeps the
  process-local store under `.generated/`.
- **Proof.** `desktop/probe-persistence.mjs`: first launch → CREATE NEW
  (nothing seeded) → office and client → controlled close (no `-wal`) →
  relaunch (still there) → snapshot → verified encrypted export → a second,
  empty data directory → RESTORE EXISTING with the passphrase → relaunch
  (still there). 23/23 on the host; rerun on the packaged executable at the
  end of the phase.
- **Durability (audit 2026-10-06).** `synchronous=FULL`, not NORMAL as §5
  planned: NORMAL under WAL is consistent but can lose the commits since the
  last checkpoint on a power loss; a personal record's write volume makes the
  sync per commit cheap. The audit also corrected the closing report: the
  institution (Huvudkontoret, Underlag, agents, cases, runs) has NO adapter on
  the desktop — `runtime()` throws `NotConfiguredError` without
  `ANALYSIS_DATABASE_URL`, every HQ door answers NOT_CONFIGURED and the pages
  say so; the in-memory adapter exists for tests only. Nothing a person
  enters there on the desktop is accepted in the first place.
- **Known limits.** Unsigned installer (SmartScreen asks once); the bundle is
  built in memory; the institution (HQ) still runs on its in-memory adapter;
  the external destination is a folder, no transport of its own; log
  rotation is size-based only.
