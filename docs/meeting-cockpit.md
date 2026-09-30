# Meeting Cockpit 2.0 — what do I need to know for THIS meeting?

**Status: implemented 2026-09-29 on top of the Market-to-Client checkpoint
`3791a11`. Synthetic clients only; deterministic rules; no production
persistence; no LLM. Strategy Guardian not started.**

Client 360 answers _what do we know about this client?_ The Meeting Cockpit
answers _what do I need for this meeting?_ — everything filtered through
meeting relevance, assembled from what Client Intelligence, Sentinel and
Market-to-Client already hold, and handed to the surface as one typed read
model. It should feel like an internal PB team prepared the meeting: one
focus, a thirty-second brief, what changed since the last meeting, what was
promised, what matters to the client, the strategy, the financing, the
client-relevant market history, why Sentinel prioritises the client, the
questions the client may ask, the questions to ask, the openings, the
safety check, the data to verify, an editable agenda, the objectives and
the materials.

## 1. Where it lives

```
domain/advisory/meetingSnapshot.ts   MeetingSnapshot, snapshotOf; MEETING_CHANGE_THRESHOLDS;
                                     MeetingChange, changesSince, fewChanges
domain/advisory/meetingCockpit.ts    COCKPIT_THRESHOLDS; the typed sections and every rule:
                                     meetingCockpitCore(input) → MeetingCockpitCore
application/advisory/meetingCockpit.ts
                                     meetingCockpit(context, clientId) → MeetingCockpit (the read
                                     model); askBeforeMeeting; captureMeetingSnapshot
application/advisory/ports.ts        MeetingSnapshotRepository (repositories.meetingSnapshots)
application/advisory/confirmClientUpdate.ts
                                     captures the baseline when the confirmed interaction is a meeting
infrastructure/advisory              seeded baselines for the five clients with a recorded meeting;
                                     getMeetingCockpitFn, askBeforeMeetingFn
presentation/advisory/meetingCockpitText.ts
                                     every sentence, in Swedish, once, from the typed items
components/meeting                   MeetingCockpit (hero, main, rail), AgendaEditor,
                                     AskJarvisMeeting, SourcesNote
routes/clients.$clientId_.meeting-prep.tsx   /clients/:clientId/meeting-prep
```

_Förbered möte_ on Client 360 opens the cockpit. The in-page briefing panel
of Phase 1 is retired; `prepareMeeting` remains as an application use case
for the market-history contract and its tests.

## 2. Snapshot architecture

Comparing "since the last meeting" against today's reconstructed state would
invent history. The cockpit compares against a **typed meeting baseline**:

```
MeetingSnapshot
  id = snap-${meetingInteractionId} · clientId · meetingInteractionId · meetingDate · capturedAt
  financial     totalAssets, totalLiabilities, netWorth, assetsWithBank, liquidity
  portfolio     valuedAt, totalValue, performanceYtdPercent   (null without a managed portfolio)
  allocation    per asset class: currentPercent, strategicPercent
  loans         id, outstandingBalance, interestType, ratePercent, maturityDate
  goals         id, status, progressPercent
  relationship  healthScore, healthBand
  openCommitmentIds · importantEventIds (upcoming) · activeConcernIds
  method 'meeting-snapshot-v1'
```

`snapshotOf(facts, meetingInteractionId, meetingDate, capturedAt)` builds it
from structured domain data, never from UI state. **Capture:** when
`confirmClientUpdate` confirms an interaction of type `meeting`, the
baseline is captured from the record as it stands after the meeting's own
promises, facts and events were confirmed — so a promise made at the meeting
is in the baseline, not "created since". A confirmed call leaves the
baseline alone. **Read:** `repositories.meetingSnapshots.latestFor(clientId)`
by meeting date. **Seed:** deterministic, explicitly authored baselines for
Alvarsson, Berglund, Dahlqvist, Ekstrand and Forsell at their last recorded
meeting; none for Ceder and Grahn, who have no recorded meeting.

Without a baseline the comparison uses only what the record itself dates
since the last recorded meeting (or a 30-day window without one) and names
the gap: _Ingen baslinje från ett tidigare möte finns_ / _Ingen historisk
allokering finns i baslinjen_. The snapshots live in the synthetic record
per process like everything else (TD-111).

## 3. Change significance

`MEETING_CHANGE_THRESHOLDS`, stated once: allocation ≥ 2 pp; portfolio value
≥ 1 %; liquidity ≥ 10 % **and** ≥ 250 kSEK; total assets ≥ 2 %; loan balance
≥ 5 %; health ≥ 5 points; goal progress ≥ 5 points or any status change; a
financing event that came within 60 days since the baseline; any new or
closed loan; promises created, completed or overdue; new upcoming events;
new concerns and new context facts; contacts since. Categories: portfolio,
liquidity, wealth, financing, goals, relationship, commitments, events,
context — market context comes from Market-to-Client beside them. A client
with nothing across a threshold gets _Få väsentliga förändringar sedan
senaste mötet._

## 4. Sections and the deterministic rules behind them

Every item carries the ids it rests on; _Varför visas detta?_ names them.

