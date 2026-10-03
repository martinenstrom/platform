# Meeting Pack Engine V1 — the preparation a strong junior would hand the senior

**Status: implemented 2026-09-30 on the Context Core checkpoint `f24dd55`.
Internal advisor pack only. Synthetic record; deterministic rules; no
model; no external service; versions process-local (TD-119).**

From Client 360 or the Meeting Cockpit — or by telling JARVIS _"Prepare
full pack"_ — the advisor gets, for the client and meeting on screen, an
Executive Brief on screen, an internal PDF briefing book and a fully
editable PowerPoint meeting pack. The quality target is the level of
preparation, not anyone's template: concise, analytical, evidence-backed,
senior-first, meeting-specific.

## 1. One source of truth

```
EXISTING RECORD
  → application services (Client 360, Meeting Cockpit)
    → MeetingPack                      application/advisory/meetingPack.ts
      → PackDocument                   presentation/documents/meetingPackDocument.ts
        → screen                       components/meetingPack/DocumentView.tsx
        → PowerPoint                   infrastructure/documents/pptx.ts (pptxgenjs)
        → PDF                          infrastructure/documents/pdf.ts (pdfmake)
```

The pack derives nothing of its own about the client. Its focus, changes,
promises, strategy, financing, market history, questions, opportunities,
risks, data quality, agenda, objectives and materials are the cockpit's;
its balance sheet, assets, loans, portfolio, goals and events are Client
360's. What it adds is stated: the readiness gate, the executive summary
and the top three (selections over cockpit items), the next steps (open
promises as they stand, objectives and materials marked _proposed_), the
outline (which slides the record justifies), the provenance and a content
fingerprint. The renderers consume the composed document and nothing else,
so two formats cannot disagree.

## 2. The read model

`MeetingPack` carries `identity`, `meeting`, `generatedAt`, `dataAsOf`,
`provenance` (portfolio and oldest valuation dates, market data as-of,
baseline, market window, source count), `readiness`, `outline`,
`meetingFocus`, `executiveSummary`, `topPriorities`, `dontForget`,
`clientSnapshot`, `relationshipHealth`, `relationshipContext`,
`changesSinceLastMeeting`, `wealth`, `portfolio`, `strategy`, `liquidity`,
`financing`, `commitments`, `importantEvents`, `clientConcerns`, `goals`,
`marketContext`, `sentinelContext`, `possibleClientQuestions`,
`advisorQuestions`, `opportunities`, `risks`, `dataQuality`,
`meetingObjectives`, `agenda`, `materialsToPrepare`, `nextSteps`,
`appendix`, `sources`, `titles`, `fingerprint`. Every item keeps the record
ids it rests on; the document never prints an id.

**Readiness** (`pack-readiness-v1`): REDO, GRANSKA or BLOCKERAD from typed
reasons — a stale valuation, an external figure not updated, a portfolio
valued long ago, no portfolio, no pension value, a loan whose figures are
older than 90 days (_räntan verifierades senast …_), no baseline, no booked
meeting. BLOCKERAD only when the record holds no valued assets: a pack
would then misrepresent the client. No score.

**Outline**: executive · glance · since-last (only with changes or a
market move) · wealth · portfolio (with a portfolio) · financing (with a
financing item) · market (with a client-relevant move) · relationship ·
questions · plan · next steps; appendix only where a table has rows. The
executive brief is executive · glance · since-last (conditional) ·
questions (conditional) · plan with the next steps folded in — three to
five slides. A quiet client gets a shorter deck; nothing is padded.

**Fingerprint**: FNV-1a over the pack's JSON with the timestamps that move
without the record moving (`generatedAt`, `assessedAt`) dropped. A
regeneration over an unchanged record returns the version already made.

## 3. The document

`composePackDocument(pack)` produces `PackDocument`: slides with an
archetype, a kicker, a headline, typed blocks (kpis, statement, caption,
list, table with totals, chart, timeline, callout, callouts, meta,
weighted columns, changes, actions) and speaker notes in reading order
(talking point, why it matters, watch-out, do-not-claim, verify,
follow-up, evidence, source). Rules it keeps:

- **One archetype per page.** Executive brief, snapshot, change page,
  balance sheet, portfolio analysis, financing page, market page,
  open-issues page, questions page, plan, action list, data appendix —
  each composed its own way (refinement pass, 2026-10-01; §3a).
- **Headline = conclusion.** _Brygglånet Åre förfaller om 45 dagar;
  finansieringen är mötets huvudpunkt._ on the first slide; _Brygglån, Åre
  förfaller om 45 dagar och kräver ett tydligt nästa steg._ on the
  financing page — never _Finansiering_, never the client's name as a
  title.
