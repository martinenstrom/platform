# JARVIS HQ — measurement of the existing HQ before any visual change

**Status: measured, no visual change made, awaiting ruling.** Written against
`2e00792` on 2026-09-13, under the Master Product Ruling (JARVIS HQ + Financial
OS) §30. Every statement below is **read** from the repository or **measured**
by a probe; where a claim is reasoned rather than measured it says so.

The question this answers: where, in the HQ that exists, can a restrained JARVIS
presence with voice mount cleanly — without a rewrite, without a parallel
shell, and without touching Financial OS institutional logic.

---

## 1. The landing/HQ component hierarchy — read

```
routes/__root.tsx            RootComponent
  RootDocument               <html lang="sv"> … <body>{children}<Scripts/>
  pathname === '/markets' ? <Outlet/> : <AppLayout><Outlet/></AppLayout>   (:46-57)
    layout/AppLayout.tsx     ownsItsShell = pathname === '/'          → no AppTopBar, p-0   (:33)
                             railCarriesNavigation = '/headquarters'  → no AppTopBar        (:42)
                             otherwise <AppTopBar/> (sticky, z-30) + <main p-2>
      routes/index.tsx       HomePage → <LightCommandCenter snapshot={OverviewSnapshot}/>   (:40-43)
        lightDashboard/LightCommandCenter.tsx                                             (:431)
          hero photograph layer         absolute, left 46vw, z-0                         (:640-657)
          Sidebar                       own NAV_ITEMS (8), z-10, hidden below md         (:193-267)
          <main z-10>
            Header                      greeting, clock, Sök/Notiser buttons             (:281-351)
            grid xl:12  Marknadsöversikt (5) | GLOBE cell (4) | right column (3)        (:665-844)
            grid xl:12  Utveckling idag (5) | Räntemarknaden (3) | Sektorer (2) | Nytt (2)
            Bevakning row
            sticky bottom ticker rail   z-20                                             (:1086)
          Country-analysis modal        fixed inset-0, z-50, Escape on window            (:448-455, :1139)
```

Two facts about the root worth stating plainly:

- The `/markets` full-bleed branch in `RootComponent` is **unreachable**:
  `routes/markets.tsx:21-25` redirects to `/` in `beforeLoad`. The conditional
  is vestigial.
- `AppLayout` already makes two routes "own their shell" (`/` and
  `/headquarters`). `index.test.tsx:118-141` pins that neither renders a
  `navigation` landmark named _Huvudnavigation_.

## 2. Where the globe is rendered and owned — read

`LightCommandCenter.tsx:701-751`: one grid cell, `xl:col-span-4 min-h-[440px]`,
with a radial glow, the holographic platform rings, and the caption _Dra för
att rotera · klicka på ett land för analys_. The globe itself:

- `LightGlobe` is lazy-imported (`:41-43`) because `react-globe.gl` touches
  `window` at import time; it renders only after `mounted` (`:712-719`).
- Contract: `{ onSelectCountry, reducedMotion }` (`LightGlobe.tsx:600-605`).
  It measures its own wrapper (`wrapperRef`, `size` state) and owns the WebGL
  scene. Country selection is `LightCommandCenter`'s state: `selectCountry` →
  `countryExplorerService.getCountryAnalysis` → the z-50 modal.
- The globe is pointer-interactive. Anything overlapping its cell steals drag.

**What this means for "the globe remains visually dominant":** today the
globe is a 4/12-column centrepiece at `xl` and a stacked block below ~1280px —
one panel among nine on a market dashboard, not a globe-dominant command
centre. Making it dominant is a layout decision for the next gate; it is not
what exists. The globe and network layer are locked (feature-complete) and are
not touched by any of the mounting options below.

## 3. Current navigation — read

There are **three** navigation systems and two dead ones.

| Where                                                         | Entries                                                                                                                                          | Shown on                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `lib/navigation.ts` `primaryNav`                              | Kommandocentral `/`, Huvudkontor `/headquarters`, Underlag `/evidence`                                                                           | every route except `/`, `/headquarters` (via `AppTopBar`)                                  |
| `LightCommandCenter` `Sidebar` `NAV_ITEMS` (:193-202)         | Kommandocentral, Bevakning, Huvudkontor, Underlag, **Portfölj, Rapporter** (mock-backed), **Aviseringar → /settings, Inställningar → /settings** | `/` only                                                                                   |
| `CommandCenter` `DoorsBand` _Institutionella ytor_ (:612-639) | Underlag, Ärenden (`#arenden`), Kommandocentral, Inställningar                                                                                   | `/headquarters` only                                                                       |
| `layout/AppSidebar.tsx`, `layout/AppHeader.tsx`               | —                                                                                                                                                | **mounted nowhere** (only cited in `importGraph.test.ts:492` and `CountrySearch.test.tsx`) |

