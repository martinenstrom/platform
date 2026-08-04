# C1D-1B stage B2C-3 — PostgreSQL harness process management

**Planning gate. No implementation.**

Test-harness lifecycle only. **No repository behaviour changes, no SQL, no
domain rules, no commands, no LLM, no UI.** Everything B2C-2 proved must still
pass unchanged afterwards, and the only production code B2C-3 touches is none.

---

## 0 · What the library actually gives us

Checked against `embedded-postgres`'s own types rather than assumed, because
the whole ownership design depends on it.

| Capability | Reality |
| ---------- | ------- |
| a process handle from `start()` | **No.** `private process?` — the pid is not exposed by the public API. |
| an OS-assigned port | **No.** `port: number` is a plain option passed as `-p`; there is no port-0 path. |
| `stop()` | Kills by the pid it kept privately (`taskkill /pid … /f /t` on Windows), and with `persistent: false` **deletes the data directory's contents**. |
| shutdown on exit | A `close` listener on the child process. It does **not** survive a `SIGKILL` of the runner. |

Two consequences shape everything below:

1. **The pid must come from somewhere else.** It comes from `postmaster.pid`,
   which PostgreSQL writes into the data directory — a file *we* created the
   directory for. Line 1 is the postmaster pid, line 4 is the port. That single
   file ties a pid to a port to a directory whose path we chose, which is
   stronger ownership evidence than anything the library exposes.
2. **The port race cannot be eliminated, only bounded.** §2.

---

## 1 · Ownership — the rule I would least like to get wrong

> **The harness terminates a PostgreSQL process only when every piece of
> harness-created evidence agrees.** Absent that, it fails and reports.

**Evidence, all four required:**

| Evidence | Created by | Proves |
| -------- | ---------- | ------ |
| a marker file at a fixed path — `{ sessionId, directory, port, pid, startedAt }` | the harness, after a successful start | a run of *this* harness started something |
| the cluster directory | the harness, via `mkdtemp` under a known prefix | the directory is ours and not shared |
| `postmaster.pid` inside that directory | PostgreSQL itself | the pid and port that cluster is actually running on |
| the live pid | the OS | it is still running |

**Termination requires all of:** the marker exists · its `directory` is under our
`mkdtemp` prefix · that directory still contains a `postmaster.pid` · the pid in
that file equals the marker's pid · that pid is alive · the port in that file
equals the port under contention.

**Never a reason to terminate, alone or together:** the port is occupied · a
process is named `postgres` · a pid file exists somewhere · the port used to be
54330 and 54330 is "the test port".

If the port is occupied and ownership cannot be proven, the run **fails
immediately** with the port, what is listening if that is discoverable safely,
the marker's contents if any, and what to do — and terminates nothing. A
developer's own PostgreSQL is the case this protects, and it is worth failing a
test run for.

### 1.1 The decision is a pure function

```ts
type Startup =
  | { action: 'start' }
  | { action: 'reclaim'; pid: number; directory: string }
  | { action: 'cleanStale'; directory: string }
  | { action: 'refuse'; reason: RefusalReason }

decideStartup(input: {
  portAnswering: boolean
  marker: Marker | null
  directoryUnderOurPrefix: boolean
  postmasterPid: number | null
  postmasterPort: number | null
  pidAlive: boolean
}): Startup
```

No I/O, no `process.kill`, no filesystem. Every combination is unit-tested —
including the ones that must refuse — and the actual killing is a thin caller
that does what the function says. **The decision to kill is exhaustively tested;
the kill itself is not simulated**, which is the honest split.

Cases the table must cover explicitly:

| portAnswering | marker | dir ours | pid matches | alive | → |
| --- | --- | --- | --- | --- | --- |
| no | none | — | — | — | `start` |
| no | present | yes | yes | no | `cleanStale` |
| yes | none | — | — | — | `refuse: unowned-port` |
| yes | present | **no** | — | — | `refuse: foreign-directory` |
| yes | present | yes | **no** | — | `refuse: evidence-mismatch` |
| yes | present | yes | yes | yes | `reclaim` |
| yes | present | yes | yes | no | `refuse: port-held-by-other` |

That last row matters: our marker's process is dead, yet something still holds
the port. It is not ours, and it is not killed.

---

## 2 · Dynamic ports, and the race that cannot be removed

The library needs a concrete port, so the harness must choose one. Choosing
means: bind an ephemeral socket on `127.0.0.1:0`, read the assigned port, close
it, hand it to `embedded-postgres`.

**Between the close and PostgreSQL's bind, the port is free for anyone to
take.** That race is inherent to this API and cannot be closed from here —
there is no way to hand an already-bound descriptor to the child.

**Residual race, documented rather than hidden.** Mitigated by:

- the window being microseconds on a loopback interface
- **bounded retry** — on a bind failure, select a *new* port and retry, up to a
  small fixed number of attempts, then fail with a diagnostic naming every port
  tried
- never reusing a port that just failed

`TEST_DATABASE_URL` continues to bypass all of this.

**The fixed 54330 is deleted.** It is the cause: a fixed port is what makes one
interrupted run poison the next.

---

