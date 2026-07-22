/**
 * Roster metadata for the 11-agent weekly letter pipeline. Condensed from the
 * institutional spec's role descriptions — the full prompts live as JSDoc on
 * each agent module in `./agents/`. This is the single source of truth for
 * "who exists and in what order", used by the pipeline and by any future UI
 * that wants to list the team (mirroring how `~/data/mockData`'s `agents`
 * array backs the existing Agents page).
 */

import type { InvestmentLetterAgentDefinition } from '~/types/investmentLetter'

export const INVESTMENT_LETTER_AGENTS: InvestmentLetterAgentDefinition[] = [
  {
    id: 'news-intelligence',
    name: 'News Intelligence Analyst',
    stage: 1,
    roleSummary:
      'Samlar in, filtrerar och sammanfattar veckans viktigaste nyheter. Drar inga slutgiltiga investeringsslutsatser — identifierar vad som faktiskt är viktigt.',
    watches: [
      "Bloomberg/Reuters/FT/WSJ/CNBC/MarketWatch/Barron's/The Economist",
      'Centralbanker (Fed, ECB, Riksbanken, BoE, BIS, IMF, OECD, World Bank)',
      'Makrostatistik, bolagsrapporter, vinstvarningar, geopolitik, reglering',
    ],
    outputSummary:
      'Topp 10 globala nyheter + topp 5 per region (Sverige, Europa, USA, EM), med källa och signal/brus-bedömning per nyhet.',
  },
  {
    id: 'flow-intelligence',
    name: 'Flow Intelligence Analyst',
    stage: 2,
    roleSummary:
      'Analyserar flöden, positionering och marknadens beteende. Förstår vad kapitalet faktiskt gör, inte bara vad nyheterna säger.',
    watches: [
      'ETF-/fondflöden, optionsflöden, gamma exposure, dark pools',
      'Insiderköp/-försäljningar, 13F/EDGAR, hedgefond- och CTA-positionering',
      'Kreditspreadar, VIX, MOVE, Fear & Greed, put/call-ratio',
    ],
    outputSummary:
      'Var kapital flödar in/ut, risk-regim (risk-on/neutral/risk-off), insideraktivitet och om flödena bekräftar eller motsäger prisrörelserna.',
  },
  {
    id: 'global-macro',
    name: 'Global Macro Strategist',
    stage: 3,
    roleSummary:
      'Analyserar den globala makrobilden: konjunktur, inflation, räntor, centralbanker, valutor och likviditet.',
    watches: [
      'Sverige, Norden, Europa, USA, Japan, Kina, Indien, Brasilien, övriga EM',
      'Inflation, PMI/ISM, BNP, arbetsmarknad, centralbanksbeslut, yield curve',
      'Realräntor, kreditspreadar, likviditet, USD/EUR/JPY/CNY/SEK',
    ],
    outputSummary:
      'Global och regional makrobedömning, ränte- och valutasyn, samt risker på 1/3/12 månaders sikt.',
  },
  {
    id: 'equity-strategist',
    name: 'Equity Strategist',
    stage: 4,
    roleSummary:
      'Förklarar vad som driver aktier, sektorer, regioner, vinstförväntningar och värderingar.',
    watches: [
      'USA, Europa, Sverige, Japan, Kina, Indien, tillväxtmarknader',
      'Large/small cap, growth/value/quality/momentum, sektorrotation',
      'Vinstrevideringar, marginaler, guidning, P/E, EV/EBIT, utdelningar, buybacks',
    ],
    outputSummary:
      'Veckans viktigaste aktierörelser, vinnande/förlorande sektorer, huvuddrivkraft (vinster/räntor/multipel) och en syn på om marknaden är dyr, rimlig eller billig.',
  },
  {
    id: 'valuation-specialist',
    name: 'Valuation Specialist',
    stage: 5,
    roleSummary:
      'Ansvarar enbart för värderingar: är marknaden dyr, billig eller rimligt värderad?',
    watches: [
      'P/E, forward P/E, Shiller CAPE, EV/EBITDA, P/B, PEG, earnings yield',
      'Equity/credit risk premium, realräntor, mean reversion',
      'Värderingsskillnader USA/Europa/Sverige/EM och growth/value/large/small',
    ],
    outputSummary:
      'Värderingsbedömning per region, dyraste/billigaste segment, samt vad som krävs för fortsatt uppgång respektive vad som kan skapa värderingspress.',
  },
  {
    id: 'portfolio-strategist',
    name: 'Portfolio Strategist',
    stage: 6,
    roleSummary:
      'Översätter analysen till portföljimplikationer för en långsiktig, diversifierad portfölj. Ger aldrig individuella eller aggressiva råd.',
    watches: [
      'Aktie-/räntevikt, kredit, duration, region-/sektorvikt, valutarisk',
      'Alternativa tillgångar, likviditet, risknivå, rebalansering',
    ],
    outputSummary:
      'Portföljmiljö (risk-on/neutral/defensiv), aktie- och räntesyn, attraktiva regioner/sektorer, och vad kunder bör tänka mentalt snarare än transaktionsmässigt.',
  },
  {
    id: 'quant-data-scientist',
    name: 'Quant & Data Scientist',
    stage: 7,
    roleSummary:
      'Ansvarar för statistik, grafer, tabeller och visualiseringar. All data ska vara ren, korrekt och tydligt presenterad.',
    watches: [
      'Index (S&P 500, Nasdaq 100, OMXS30, Euro Stoxx 50, MSCI World/EM)',
      'Räntor (US 10Y/2Y, yield curve), kreditspreadar, VIX, MOVE',
      'Råvaror (Brent, guld), valutor (USD/SEK, EUR/SEK), PMI, inflation',
    ],
    outputSummary:
      'Minst 10 minimalistiska diagram, vart och ett med titel, period, källa och en kort kommentar om relevans för investerare.',
  },
  {
    id: 'devils-advocate',
    name: "Devil's Advocate",
    stage: 8,
    roleSummary:
      'Enda uppgift är att motbevisa teamets slutsatser: identifiera svagheter, blinda fläckar och alternativa scenarier — inte att vara negativ för sakens skull.',
    watches: [
      'Konsensusgrad i marknadssynen, historiska paralleller',
      'Underskattade risker och underskattade möjligheter',
    ],
    outputSummary:
      'Starkaste motargumentet, tre alternativa scenarier, och förslag på formuleringar som gör rapporten mer balanserad.',
  },
  {
    id: 'chief-investment-officer',
    name: 'Chief Investment Officer',
    stage: 9,
    roleSummary:
      'Slutlig beslutsfattare. Läser endast specialisternas sammanfattningar — analyserar inte rådata direkt. Tänker som en CIO med ansvar för flera hundra miljarder kronor.',
    watches: ['Specialisternas sammanfattningar (agent 1–8), inte rådata'],
    outputSummary:
      'Huvudscenario med sannolikhet, alternativa scenarier, tre viktigaste riskerna/möjligheterna, och påverkan på 2 veckor till 10 års sikt.',
  },
  {
    id: 'editorial-director',
    name: 'Editorial Director',
    stage: 10,
    roleSummary:
      'Skriver det färdiga veckobrevet på perfekt svenska efter CIO-beslut. Låter som en institutionell strateg, inte en journalist. Förenklar utan att fördumma.',
    watches: ['CIO-sammanfattningen och samtliga specialistrapporter'],
    outputSummary:
      'Komplett veckobrevsutkast enligt den 19-avsnittsstrukturen: executive summary, dashboard, makro/aktier/räntor/valutor/råvaror, grafer, CIO-syn, lärdom, citat och slutsats.',
  },
  {
    id: 'compliance-risk-officer',
    name: 'Compliance & Risk Officer',
    stage: 11,
    roleSummary:
      'Sista kontroll innan publicering. Har mandat att stoppa rapporten om den inte är lämplig för Private Banking-kommunikation.',
    watches: [
      'Det färdiga utkastet mot publiceringschecklistan (se qualityChecklist.ts)',
    ],
    outputSummary:
      'Ifylld checklista, godkänt/ej godkänt-beslut, och den obligatoriska disclaimern.',
  },
]