- **Placement, not repetition.** The bridge loan is a priority on slide 1
  and a detail on the financing slide; the relationship slide's _Kommande_
  skips events the financing slide already carries; concerns go to the
  relationship slide, not the glance; the financing slide shows a concern
  only when it is about rates.
- **Nothing invented.** A missing figure is omitted or marked DATA SAKNAS;
  a stale one carries its date; no market move gives _Inga väsentliga
  klientrelevanta marknadsförändringar sedan senaste mötet._ on the changes
  slide and no market slide.
- **Formatting is Financial OS's**: `42,0 MSEK`, `750 kSEK`, `49 %`,
  `+2 pp`, `3,60 %`, `45 dagar`, `3 okt 2026`.
- **Charts answer a question**: the wealth composition as a donut on the
  snapshot page, previous against current as paired bars on the change
  page (only when at least two figures moved), the balance sheet as a
  stacked bar, allocation against the mandate as grouped bars with a
  deviation table, liquidity against the debt maturing within twelve
  months as bars, and the maturities and reviews as a timeline from
  today. Each with a title, unit, as-of and source, drawn from the same
  data in every format; bars always read from zero.
- **Tables carry totals**: the financial summary, the balance sheet (sum
  of assets, sum of liabilities, net worth), the loan structure with its
  collateral and sum, the holdings and loans in the appendix; figures
  right-aligned, a rule above every total, never a filled cell.
- **Margin notes, not panels**: JARVIS-observation, Mötesimplikation,
  Varför det spelar roll, Varning, Data att verifiera — at most three per
  page, small, in the body face, each from a cockpit sentence.
- **Notes are internal and in reading order**: TALEPUNKT · VARFÖR DET
  SPELAR ROLL · VARNING · PÅSTÅ INTE · ATT VERIFIERA · FÖLJDFRÅGA ·
  UNDERLAG · KÄLLA — the cockpit's discussion points, what not to claim
  (_Ange ingen ny ränta … förrän aktuell prissättning är verifierad_), the
  readiness warnings as things to verify, the likely follow-up question,
  the sources by name. They go to the PowerPoint notes page and to a
  marked box in the PDF; never to a slide body.
- **File name**: `Anna_Per_Dahlqvist_Motesunderlag_2026-10-02_v1.pptx`
  (executive: `…_Executive_brief_…`); ASCII, no id.

### 3a. The page archetypes