The landing rail contradicts `navigation.ts`'s own doctrine (which removed
Portfölj/Rapporter as fabricated and Bevakning as a drill-down) and lists
`/settings` twice. It is pinned by
`LightCommandCenter.semantic.test.tsx:473` ("keeps the existing entries and
their order"), so changing it is a deliberate act with a test change, not a
tidy-up.

Routes (15, of which 3 redirect): `/`, `/markets`→`/`, `/watchlist`,
`/portfolio`, `/reports`, `/settings`, `/headquarters`, `/cases`→`/headquarters`,
`/cases/$caseId` (Boardroom), `/cases/$caseId/underlag`, `/agents`→`/headquarters`,
`/agents/$departmentId`, `/agents/$departmentId/commission`, `/runs/$runId`,
`/evidence`.

## 4. Which Financial OS destinations can become contextual — read

| Destination                                             | What it is today                                                                    | Under the ruling                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/headquarters`                                         | the floor (`CommandCenter`), the **ConveneCommittee form**, the case queue          | operator/admin surface; the _ask_ moves to JARVIS; the queue becomes "what is in flight" |
| `/cases/$caseId` (Boardroom)                            | `DebateFloor` — room, in-room debate, Chairman console, desk transcripts, CIO panel | **contextual deep dive** — "Visa hur ni kom fram till det"                               |
| `/cases/$caseId/underlag`                               | `CaseRecord` — the complete defensible record                                       | **contextual** — "Visa underlaget"                                                       |
| `/evidence`                                             | the evidence desk across cases (holdings, assembly)                                 | professional/admin                                                                       |
| `/agents/$departmentId`, `…/commission`, `/runs/$runId` | desk workspace, manual commissioning, run review                                    | operator/dev tooling, deep links                                                         |
| `/watchlist`                                            | market drill-down                                                                   | unchanged; JARVIS-neutral                                                                |
| `/portfolio`, `/reports`                                | `FROZEN_MOCK_CONSUMERS` (`importGraph.test.ts:495-500`)                             | already out of `primaryNav`; still in the landing rail                                   |

**Measured property that makes the contextual option real:** `DebateFloor`
and `CaseRecord` are prop-driven and import nothing from
`@tanstack/react-router` (the router-importing components are listed by grep;
no `boardroom/*` or `headquarters/*` file is among them). Both are fed by one
server function, `getCaseOverviewFn`. They can render inside a JARVIS-opened
surface over HQ exactly as they render on their routes. Their only route
coupling is raw anchors (§9).

## 5. Clean mounting point for a persistent JARVIS presence — measured

**`routes/__root.tsx` `RootComponent`, as a sibling of the shell conditional.**

Probe (a throwaway test mirroring `index.test.tsx`'s router harness, run once
and deleted): a component rendered beside
`{fullBleed ? <Outlet/> : <AppLayout><Outlet/></AppLayout>}` kept its
`useRef` identity and its `useState` value across `/` → `/evidence` →
`/cases/c1` → `/`, with exactly one mount effect. `AppLayout` rendered the
_Huvudnavigation_ landmark on `/evidence` and not on `/`, as the shell test
requires. Result: 1 file, 1 test, passed.

What the mount must respect, all read:

- **Stacking.** Sticky ticker rail z-20 (`/`), `AppTopBar` z-30 (shell
  routes), country-analysis modal z-50 (`/`). A presence above 30 and a ruling
  on whether it sits above or yields to the z-50 modal.
- **The globe cell.** At `xl` the right 3/12 columns hold _Aktuella marknader_
  and _Cross-Asset Risk Appetite_; the globe is columns 6–9. A right-edge
  presence at rest overlaps that column's margin only; expanded, it covers the
  right column and the globe stays visible. It must never overlap the globe
  cell (pointer drag).
- **Escape.** `LightCommandCenter:448-455` closes the country modal on a
  window `keydown` listener. A presence with Escape semantics collides unless
  it scopes its own.
- **SSR.** Client-only APIs behind a `mounted` flag, as the globe already does.
- **Goldens.** `LightCommandCenter.golden.test.tsx:186` pins the landing
  markup. A root mount leaves it untouched; a mount _inside_
  `LightCommandCenter` moves the golden and every semantic test that counts
  links.
- **No second navigation.** `index.test.tsx:118-133`: the presence must not
  render a `navigation` landmark named _Huvudnavigation_ on `/` or
  `/headquarters`.

## 6. Clean mounting point for microphone / listening / speaking UI — read

The same presence component owns the microphone; there is no existing
affordance to inherit. The candidates that look like one are placeholders:

- `LightCommandCenter.tsx:334-347` — _Sök_ and _Notiser_ buttons, no `onClick`.
- `AppTopBar.tsx:84-94` — `RailButton` (_Sök_, _Aviseringar_, _Meddelanden_),
  no `onClick`.
- `AppHeader.tsx:34-37` — _Ny analys_ button; the file is not mounted.

Voice is client-only (`mounted` gating, §5). No dependency exists for
recognition or synthesis (§8). Note for the design gate, not measured here:
the browser `SpeechRecognition` API is Chromium-only, so portable listening
needs a server-side transcription provider; `speechSynthesis` is broadly
available but voice quality is the browser's.

## 7. Conversation / chat primitives — read

**None for a user conversation.** What exists, and what it is:

- `headquarters/ConveneCommittee.tsx` — the nearest "ask the firm": a form
  with _Fråga_, _Ämne_, _Agerar som_, minting `requestId` once per submission
  (`:73`), calling `startInvestmentCaseFn`, and on `convened` hard-navigating
  `window.location.href = /cases/{id}` (`:89`). Its three outcomes
  (convened / convening-incomplete / refused) are the same union the port
  returns.
- `boardroom/InRoomDebate`, `DeskTranscript`, `ChairmanConsole` — render
  **persisted institutional acts by durable id**; `DebateFloor.tsx:23-28`
  forbids synthetic dialogue and typing indicators. They are the institution's
  transcript and must not be repurposed as JARVIS's conversation.
- `agents/ActingAs.tsx` — the only client-side store in the product:
  `sessionStorage` + `useSyncExternalStore`, survives reload, dies with the
  tab, cross-tab `storage` sync. It is the proven pattern for per-tab
  conversation continuity.

## 8. Voice plumbing — read

None. A grep for `SpeechRecognition | getUserMedia | MediaRecorder |
speechSynthesis | AudioContext | whisper | elevenlabs | text-to-speech |
speech-to-text` across `src` returns no code — only the word _whisper_ in
prose (`app.css`, `LightGlobe.tsx:84`). `package.json` carries no audio or
speech dependency. `docs/` has no voice design beyond the integration gate's
mention of "HUD / voice".

## 9. Keeping JARVIS state alive while contextual surfaces open — measured

The root mount survives router navigation (§5). What it does **not** survive
is a full document load, and the product performs seven of them:

| Site                                   | Mechanism                               |
| -------------------------------------- | --------------------------------------- |
| `ConveneCommittee.tsx:89`              | `window.location.href` after convene    |
| `ConveneCommittee.tsx:155`             | raw `<a href>` to the case              |
| `routes/cases.$caseId.tsx:108`         | `window.location.reload()` after resume |
| `boardroom/ChairmanConsole.tsx:110`    | raw `<a href>` to Underlag              |
| `boardroom/CioDecisionPanel.tsx:106`   | raw `<a href>` to Underlag              |
| `boardroom/DebateFloor.tsx:83`         | raw `<a href>` to Underlag              |
| `routes/cases.$caseId.underlag.tsx:98` | raw `<a href>` back to the room         |

(`CommandCenter.tsx:678` is an in-page `#arenden` anchor — harmless.)

Exactly one place refreshes correctly: `agents/JudgementPanel.tsx:45,72` uses
`router.invalidate()`. Two consequences, both UX-layer:

1. The JARVIS conversation must be **reload-resilient** (the `ActingAs`
   pattern: `sessionStorage`, restored on mount) regardless of anything else.
2. The seven hard navigations become router `Link` / `navigate` +
   `invalidate`. None of them touches a command, a read model or a domain
   rule.

## 10. Opening Boardroom / Underlag and returning — read

Entrances today: Boardroom from `headquarters.tsx:257` (`Link`),
`CommandCenter.tsx:362,791` (`Link`), `RunRow.tsx:92` (`Link`),
`ConveneCommittee` (hard). Underlag only from the three raw anchors in §9.
Return from Underlag: the raw anchor _← Tillbaka till styrelserummet_.

Two viable shapes, both without institutional change:

- **Route navigation.** JARVIS stays mounted (measured). The Boardroom then
  renders under `AppLayout` **with** `AppTopBar`, because `/cases/…` is
  neither `/` nor `/headquarters` (`AppLayout.tsx:33-46`) — the user leaves
  HQ visually. Returning is `navigate({ to: '/' })` and the conversation is
  intact.
- **Contextual surface over HQ.** `DebateFloor` / `CaseRecord` rendered in a
  JARVIS-opened layer, fed by `getCaseOverviewFn` — legal because they are
  prop-driven and router-free (§4). The globe stays visible. This is closer to
  the ruling's "Boardroom appears only when the user asks for depth", and it
  costs one stacking decision (§5) and converting the raw anchors into
  callbacks.

## 11. What can be simplified without touching Financial OS logic — read

1. Delete the unmounted shells `AppSidebar.tsx` and `AppHeader.tsx`
   (update the `importGraph.test.ts:492` note and the `CountrySearch.test.tsx`
   import).
2. Remove the unreachable `/markets` full-bleed branch in `__root.tsx`.
3. Reconcile the landing rail with `primaryNav` doctrine (drop mock-backed
   Portfölj/Rapporter and the duplicate `/settings`), updating
   `semantic.test.tsx:473`.
4. Convert the seven hard navigations (§9) to router navigation.
5. Wire or remove the six placeholder buttons (§6).
6. The greeting _God morgon, Anders_ (`LightCommandCenter:309`) and the
   profile _AS · Anders · Private Banking_ (`:255-262`) are string literals.
   Under the ruling the person is JARVIS's Relationship Model / the resolved
   operator — today HQ addresses a hardcoded name.
7. Once JARVIS carries the _ask_, `ConveneCommittee` leaves `/headquarters`'s
   top position and stays as operator tooling.

None of these touches `domain/`, `application/`, a command, a read model, a
mandate or a migration.

## 12. One finding outside the eleven questions — read

The browser has **no way to reach the port**. `serverFns.ts` exposes sixteen
server functions (`getCaseOverviewFn`, `getCaseListFn`, `getCommandCenterFn`,
`getAgentDirectoryFn`, `getAgentDeskFn`, `getRunReviewFn`,
`getOperatorIdentitiesFn`, `getCommissionBriefFn`, `commissionAnalysisFn`,
`acceptContributionFn`, `rejectContributionFn`, `getEvidenceDeskFn`,
`assembleEvidenceSetFn`, `startInvestmentCaseFn`, `resumeConveningFn`,
`getCurrentOperatorFn`). None of them is `FinancialOsSystem`; the port is
in-process only, and `startInvestmentCaseFn` records the person as their own
initiator. A browser-side JARVIS presence therefore needs **one** server
function in front of the port — and the ruling's high-level contract
(_ask / advance / status / result / inspect / resume_) does not exist yet:
_advance_ is precisely the "what may a host commission autonomously versus
under a decision gate" ruling the integration gate is waiting for.

---

## What this measurement recommends, for ruling

1. **Mount JARVIS in `__root.tsx`** beside the shell conditional (measured to
   survive navigation), right edge, above z-30, with `sessionStorage`-backed
   continuity. No change to `LightCommandCenter`, its goldens, or the globe.
2. **Open Boardroom and Underlag as a contextual layer over HQ** using the
   existing prop-driven `DebateFloor` / `CaseRecord`, keeping their routes as
   deep links.
3. **Take the seven simplifications in §11 as the first, UI-only slice**
   (removes dead shells, hard reloads and placeholders) before any JARVIS
   surface is drawn — it is the ground the presence stands on.
4. **Rule on the host contract** (_ask / advance / status / result / inspect /
   resume_) so one server function can front the port; until then the
   presence can only _ask_, _status_ and _inspect_.
5. **Decide the globe's dominance** explicitly: today's HQ is a market
   dashboard with a globe centrepiece. The ruling's "globe / command-centre
   environment remains visually dominant" is a layout change to `/`, and it
   moves the golden.
