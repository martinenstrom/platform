# Stack — UI-grund för ett operativsystem för analysagenter

Frontend-grund för ett agentdrivet analysverktyg: agenterna är produktens primära
objekt, med portfölj- och marknadsöversikt som stödvy. **All portfölj- och kunddata
är lokal exempeldata** — ingen kontokoppling, inga order eller affärer.
`searchInstruments`/`getMarketStatus` kan valfritt hämta riktig, publik
marknadsdata från Avanza (se nedan) — utan inloggning och utan åtkomst till något
konto.

## Teknik

TanStack Start · React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 ·
lucide-react · Recharts

## Kom igång

```bash
npm install
npm run dev        # http://localhost:3000
```

| Skript              | Gör                              |
| ------------------- | -------------------------------- |
| `npm run dev`       | Utvecklingsserver                |
| `npm run build`     | Produktionsbygge till `.output/` |
| `npm run start`     | Kör produktionsbygget            |
| `npm run typecheck` | `tsc --noEmit`                   |
| `npm run format`    | Prettier                         |

## Struktur

```
src/
  routes/          Filbaserade rutter (Översikt, Agenter, Portfölj, …)
  components/
    layout/        AppLayout, AppSidebar, AppHeader, PageHeader
    agents/        AgentCard, AgentStatusDot
    ui/            DashboardCard, Stat, StatusBadge, EmptyState, …
    charts/        PerformanceChart, AllocationChart, RiskGauge, Sparkline
    dashboard/     MarketTicker, WatchlistTable, RecentAnalysesTable
  data/            mockData.ts — all exempeldata på ett ställe
  services/        marketDataService.ts + avanzaMcpAdapter.ts (integrationspunkt)
    avanzaMcp/     Node-transport, mappers och createServerFn-wrappers för avanza-mcp
    investmentLetter/  11-agents pipeline för Private Banking-veckobrevet
  types/           Domäntyper
  lib/             format.ts (sv-SE/SEK), chartTheme.ts, navigation.ts, cn.ts
  styles/app.css   Designtokens (@theme) — färger, radier, skuggor
```

## Avanza-integration (real, delvis)

[`src/services/avanzaMcpAdapter.ts`](src/services/avanzaMcpAdapter.ts) kopplar
`searchInstruments` och `getMarketStatus` till Avanzas riktiga, publika
marknadsdata via [`avanza-mcp`](https://pypi.org/project/avanza-mcp/) (körs med
`uvx`). Paketet kräver ingen inloggning och har inga konto-/order-verktyg — bara
sök, kurser, grafer och nyckeltal. Övriga metoder (innehav, portfölj, bevakning,
AI-brief, m.m.) har ingen motsvarande endpoint och fortsätter använda
exempeldata; se kommentarerna i
[`avanzaMcpAdapter.ts`](src/services/avanzaMcpAdapter.ts) för exakt vilka och
varför.

Avstängt som standard. Slå på genom att sätta i en lokal, git-ignorerad `.env`:

```
AVANZA_MCP_ENABLED=true
# Endast om `uvx` inte redan ligger på PATH:
AVANZA_MCP_UVX_PATH=/absolut/sökväg/till/uvx
```

Node-transporten (`src/services/avanzaMcp/client.ts`) spawnar `uv`s `uvx` som en
subprocess och pratar MCP över stdio via `@modelcontextprotocol/sdk` — den
importeras enbart dynamiskt inifrån en `createServerFn`-handler
([`src/services/avanzaMcp/serverFns.ts`](src/services/avanzaMcp/serverFns.ts))
så den aldrig hamnar i klientbundlen (verifierat: `npm run build` och sök i
`dist/client/` efter `modelcontextprotocol`/`child_process` ger inga träffar).
Kräver att värden som kör `npm start` har `uv` installerat.

## Nästa steg: integrationer

- **Avanza MCP** — resten av `MarketDataService` (innehav, portfölj, bevakning,
  screener, AI-brief) kräver kontoåtkomst som `avanza-mcp` inte exponerar; en
  riktig implementation behöver en annan, autentiserad datakälla.
- **Analysagenter** — [`src/services/analysisAgentService.ts`](src/services/analysisAgentService.ts)
  ger en 11-agents pipeline (News → Flow → Macro → Equity → Valuation →
  Portfolio → Quant → Devil's Advocate → CIO → Editorial → Compliance) som
  producerar ett veckobrev för Private Banking-kunder. Se
  [`src/services/investmentLetter/`](src/services/investmentLetter/) för
  agenterna, pipelinen, publiceringschecklistan och typerna i
  [`src/types/investmentLetter.ts`](src/types/investmentLetter.ts). Idag
  returnerar varje agent en fast exempel-fixture — riktig LLM- och
  datakoppling (se `investmentLetter/dataAdapters.ts`) återstår, agent för
  agent, på samma sätt som Avanza-adaptern ovan.

## Designnoter

- Färgtokens definieras i `src/styles/app.css` under `@theme`.
- Den kategoriska diagrampaletten i `src/lib/chartTheme.ts` är validerad mot den mörka
  diagramytan (ljushetsband, kroma, färgseendeseparation, kontrast). Byt inte enstaka
  värden utan att validera om paletten.
- Grönt, rött och gult är reserverade för status och används aldrig som serieidentitet.

## Ansvarsfriskrivning

Signaler, tillförlitlighetsnivåer och AI-briefer i gränssnittet är simulerade och
utgör inte investeringsrådgivning.
