# Sentinel V1 — who needs the advisor today, why, and what to prepare

**Status: implemented 2026-09-24 on top of the Client Intelligence
checkpoint `5f3c928`. Synthetic clients only; no notifications, no
market-to-client engine.**

Sentinel is a prioritisation engine, not an alert centre. Every morning it
answers, from the facts Client Intelligence already holds: who should I
contact today, why today, what has changed, what did I promise, what is
approaching, what does it mean for the relationship, and what should I
prepare. Five excellent signals over fifty alerts.

## 1. Where it lives

```
domain/advisory/sentinel.ts      SentinelPriority, SentinelDriver, SentinelDisposition;
                                 prioritiseClient(facts) — one priority per client;
                                 comparePriorities; statusOf; SENTINEL_THRESHOLDS
application/advisory/sentinel.ts sentinelBrief(context) — every client ranked, with row
                                 facts and metrics; disposePriority (reviewed / snoozed /
                                 dismissed); SentinelRepository port
infrastructure/advisory          dispositions in the synthetic repositories; the advisory
                                 door gains getSentinelBriefFn and disposePriorityFn, on
                                 the same advisory clock (ADVISORY_REFERENCE_DATE)
presentation/advisory/sentinelText.ts
                                 titles, why now, why it matters, preparation, driver
                                 sentences, severity and section labels — Swedish, once
components/sentinel              SentinelBriefList + SentinelGreeting (dashboard),
                                 SentinelQueue (/sentinel)
routes/sentinel.tsx, routes/index.tsx (loader), lib/navigation.ts (Sentinel destination)
```

Sentinel consumes `assembleClientFacts`, `relationshipHealth`, `signalsFor`,
`openCommitments`, `upcomingEvents`, `nextMeeting`, `daysSinceContact` and
the balance sheet as they are. Client 360 is untouched.

## 2. One priority per client

For each client the record is read into **drivers** — typed facts with
their numbers and the id of the record they rest on — and one **anchor** is
chosen by precedence. Everything else becomes evidence beneath it. Henrik's
meeting in ten days, his refinancing in fifty-three and the comparison he
was promised are one priority, _Förbered finansieringsdiskussionen inför
mötet 3 okt_, with the meeting, the refinancing (SEK 6.5m), his concern, the
cash, the drift, the two open promises, the stale holding valuation and the
timely financing opportunity as its drivers. Never three items.

### Precedence (the anchor), severity and horizon

| #   | Anchor                                                                          | Severity                                           | Horizon                                                   |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| 1   | Overdue promise                                                                 | critical                                           | today                                                     |
| 2   | Promise due today or tomorrow                                                   | critical                                           | today                                                     |
| 3   | Meeting today or tomorrow                                                       | high; critical if there is something to prepare    | today                                                     |
| 4   | Promise due within 7 days                                                       | high                                               | upcoming                                                  |
| 5   | Meeting within 14 days                                                          | high if there is something to prepare, else normal | today if ≤ 7 days and something to prepare, else upcoming |
| 6   | Material event within 14 days                                                   | high                                               | today if ≤ 3 days, else upcoming                          |
| 7   | Relationship risk: health at-risk, silence ≥ 90 days, or a complaint within 180 | high                                               | today                                                     |
| 8   | Material event within 30 days                                                   | normal                                             | upcoming                                                  |
| 9   | Silence ≥ 60 days                                                               | normal                                             | upcoming                                                  |
| 10  | Concern recorded within 30 days                                                 | normal                                             | upcoming                                                  |
| 11  | Excess cash or allocation drift ≥ 5 pp                                          | normal                                             | watch                                                     |
| 12  | Material event within 90 days                                                   | low                                                | watch                                                     |
| 13  | Birthday within 7 days                                                          | low                                                | upcoming                                                  |
| 14  | Soft event (annual review, family) within 30 days                               | low                                                | upcoming                                                  |
| 15  | Silence ≥ 30 days                                                               | low                                                | watch                                                     |
| 16  | Stale valuation (> 180 days) before a review or meeting within 30 days          | low                                                | watch                                                     |
| 17  | Opportunity expected within 60 days, with nothing else                          | low                                                | watch                                                     |
| —   | Nothing above                                                                   | no priority                                        | —                                                         |

_Something to prepare_ for a meeting: an open or due promise, an active
concern, drift, excess cash, a material event within 90 days, a stale
valuation, negative health, or an undiscussed financing. _Material_ events:
loan maturity, refinancing, investment maturity, company sale, liquidity
event, pension event, property completion or purchase, planned withdrawal,
tax deadline.

### Drivers collected

Overdue, due and open promises; the next meeting within 14 days; events
within 90 days (birthdays within 7); active concerns with their age;
silence ≥ 30 days; health when watch or at-risk, with its negative
drivers; allocation drift and excess cash (the existing signals); large
withdrawals and complaints; opportunities (kept as evidence only when
expected within 60 days); the oldest valuation when older than 180 days
before a review within 30; and _undiscussed_: a financing event approaching
with no interaction on financing in the last 60 days.

