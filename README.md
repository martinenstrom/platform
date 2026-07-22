# Stack — UI-grund för ett operativsystem för analysagenter

Frontend-grund för ett agentdrivet analysverktyg: agenterna är produktens primära
objekt, med portfölj- och marknadsöversikt som stödvy. **All data är lokal
exempeldata** — ingen backend, ingen Avanza-koppling, inga order eller affärer.

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
  types/           Domäntyper
  lib/             format.ts (sv-SE/SEK), chartTheme.ts, navigation.ts, cn.ts
  styles/app.css   Designtokens (@theme) — färger, radier, skuggor
```

## Nästa steg: integrationer

- **Avanza MCP** — implementera `createAvanzaMcpMarketDataService()` i
  [`src/services/avanzaMcpAdapter.ts`](src/services/avanzaMcpAdapter.ts) och returnera
  den från `getMarketDataService()` i
  [`src/services/marketDataService.ts`](src/services/marketDataService.ts).
  Anropa MCP från en `createServerFn` så att inga uppgifter hamnar i klientbundlen.
- **Analysagenter** — briefer, uppslag och analyskörningar hör inte till Avanza.
  Lägg ett separat `analysisAgentService.ts` med samma gränssnittsmönster.

## Designnoter

- Färgtokens definieras i `src/styles/app.css` under `@theme`.
- Den kategoriska diagrampaletten i `src/lib/chartTheme.ts` är validerad mot den mörka
  diagramytan (ljushetsband, kroma, färgseendeseparation, kontrast). Byt inte enstaka
  värden utan att validera om paletten.
- Grönt, rött och gult är reserverade för status och används aldrig som serieidentitet.

## Ansvarsfriskrivning

Signaler, tillförlitlighetsnivåer och AI-briefer i gränssnittet är simulerade och
utgör inte investeringsrådgivning.