- **Mötets huvudfokus** — one sentence. Topics are weighted: relationship
  at-risk 85, refinancing or loan maturity within 90 days 80, liquidity
  event within 120 days 75, concern the market has moved in 75, equity
  drift ≥ 5 pp 70, concern 65, excess liquidity 60, goal at risk 55, next
  generation 50, overdue promise 45, follow-up 10. Primary = the top topic;
  supporting = the next two at weight ≥ 40. The sentence is composed
  ("Gå igenom X och Y och förbered Z"); the fact lines beneath quote the
  numbers.
- **Klienten på 30 sekunder** — segment, relationship since, total wealth,
  AUM, risk profile, primary goal, newest concern, channel, health.
- **Sedan senaste mötet** — the changes above, grouped, with the market
  headlines beside them.
- **Du lovade** — overdue · before the meeting (or within 14 days when
  unscheduled) · later · _Klart sedan sist_.
- **Detta är viktigt för klienten** — confirmed context only: concerns,
  objectives, behaviour, preferences; business only with a company asset,
  family only with a family goal or next-generation opening; at most 7.
- **Strategin** — allocation rows with deviations, meaningful at ≥ 5 pp;
  liquidity and its share; risk profile; goals behind plan; each
  observation as _Observation / Varför det spelar roll / Diskussionspunkt_,
  never a transaction.
- **Finansiering** — financing events within 180 days, loans maturing
  within 180 days, variable debt ≥ 2 MSEK; the last financing discussion
  (60-day rule) and one possible question per case; no fixed-vs-floating
  recommendation.
- **Marknad sedan senaste mötet** — `marketChangesSince` over the window:
  the move at peak, financial and conversation relevance, why, one
  discussion point by category, the status, and the honest basis line:
  _relevant för klientens nuvarande registrerade exponering — inte ett
  påstående om exponeringen vid just det tillfället_, with the baseline
  allocation quoted only when the move opened after the snapshot.
- **Varför klienten är prioriterad** — the client's one Sentinel priority,
  in the queue's own words: title, why now, drivers, preparation.
- **Klienten kan fråga** — _Möjlig fråga_, never a prediction: fee
  (fee-sensitive fact or health driver), energy holding (energy concern +
  energy move or holding), mortgage (financing within 120 days), reduce
  risk (drawdown context + equity down or drift), cash (excess liquidity),
  proceeds (liquidity event within 240 days), performance (value down or
  equity move down), pension, gifts. Confidence _sannolik_ with two sources,
  _möjlig_ with one. At most 5, each with its triggers.
- **Frågor att ställa** — liquidity intention, retirement timeline,
  refinancing view, the nature of the concern (reaction or role), external
  assets ≥ 1 MSEK, proceeds plan, next generation, goal priority, risk
  intention, valuation update; the generic question only when nothing else
  applies. At most 5, each with _Varför ställa frågan?_
- **Möjligheter att utforska** — client-first wording: external assets,
  excess liquidity, proceeds, financing, pension, family wealth, next
  generation; each with why, evidence and a possible question.
- **Glöm inte** — overdue promise, complaint within 180 days, fee
  sensitivity, family date within 30 days, stale valuation, missing data;
  at most 3.
- **Data att verifiera** — company or external valuation ≥ 180 days old,
  client-stated figure ≥ 90 days old, no pension value, portfolio valued
  ≥ 30 days ago, no portfolio.
- **Förslag på agenda** — follow-up · strategy (drift) · concern/market ·
  financing · liquidity · proceeds · promises · openings · next steps;
  reorder, remove, add — process-local.
- **Mål med mötet** — confirm risk, clarify liquidity, agree the financing
  step, close the promise, address the concern, plan the proceeds, confirm
  the goal; at most 4.
- **Förbered material** — portfolio comparison, mortgage alternatives, cash
  deployment illustration, pension overview, valuation request, fee
  overview, financing proposal, family structure outline; a checklist, no
  document generation.

## 5. Ask JARVIS before the meeting

`askBeforeMeeting` reads the question deterministically: promises, changes,
market, agenda are answered from the cockpit's own typed sections; what the
client said goes to the relationship memory (`searchClientMemory`). The
method is named on every answer.

## 6. Closing the meeting

_Registrera mötesanteckning_ opens the existing client update flow inside
the cockpit. On confirmation the timeline, promises, events and context
update through the existing architecture, the baseline is captured when the
note was a meeting, and the page re-reads itself — the next preparation
compares against what was just recorded.

## 7. Limitations

- Baselines and every other record are per process (TD-111).
- Closed market events are judged against today's recorded exposure; the
  cockpit says so and quotes the baseline allocation only where a snapshot
  supports it.
- Rules, not a model: the focus sentence, the questions and the agenda are
  composed from typed items. The read model is the seam for an AI
  summarisation layer later (TD-112).
- No calendar, e-mail, recording, document generation or recommendation of
  products.

## 8. Verification

`domain/advisory/meetingSnapshot.test.ts`, `application/advisory/meetingCockpit.test.ts`
(five seed scenarios, market history with an expired move, the questions,
meeting A → baseline → meeting B), `components/meeting/MeetingCockpit.test.tsx`
(first viewport, changes and promises, agenda editing, the meeting-scoped
question, the handoff, the quiet client, the client without a baseline).
Browser probe: `.probe/cockpit-probe.mjs`.