## 3 · Startup, teardown and interruption

### 3.1 Startup

1. read the marker, if any
2. probe the chosen port
3. `decideStartup(...)` → act on it
4. on `reclaim`: terminate the owned pid, **wait for exit**, remove the owned
   directory, then continue
5. on `cleanStale`: remove the stale marker and its owned directory
6. select a port (§2), `initialise()`, `start()`
7. **wait for readiness** — connect and run `SELECT 1`, with a bounded timeout,
   rather than trusting `start()` to mean "accepting connections"
8. write the marker

A failure anywhere after step 6 stops whatever came up, removes the directory,
and rethrows — an interrupted *setup* must not leave what a successful run would
have cleaned.

### 3.2 Teardown

Close pools · `stop()` the cluster · **wait for exit** · remove the marker only
after exit is confirmed · remove the owned directory · report any cleanup failure
clearly, **without replacing the test failure that may have caused it**.

Idempotent: teardown twice is a no-op, and teardown after a failed setup is
safe.

`process.once('SIGINT' | 'SIGTERM')` runs the same teardown, so an interrupted
run cleans up after itself where the OS gives it the chance.

### 3.3 What it cannot handle, stated

A `SIGKILL` of the runner leaves no opportunity to run anything. The next run
then recovers **only if** the marker was written before the kill. If the kill
lands between `start()` and the marker write, a cluster is left running that the
harness cannot prove is its own — and it will **refuse rather than kill**, with
a diagnostic naming the directory prefix so a developer can check.

That is the deliberate trade: an occasional manual cleanup, never an
accidentally terminated database.

---

## 4 · Diagnostics

Each replaces a symptom with a cause. The generic worker timeout is what we are
removing, **not raising**.

| Condition | Message names |
| --------- | ------------- |
| port occupied, unowned | the port, the marker if any, and that nothing was terminated |
| port occupied, ours, live | that it is being reclaimed, with pid and directory |
| evidence mismatch | which piece disagreed |
| cluster failed to start | the directory, the port, and the last lines of the postgres log |
| readiness timeout | how long it waited and on which port |
| process exited unexpectedly | the exit code |
| teardown incomplete | what remains, and that the original failure is preserved |

---

## 5 · Tests

**Unit, exhaustive** — every row of §1.1, plus: refusal never returns a pid;
`reclaim` only with all four evidences; a marker naming a directory outside the
prefix always refuses.

**Integration** — a dynamic port is selected and differs from 54330 · a second
cluster starts alongside the first on a different port · readiness is awaited ·
teardown terminates the owned process and the pid is gone · teardown twice
succeeds · an interrupted setup leaves no directory · the suite ends with no
owned process and no idle backend.

**Not simulated:** killing an unrelated PostgreSQL to prove we do not kill it.
The *decision* is unit-tested across every combination; manufacturing a foreign
postmaster to prove a negative would be a test that could itself kill something.
Stated rather than quietly skipped.

**Regression** — the entire repository suite passes unchanged. B2C-3 changes no
production file; a repository test that changes behaviour means something is
wrong with the harness change.

---

## 6 · Files

| File | Change |
| ---- | ------ |
| `src/test/pgGlobalSetup.ts` | dynamic port · ownership · recovery · readiness · diagnostics · signal teardown |
| `src/test/pgOwnership.ts` | the pure `decideStartup` and the marker types |
| `src/test/pgOwnership.test.ts` | the exhaustive decision table |
| `src/test/pgHarness.pg.test.ts` | the integration behaviours |

No file under `src/domain`, `src/application` or `src/infrastructure` is
touched.

## 7 · Risks

**R23 — a kill decision is the most dangerous thing here.** *Mitigation:* §1's
four-evidence rule, the pure function, the exhaustive table, and refusal as the
default on every ambiguity.

**R24 — the port race is real and not removable.** *Mitigation:* bounded retry
with a fresh port and a diagnostic listing every attempt. Documented, not
implied away.

**R25 — a marker could be written by a harness of a different version.**
*Mitigation:* the marker carries a schema version; an unrecognised one is
treated as foreign, so it is never acted on.

## 8 · Technical debt

**Opened:** possibly **TD-59**, if the `SIGKILL`-before-marker window (§3.3)
proves to be more than theoretical in practice — recorded with the exact
sequence rather than as a vague caveat.

**Unchanged:** TD-58 (**high**, and now a hard gate before C1D-1C exposes
`SubmitForCioDecision` to a real application path or writes retained
institutional submissions) · TD-57 · TD-55 · TD-52 · R6 · the rest.

**Contract versions:** command **2**, domain **8** — unchanged, because no
production code is touched.

---

## 9 · What I need decided before B2C-3

1. **Refuse-over-kill on the ambiguous case** (§3.3): a cluster left by a
   `SIGKILL` before the marker was written is unprovable, so the next run fails
   and asks a human. The alternative — killing any postmaster whose data
   directory sits under our tmp prefix — is more convenient and I am not
   proposing it. Confirm.
2. **Bounded retry count** for the port race. I suggest **five** attempts.
3. **TD-59** opened only if the window proves real, rather than pre-emptively.

Everything else I am prepared to build as written.