### Score

Ordering only, never shown: severity base (400 / 300 / 200 / 100) + urgency
(30 − days to the anchor's date, or 30 + days overdue up to 30) + the sum of
driver weights (overdue 25, due 15, complaint 12, meeting 12, concern 12
recent / 8, material event 10, health 15 at-risk / 6 watch, silence 15 /
8 / 3 by threshold, withdrawal 8, drift 6, cash 6, undiscussed 5, open
promise 4, opportunity 3, birthday 2, stale valuation 2). Queue order is
severity, then horizon, then score, then id.

### Rule collisions, as tested

- Overdue promise + meeting tomorrow → the promise, with the meeting as a driver.
- Meeting + refinancing → one meeting preparation with the refinancing as a driver.
- Long silence + concern → relationship risk, today.
- Birthday + overdue promise → the promise; the birthday is evidence.
- Opportunity + urgent promise → the promise; a far opportunity is not even evidence.
- A refinancing in 14 days outranks a birthday in 14 days.

## 3. Resolution is derived; the advisor's word is stored

A completed promise, a passed meeting, a fresh interaction or a portfolio
back within its mandate stop producing drivers, and the priority disappears
because the facts did. The only state Sentinel writes is a **disposition**
— _reviewed_ (a marker), _snoozed until_ a date with an optional reason,
_dismissed_ — bound to the priority's **fingerprint** (theme, severity and
sorted source ids). A dismissal lapses the moment the facts change; a snooze
ends on its date; the newest disposition wins. Dispositions live in the
synthetic repository with everything else (per process, TD-104).

## 4. Surfaces

- **Dashboard.** Under _God morgon_, one restrained line: _Sentinel · 5
  klienter behöver din uppmärksamhet i dag · 2 möten kommande 7 dagar · 4
  försenade åtaganden_, with a door to the queue. Between the market
  overview and the market detail, a _Klientprioriteringar · Sentinel_ module
  in the dashboard's own card and tile language: the four highest-ranked
  priorities, each with severity, client, title, why now, last and next
  contact, preparation and _Öppna klient_; _Visa alla_ to the queue. Both
  render only when the advisory record answered; the market screen is
  complete without them.
- **`/sentinel`.** Six counts (act today, meetings within 7 days, overdue
  promises, relationship risks, opportunities, quiet clients), then
  _Behöver åtgärd nu_, _Kommande_, _Bevaka_, _Möjligheter_. A row carries
  severity, client, AUM and health, the title, _Varför nu_, _Underlag_,
  the next date, the preparation, _Öppna klient_, and _Granskad / Snooza /
  Avfärda_. _Varför ser jag detta?_ opens every driver as a sentence with
  the source ids. Set-aside and quiet clients are listed at the foot, so a
  client with nothing to do is visibly a client with nothing to do.

## 5. What the seed demonstrates on the frozen clock (2026-09-23)

| Client    | Priority                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| Berglund  | overdue promises (30 and 20 days), silence 64 days, health at-risk — critical, today                              |
| Grahn     | overdue promise (33 days), refinancing in 38 days, excess cash, silence 47 — critical, today                      |
| Dahlqvist | overdue promise (6 days), meeting in 3 days, bridge loan maturing in 45, concern, birthday in 7 — critical, today |
| Ceder     | meeting in 6 days with an unresolved concern and a watch-band relationship — high, today                          |
| Alvarsson | meeting in 10 days with refinancing, concern, cash, drift, two promises, a stale valuation — high, upcoming       |
| Forsell   | silence 70 days, bond maturing in 72, birthday in 3 — normal, upcoming                                            |
| Ekstrand  | **nothing** — spoke 8 days ago, next meeting in 84, nothing due                                                   |

Two seed changes made this honest: Ekstrand's capital call moved from 35 to
120 days out so one client is quiet, and Forsell's birthday now falls three
days from _today_, whatever today is, so the relationship prompt stays
demonstrable.

## 6. Not built

No market-triggered signals, no competitor or fee intelligence, no
notifications, no calendar or e-mail, no production AI, no persistence.
_Fråga JARVIS_ does not yet answer "why is Henrik a priority" (TD-105); the
priority object already carries the deterministic explanation the surfaces
show.

## 7. Verification

`domain/advisory/sentinel.test.ts` (every anchor with its near miss, the
collisions, dedupe, resolution, dispositions, a quiet client),
`application/advisory/sentinel.test.ts` (the brief over the seed, metrics,
snooze/review/dismiss, the dismissal that lapses, silence removed by a call),
`components/sentinel/SentinelQueue.test.tsx` (module, greeting, queue
sections, explanation, snooze, refusal, set-aside), `routes/sentinel.test.tsx`
(door, navigation, dashboard guard). Browser probe: `.probe/sentinel-probe.mjs`.