| Archetype       | Slide          | Composition                                                                                                                                       |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executive`     | executive      | identity panel; six key figures; focus statement with the desired outcome beneath it; top three and _Glöm inte_; counters incl. the critical date |
| `snapshot`      | glance         | financial summary table with totals (7:5) composition donut; goals, context, next event; two margin notes                                         |
| `change`        | since-last     | baseline caption; changes table (with paired bars when ≥ 2 figures moved); market since last; implication, why, verify                            |
| `balance-sheet` | wealth         | stacked bar and two figures (5:7) full balance sheet with three totals and its footnote; observation, why, verify                                 |
| `portfolio`     | portfolio      | five figures; allocation bars and margin notes (7:5) largest holdings with a sum and the deviation table                                          |
| `financing`     | financing      | loan structure with collateral and sum; maturity timeline (7:5) liquidity against maturities; implication and the warning or the rate to verify   |
| `market`        | market         | moves table (status per row, the reason once in the margin); why it matters and the discussion points                                             |
| `issues`        | relationship   | open commitments and important dates as tables (7:5) concerns, goals, family; implication, Sentinel observation, why                              |
| `questions`     | questions      | client questions with likelihood and basis (6:6) numbered advisor questions with their why; implication and warning                               |
| `plan`          | plan           | objectives and desired outcome (6:6) agenda table with its basis in the document, materials; opportunity and warning                              |
| `actions`       | next-steps     | action table with status tones; implication and the overdue warning                                                                               |
| `appendix-data` | every appendix | one table with sums or a provenance line; the appendix flows in the PDF                                                                           |

## 4. The formats

**PowerPoint** — one slide master (navy ground, a gold hairline at the
head, a hairline above the footer), a header rule under the headline, a
12-column grid with weighted columns, figure strips separated by
hairlines, tables with a gold rule under the header and a rule above
every total, native charts on the slide's own ground, the timeline drawn
from shapes, margin notes as thin rules with small-caps labels, Georgia
for the headline and the key figures only. The footer carries the
confidentiality, the client, the meeting date, the data date, the
generation time and _Bild n / N_. Heights are estimated per block
(TD-122): a figure strip, table or chart that would not fit is left off
rather than drawn over the footer. No image anywhere: the senior edits
wording, moves boxes, changes a number, deletes a slide. Verified to open
in PowerPoint (COM export of every slide).

**PDF** — A4 briefing book: a cover page that already carries the brief
(title block, advisor and office, provenance line, the executive page's
figures, focus, priorities and counters), one chapter per core slide on
its own page, the appendix flowing as data pages under rules, a running
header with the meeting and the data date, a footer with the generation
time and page numbers, tables with a gold rule under the header and a
rule above every total, the donut and the timeline drawn as vectors,
inline legends, margin notes in tinted columns, the notes box per
chapter. Standard fonts in V1 (TD-118).

Sample renders for review: `scripts/render-meeting-pack.ts` writes the
full pack and the executive brief for Anna & Per and Henrik to a folder
(`npx vite-node scripts/render-meeting-pack.ts -- .probe/meeting-pack/refine 2026-09-23`);
`.probe/pdf-to-png.mjs` renders a PDF's pages to PNG, and PowerPoint's
COM export does the same for a deck.

## 5. The audience policy

`application/advisory/meetingPackPolicy.ts` classifies every content
section `internal` or `shareable` — a new section does not compile until it
is — and `forAudience(pack, 'FUTURE_CLIENT')` returns the shareable sections
only, the internal ones absent rather than blanked. V1 generates
`INTERNAL_ADVISOR` only: the server function fixes the audience, the
generator refuses any other, and each renderer refuses a document that is
not the internal pack. Internal: readiness, focus, executive summary,
priorities, relationship health and context, changes, promises, concerns,
market verdicts, Sentinel, questions, opportunities, risks, data quality,
objectives, materials, next steps, appendix, sources. Shareable: identity,
meeting, provenance, snapshot, wealth, portfolio, strategy, liquidity,
financing, events, goals, agenda.

## 6. Versions and files

`infrastructure/documents/meetingPackStore.ts`: every generation carries
version, generatedAt, sourceAsOf, clientId, meetingId, audience, format,
depth, file name, size, fingerprint and slide counts. Both formats of one
generation share a version; an unchanged record returns the file already
made; a changed record steps the version; an earlier version keeps its
metadata and bytes. Files are written under `.generated/meeting-packs`
(git-ignored) and never overwritten; the counter respects files already on
disk. Process-local (TD-119).

## 7. The doors

- **`/clients/:clientId/meeting-pack?depth=full|executive&format=…`** —
  the Meeting Pack Preview: readiness with reasons, _Granska underlag_,
  _Generera PowerPoint_ / _PDF_ / _båda_ (disabled when blocked; _Generera
  ändå_ noted when reviewing), the contents with counts, the versions with
  downloads, the provenance, and the document on screen with the appendix
  folded.
- **Meeting Cockpit** — _Skapa mötesunderlag_ beside _Öppna Klient 360_.
- **Client 360** — a restrained _Skapa mötesunderlag_ in the JARVIS rail,
  only when a meeting is booked.
- **JARVIS** (client and meeting scope): _Prepare full pack_, _Skapa
  PowerPoint inför mötet_, _Ge mig en femslides executive brief_, _Skapa
  PDF inför mötet på torsdag_, _Uppdatera mötesunderlaget med det som hänt
  sedan sist_ — answered with the readiness and the contents, and the
  preview opened by JARVIS itself (offered, not opened, for a named other
  client). No second chat: the same router, the same answer model.

## 8. Office future

An office-day pack composes individual MeetingPacks; the read model and
the store are keyed by client, meeting and depth so that composition needs
no change here. Not built.

## 9. Verification

`application/advisory/meetingPack.test.ts` (Anna & Per, Henrik, the quiet
client, stale data, no market relevance, no financing, no open promises, no
baseline, blocked), `meetingPackPolicy.test.ts`,
`presentation/documents/meetingPackDocument.test.ts` (outline, one
archetype per core page, conclusion headlines including the first slide,
the first slide's figures, focus, outcome, priorities and critical date,
the chart inventory, the tables with totals, the margin notes, placement,
formatting, no id, notes in reading order and off the body, market
presence, executive depth, file names),
`infrastructure/documents/meetingPackDocuments.test.ts` (the PowerPoint
read back with jszip: slides, titles, tables, one chart part per chart
block, the timeline's labels as text, totals and margin notes as text,
notes in order, the metadata footer, no picture, no id; the PDF read back
with pdfjs: the content cover, the chapters, the running header, the
footer with the generation time, the figures and totals, the notes, no
id; cross-format agreement on headlines, figures, totals and dates;
versions; the policy at the door), `components/meetingPack/
MeetingPackPreview.test.tsx`, the JARVIS intent and answer tests. Browser
probe: `.probe/meeting-pack-probe.mjs` (expects an empty
`.generated/meeting-packs`). Visual review: the sample renders under
`.probe/meeting-pack/refine/` — every slide exported through PowerPoint
and every PDF page rendered to PNG — inspected against the acceptance
test of the refinement brief (conclusion-first titles, chart presence,
serious tables, restrained gold, density, premium feel).
