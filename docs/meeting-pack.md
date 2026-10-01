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

`composePackDocument(pack)` produces `PackDocument`: slides with a kicker,
a headline, typed blocks (kpis, statement, caption, list, table, chart,
callout, columns, changes, actions) and speaker notes (talking point,
watch-out, do-not-claim, follow-up, evidence, source). Rules it keeps:

- **Headline = conclusion.** _Brygglånet, Åre förfaller om 45 dagar och
  kräver ett tydligt nästa steg._ — never _Finansiering_.
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
- **Charts answer a question**: balance sheet as a stacked bar, allocation
  against the mandate as grouped bars; each with a title, unit, as-of and
  source, drawn from the same data in every format.
- **Notes are internal**: the cockpit's discussion points, what not to
  claim (_Ange ingen ny ränta … förrän aktuell prissättning är
  verifierad_), the readiness warnings, why to ask each question, the
  sources by name. They go to the PowerPoint notes page and to a marked
  box in the PDF; never to a slide body.
- **File name**: `Anna_Per_Dahlqvist_Motesunderlag_2026-10-02_v1.pptx`
  (executive: `…_Executive_brief_…`); ASCII, no id.

## 4. The formats

**PowerPoint** — one slide master (navy, gold hairline, footer rule),
native text boxes, shapes, tables and charts from data, `addNotes` per
slide, the footer _KONFIDENTIELLT · INTERNT RÅDGIVARMATERIAL · client ·
Data per … · Bild n / N_. No image anywhere: the senior edits wording,
moves boxes, changes a number, deletes a slide. Georgia and Calibri by
name. Verified to open in PowerPoint (COM export of every slide).

**PDF** — A4 briefing book: cover block, one section per slide, running
header, footer with page numbers, tables that break, charts as vector bars,
the notes box. Standard fonts in V1 (TD-118).

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
`presentation/documents/meetingPackDocument.test.ts` (outline, headlines,
placement, formatting, no id, notes, charts, market presence, executive
depth, file names), `infrastructure/documents/meetingPackDocuments.test.ts`
(the PowerPoint read back with jszip: slides, titles, tables, charts,
notes, no picture, footer, no id; the PDF read back with pdfjs: pages,
titles, figures, footer, page numbers, no id; cross-format agreement;
versions; the policy at the door), `components/meetingPack/
MeetingPackPreview.test.tsx`, the JARVIS intent and answer tests. Browser
probe: `.probe/meeting-pack-probe.mjs`.
