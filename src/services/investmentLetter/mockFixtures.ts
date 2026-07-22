/**
 * Deterministic example output for every stage of the pipeline, anchored to
 * the same mock week as `~/data/mockData`'s `MOCK_NOW` (2025-03-14, vecka 11).
 *
 * This is representative, not exhaustive: the spec asks for e.g. 20+ charts
 * and 25 news items in a real run. The types capture that full contract
 * (`ChartSpec[]`, arrays of news items, …); these fixtures populate a
 * realistic subset so the pipeline and its consumers can be exercised
 * end-to-end without hand-writing every example bullet in the spec.
 */

import { MOCK_NOW } from '~/data/mockData'
import { evaluatePublicationChecklist, MANDATORY_DISCLAIMER } from './qualityChecklist'
import type {
  CIOOutput,
  DevilsAdvocateOutput,
  EquityStrategistOutput,
  FlowIntelligenceOutput,
  GlobalMacroOutput,
  NewsIntelligenceOutput,
  PortfolioStrategistOutput,
  QuantOutput,
  ValuationSpecialistOutput,
  WeeklyLetter,
  WeeklyLetterDraft,
} from '~/types/investmentLetter'

const WEEK_LABEL = 'Vecka 11, 2025'
const MOCK_DATE = MOCK_NOW.toISOString().slice(0, 10)

export const mockNewsIntelligence: NewsIntelligenceOutput = {
  topGlobal: [
    {
      headline: 'Fed lämnar styrräntan oförändrad, tonar ned tempo för sänkningar',
      region: 'Globalt',
      source: 'Federal Reserve / Reuters',
      date: MOCK_DATE,
      whatHappened:
        'Den amerikanska centralbanken höll räntan oförändrad och signalerade färre sänkningar under året än marknaden tidigare prisat in.',
      whyItMatters:
        'Styr förväntningarna på global likviditet och därmed värderingen av räntekänsliga tillgångar.',
      marketImpact: 'Amerikanska realräntor steg marginellt, dollarn stärktes brett.',
      relevanceForLongTermInvestor:
        'Bekräftar att räntevägen sannolikt blir mer utdragen än snabb — talar för fortsatt fokus på kvalitetsbolag med prissättningskraft.',
      uncertainty: 'medel',
    },
    {
      headline: 'Global PMI-indikator stiger för tredje månaden i rad',
      region: 'Globalt',
      source: 'Trading Economics / S&P Global',
      date: MOCK_DATE,
      whatHappened:
        'Sammansatt inköpschefsindex för tillverkning och tjänster steg över 50, vilket indikerar fortsatt expansion.',
      whyItMatters:
        'Minskar sannolikheten för en global recession de kommande kvartalen.',
      marketImpact: 'Cykliska sektorer utvecklades starkare än defensiva under veckan.',
      relevanceForLongTermInvestor:
        'Stödjer en fortsatt diversifierad aktieexponering snarare än en defensiv omallokering.',
      uncertainty: 'medel',
    },
    {
      headline: 'Oljepriset faller på svagare efterfrågeprognoser',
      region: 'Globalt',
      source: 'IEA / Bloomberg',
      date: MOCK_DATE,
      whatHappened:
        'IEA reviderade ned sin efterfrågeprognos för året med anledning av svagare kinesisk tillväxt.',
      whyItMatters: 'Påverkar inflationsutsikter och energisektorns vinstutveckling.',
      marketImpact: 'Brent föll cirka 2 procent under veckan.',
      relevanceForLongTermInvestor:
        'Lägre energipriser är i grunden disinflationärt och avlastar konsumenten över tid.',
      uncertainty: 'medel',
    },
  ],
  sweden: [
    {
      headline: 'Riksbanken lämnar reporäntan oförändrad',
      region: 'Sverige',
      source: 'Riksbanken',
      date: MOCK_DATE,
      whatHappened:
        'Riksbanken höll räntan still och upprepade en balanserad syn på inflationsutsikterna.',
      whyItMatters:
        'Vägleder pris på svenska räntebärande tillgångar och kronans utveckling.',
      marketImpact: 'Kronan var i princip oförändrad mot euron.',
      relevanceForLongTermInvestor:
        'Ingen förändring i den strategiska ränte- eller valutasynen krävs till följd av beskedet.',
      uncertainty: 'låg',
    },
    {
      headline: 'Svensk verkstadsindustri rapporterar stabil orderingång',
      region: 'Sverige',
      source: 'Bolagsrapporter',
      date: MOCK_DATE,
      whatHappened:
        'Flera större verkstadsbolag rapporterade orderingång i linje med eller något över förväntan.',
      whyItMatters:
        'Verkstad är en tung och konjunkturkänslig del av det svenska börsindexet.',
      marketImpact: 'Sektorn var en av veckans starkaste bidragsgivare till OMXS30.',
      relevanceForLongTermInvestor:
        'Stödjer tesen om en mjuklandning snarare än en hårdare industriell nedgång.',
      uncertainty: 'medel',
    },
  ],
  europe: [
    {
      headline: 'ECB-medlemmar signalerar fortsatt gradvis lättnad',
      region: 'Europa',
      source: 'ECB',
      date: MOCK_DATE,
      whatHappened:
        'Flera ECB-ledamöter uttalade sig i linje med ytterligare gradvisa räntesänkningar under året.',
      whyItMatters:
        'Formar räntebanan för euroområdet och därmed europeiska tillgångsvärderingar.',
      marketImpact: 'Tyska tioåringar var i stort sett oförändrade.',
      relevanceForLongTermInvestor:
        'En gradvis lättnad snarare än en abrupt vändning minskar risken för överraskningar.',
      uncertainty: 'medel',
    },
  ],
  us: [
    {
      headline: 'Amerikansk kärninflation i linje med förväntan',
      region: 'USA',
      source: 'Bureau of Labor Statistics',
      date: MOCK_DATE,
      whatHappened:
        'Kärn-KPI kom in i linje med konsensus, utan tydlig överraskning i någon riktning.',
      whyItMatters: 'Ett av de viktigaste inputen till Feds räntebana.',
      marketImpact: 'Begränsad marknadsreaktion i räntor och aktier.',
      relevanceForLongTermInvestor:
        'Bekräftar en gradvis disinflationstrend snarare än en ny impuls uppåt.',
      uncertainty: 'låg',
    },
  ],
  emergingMarkets: [
    {
      headline: 'Kinesiska myndigheter aviserar ytterligare stimulansåtgärder',
      region: 'Tillväxtmarknader',
      source: 'Reuters',
      date: MOCK_DATE,
      whatHappened:
        'Kinesiska beslutsfattare presenterade riktade stimulanser mot fastighetssektorn och konsumtion.',
      whyItMatters:
        'Kinas tillväxttakt påverkar råvarupriser och tillväxtmarknader brett.',
      marketImpact:
        'Kinesiska aktieindex steg under veckan, råvarurelaterade bolag följde med.',
      relevanceForLongTermInvestor:
        'En del av en bredare, successiv stabilisering snarare än en enskild vändpunkt.',
      uncertainty: 'hög',
    },
  ],
  signalVsNoise:
    'Det som faktiskt spelar roll denna vecka är att både Fed och Riksbanken bekräftar en gradvis, inte abrupt, räntebana samtidigt som global PMI fortsätter stiga. Enskilda dagsrörelser i olja och valutor är i det här sammanhanget brus för en investerare med lång horisont.',
}

export const mockFlowIntelligence: FlowIntelligenceOutput = {
  capitalInflows: [
    'Globala aktiefonder, främst kvalitets- och storbolagsinriktade',
    'Investment grade-företagsobligationer',
    'Guld-ETF:er, fortsatt måttligt inflöde',
  ],
  capitalOutflows: [
    'Långa statspapper i USA',
    'Smala tillväxtmarknadsfonder exponerade mot fastighetssektorn',
  ],
  riskRegime: 'neutral',
  positioningOverheated: false,
  topInsiderBuys: [
    'Insiderköp i ett par svenska industribolag efter senaste kursnedgången',
  ],
  topInsiderSells: [
    'Rutinmässiga insiderförsäljningar i tekniksektorn, ingen tydlig klusterbildning',
  ],
  optionsMarketSignals:
    'Put/call-kvoten ligger nära sitt historiska snitt, och gamma-exponeringen indikerar ingen extrem positionering i endera riktningen.',
  creditMarketSignals:
    'Kreditspreadar i både investment grade och high yield är stabila till något lägre, vilket inte bekräftar den försiktighet som syns i vissa sentimentmått.',
  flowsConfirmPriceAction: true,
  conclusion:
    'Flödena bekräftar i stort veckans prisrörelser snarare än att motsäga dem. Positioneringen ser balanserad ut, utan tecken på överhettning i endera riktningen.',
}

export const mockGlobalMacro: GlobalMacroOutput = {
  globalAssessment:
    'Den globala konjunkturen mjuklandar snarare än viker. Inflationen fortsätter falla gradvis samtidigt som arbetsmarknaderna förblir relativt motståndskraftiga.',
  regional: [
    {
      region: 'USA',
      assessment:
        'Stabil tillväxt, gradvis avtagande inflation, centralbank i väntans tider.',
    },
    {
      region: 'Europa',
      assessment:
        'Svagare tillväxt än USA men med utrymme för fler räntesänkningar från ECB.',
    },
    {
      region: 'Sverige',
      assessment:
        'Exportberoende konjunktur som gynnas av stabiliserad global efterfrågan.',
    },
    {
      region: 'Kina',
      assessment:
        'Fortsatt stimulansdriven stabilisering, men strukturella utmaningar kvarstår.',
    },
  ],
  centralBankAssessment:
    'Fed, ECB och Riksbanken rör sig alla i samma riktning — gradvis lättnad utan brådska — vilket minskar risken för politikmisstag i endera riktningen.',
  inflationAssessment:
    'Kärninflationen fortsätter normaliseras i de flesta utvecklade ekonomier, om än i en ojämn takt mellan varor och tjänster.',
  rateView:
    'Vi räknar med en fortsatt men utdragen väg mot lägre styrräntor under de kommande tolv månaderna, inte en snabb serie sänkningar.',
  creditMarketAssessment:
    'Kreditspreadar är historiskt sett hopprensade, vilket lämnar mindre marginal för fortsatt kompression men ingen omedelbar stressignal.',
  currencyAssessment:
    'Dollarn är fortsatt stödd av räntedifferenser, medan kronan handlas i ett relativt stabilt intervall mot både euro och dollar.',
  risks: [
    {
      horizon: '1 månad',
      description:
        'Enskilda inflationsutfall som avviker från konsensus kan ge kortsiktig volatilitet.',
    },
    {
      horizon: '3 månader',
      description:
        'Geopolitisk osäkerhet kring handelspolitik kan påverka sentiment och råvarupriser.',
    },
    {
      horizon: '12 månader',
      description:
        'Risk att inflationen bottnar ur på en högre nivå än marknaden räknar med.',
    },
  ],
}

export const mockEquityStrategist: EquityStrategistOutput = {
  topMoves: [
    'Svensk verkstad ledde uppgången på starka orderbesked',
    'Amerikansk halvledarsektor pressades av vinsthemtagningar',
    'Kinesiska aktier steg på nya stimulansbesked',
  ],
  winningSectors: ['Verkstad', 'Bank', 'Råvaror'],
  losingSectors: ['Halvledare', 'Fastigheter'],
  driver: 'vinster',
  marketValuationView: 'rimlig',
  risks: [
    'Vinstmarginaler pressas om lönetillväxten tilltar snabbare än produktiviteten',
    'Koncentrationsrisk i ett fåtal stora amerikanska teknikbolag',
  ],
  opportunities: [
    'Bredare vinsttillväxt utanför de största teknikbolagen',
    'Cykliska sektorer som gynnas av stabiliserad global PMI',
  ],
  longTermConclusion:
    'Aktiemarknaden drivs för närvarande huvudsakligen av vinstutveckling snarare än av multipel-expansion, vilket är en sundare grund för avkastning över en lång horisont.',
}

export const mockValuationSpecialist: ValuationSpecialistOutput = {
  globalView:
    'Global aktievärdering ligger något över sitt historiska snitt men inte i extremt territorium.',
  usView:
    'USA handlas med premie mot övriga världen, koncentrerad till ett fåtal stora tillväxtbolag.',
  europeView:
    'Europeisk värdering ligger nära sitt historiska snitt och under den amerikanska marknaden.',
  swedenView:
    'Svenska aktier värderas i linje med sitt tioåriga snitt efter årets uppgång.',
  emergingMarketsView:
    'Tillväxtmarknader handlas med rabatt mot utvecklade marknader, delvis motiverat av högre osäkerhet.',
  mostExpensiveSegments: [
    'Amerikanska storbolag inom teknik',
    'Kvalitetsbolag med hög och stabil lönsamhet',
  ],
  cheapestSegments: ['Europeiska banker', 'Tillväxtmarknader exklusive Indien'],
  whatIsNeededForContinuedUpside:
    'Fortsatt vinsttillväxt behöver bredda sig utanför de största bolagen för att motivera dagens nivåer.',
  whatCouldPressureValuations:
    'En ränteuppgång driven av förnyade inflationsöverraskningar skulle sätta press på de högst värderade segmenten.',
  conclusion:
    'Marknaden är sammantaget rimligt värderad, men spridningen mellan regioner och sektorer är ovanligt stor.',
}

export const mockPortfolioStrategist: PortfolioStrategistOutput = {
  environment: 'neutral',
  equityStance: 'neutral',
  rateAndDurationView:
    'En måttlig durationsposition är rimlig givet en gradvis, inte abrupt, väntad räntenedgång.',
  creditAttractiveness:
    'Investment grade-kredit erbjuder fortsatt attraktiv riskjusterad avkastning, medan high yield-spreadar lämnar mindre marginal.',
  attractiveRegions: ['Europa', 'Sverige', 'Utvalda tillväxtmarknader'],
  sectorsToWatch: ['Bank', 'Verkstad', 'Hälsovård'],
  underratedRisks: [
    'Koncentrationsrisk i globala indexfonder mot ett fåtal stora bolag',
    'Likviditetsrisk i smala kreditsegment',
  ],
  mentalGuidance:
    'För långsiktiga investerare talar miljön för att bibehålla en väldiversifierad aktieexponering, snarare än att försöka tajma kortsiktiga rörelser.',
}

export const mockQuant: QuantOutput = {
  charts: [
    {
      id: 'sp500-12m',
      title: 'S&P 500, senaste 12 månaderna',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Fortsatt stigande trend med bred sektordeltagande.',
      relevance: 'Visar den underliggande trendstyrkan i det amerikanska indexet.',
    },
    {
      id: 'nasdaq100-12m',
      title: 'Nasdaq 100, senaste 12 månaderna',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Något ökad volatilitet efter en stark inledning på året.',
      relevance: 'Speglar sentimentet kring stora teknikbolag.',
    },
    {
      id: 'omxs30-12m',
      title: 'OMXS30, senaste 12 månaderna',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Verkstad och bank har drivit merparten av uppgången.',
      relevance: 'Direkt relevant för svenska investerares hemmamarknad.',
    },
    {
      id: 'eurostoxx50-12m',
      title: 'Euro Stoxx 50, senaste 12 månaderna',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Utveckling i linje med global aktiemarknad.',
      relevance: 'Ger den europeiska referenspunkten.',
    },
    {
      id: 'msci-world-12m',
      title: 'MSCI World, senaste 12 månaderna',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Bred global uppgång, ledd av USA.',
      relevance: 'Global referensram för en diversifierad portfölj.',
    },
    {
      id: 'msci-em-12m',
      title: 'MSCI Emerging Markets, senaste 12 månaderna',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Stimulansbesked från Kina har stöttat regionen.',
      relevance: 'Visar tillväxtmarknadernas relativa utveckling.',
    },
    {
      id: 'us10y',
      title: 'US 10Y statsränta',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Handlas i ett relativt stabilt intervall senaste kvartalet.',
      relevance: 'Central referensränta för global värdering.',
    },
    {
      id: 'yield-curve-10y2y',
      title: 'Yield curve, US 10Y–2Y',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Kurvan har normaliserats jämfört med föregående år.',
      relevance: 'Historiskt en indikator på konjunkturläget.',
    },
    {
      id: 'ig-spreads',
      title: 'Investment Grade-spreadar',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Historiskt hopprensade nivåer.',
      relevance: 'Signal om kreditmarknadens riskaptit.',
    },
    {
      id: 'vix',
      title: 'VIX',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Ligger nära sitt historiska snitt.',
      relevance: 'Mått på förväntad kortsiktig aktievolatilitet.',
    },
    {
      id: 'brent',
      title: 'Brentolja',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Nedåtgående prognosrevideringar har pressat priset.',
      relevance: 'Påverkar inflationsutsikter och energisektorns lönsamhet.',
    },
    {
      id: 'usdsek',
      title: 'USD/SEK',
      period: '12 månader',
      source: 'Marknadsdata',
      commentary: 'Handlas i ett relativt stabilt intervall.',
      relevance: 'Viktigt för svenska investerares utlandsexponering.',
    },
  ],
}

export const mockDevilsAdvocate: DevilsAdvocateOutput = {
  strongestCounterargument:
    'Teamets mjuklandningsscenario förutsätter att inflationen fortsätter falla utan att arbetsmarknaden försvagas — historiskt en ovanlig kombination som inte bör tas för given.',
  alternativeScenarios: [
    'Inflationen bottnar ur högre än väntat och tvingar centralbankerna till en mer stram hållning längre',
    'En snabbare avmattning på arbetsmarknaden utlöser en mer traditionell konjunkturnedgång',
    'Geopolitisk eskalering driver upp energipriser och skapar en ny inflationsimpuls',
  ],
  risksToMention: [
    'Koncentrationsrisken i stora amerikanska teknikbolag är historiskt hög',
    'Kreditspreadar prisar in mycket lite marginal för besvikelser',
  ],
  balancingLanguageSuggestions: [
    'Formulera huvudscenariot som det mest sannolika utfallet, inte som en säker prognos',
    'Nämn uttryckligen vad som skulle få teamet att ändra sig',
  ],
}

export const mockCIO: CIOOutput = {
  marketRegime: 'Sen-cykel expansion med gradvis avtagande inflation',
  mainScenario: {
    name: 'Mjuklandning',
    probabilityPercent: 55,
    description:
      'Tillväxten bromsar in måttligt men en recession undviks, samtidigt som inflationen fortsätter normaliseras.',
  },
  alternativeScenarios: [
    {
      name: 'Positivt scenario',
      probabilityPercent: 20,
      description:
        'Inflationen faller snabbare än väntat och vinsterna stärks ytterligare.',
    },
    {
      name: 'Negativt scenario',
      probabilityPercent: 25,
      description: 'Tillväxten försvagas mer än väntat och kreditspreadar stiger.',
    },
  ],
  topRisks: [
    'Inflationen bottnar ur på en högre nivå än marknaden räknar med',
    'Koncentrationsrisk i ett fåtal stora bolag',
    'Geopolitisk eskalering som påverkar energi och handel',
  ],
  topOpportunities: [
    'Breddad vinsttillväxt utanför de största teknikbolagen',
    'Attraktiv riskjusterad avkastning i investment grade-kredit',
    'Stabiliserande tillväxtmarknader på stimulansbesked',
  ],
  noise:
    'Enskilda dagsrörelser i valutor och råvaror samt kortsiktiga sentimentsvängningar i sociala medier.',
  whatMattersNow:
    'Att centralbankerna globalt rör sig i samma, gradvisa riktning utan att tvingas till abrupta kursändringar.',
  horizonImpact: [
    {
      horizon: '2 veckor',
      impact:
        'Begränsad påverkan, fortsatt datadriven volatilitet kring enskilda utfall.',
    },
    {
      horizon: '1 månad',
      impact: 'Marknaden väntas fortsätta väga bolagsvinster mot räntebesked.',
    },
    {
      horizon: '3 månader',
      impact:
        'Riktningen på inflation och arbetsmarknad avgör om mjuklandningsscenariot stärks eller försvagas.',
    },
    {
      horizon: '12 månader',
      impact:
        'Gradvis lägre räntor väntas stödja såväl aktier som räntebärande tillgångar.',
    },
    {
      horizon: '10 år',
      impact:
        'Enskilda kvartal spelar liten roll — bred diversifiering och disciplin är det som avgör utfallet.',
    },
  ],
  investmentImplication:
    'En neutral till något positiv syn på aktier, bibehållen diversifiering över regioner och sektorer, samt en måttlig durationsposition.',
  instructionToEditorial:
    'Framhåll att veckans budskap är kontinuitet snarare än förändring — undvik varje formulering som kan uppfattas som en uppmaning att agera kortsiktigt.',
}

const draft: WeeklyLetterDraft = {
  title: 'Veckobrev Private Banking – marknaden i korthet',
  weekLabel: WEEK_LABEL,
  date: MOCK_DATE,
  executiveSummary: [
    'Fed och Riksbanken bekräftar en gradvis, inte abrupt, väg mot lägre räntor.',
    'Global PMI stiger för tredje månaden i rad och minskar recessionsrisken.',
    'Svensk verkstad och bank ledde veckans uppgång på OMXS30.',
    'Aktiemarknaden är sammantaget rimligt värderad, med stor spridning mellan sektorer.',
    'Flödena bekräftar veckans prisrörelser — inga tecken på överhettad positionering.',
  ],
  marketDashboard: [
    {
      indicator: 'Marknadsregim',
      level: 'Sen-cykel, mjuklandning',
      weeklyChange: 'Oförändrad',
      signal: 'neutral',
      comment: 'Huvudscenario oförändrat sedan förra veckan.',
    },
    {
      indicator: 'VIX',
      level: '14,2',
      weeklyChange: '−0,4',
      signal: 'positiv',
      comment: 'Nära historiskt snitt, ingen stressignal.',
    },
    {
      indicator: 'US 10Y',
      level: '4,18 %',
      weeklyChange: '+0,03 %',
      signal: 'neutral',
      comment: 'Marginell rörelse efter Feds besked.',
    },
    {
      indicator: 'IG-spreadar',
      level: '92 bp',
      weeklyChange: '−2 bp',
      signal: 'positiv',
      comment: 'Fortsatt hopprensade nivåer.',
    },
    {
      indicator: 'USD/SEK',
      level: '10,41',
      weeklyChange: '+0,2 %',
      signal: 'neutral',
      comment: 'Handlas i ett stabilt intervall.',
    },
    {
      indicator: 'OMXS30',
      level: '2 612',
      weeklyChange: '+0,7 %',
      signal: 'positiv',
      comment: 'Verkstad och bank ledde uppgången.',
    },
    {
      indicator: 'MSCI Emerging Markets',
      level: '1 087',
      weeklyChange: '+1,1 %',
      signal: 'positiv',
      comment: 'Stöttat av kinesiska stimulansbesked.',
    },
    {
      indicator: 'Global PMI',
      level: '51,4',
      weeklyChange: '+0,3',
      signal: 'positiv',
      comment: 'Tredje månaden i rad över 50.',
    },
  ],
  keyEvents: [
    {
      region: 'Globalt',
      bullet: 'Fed lämnar räntan oförändrad och tonar ned tempo för sänkningar.',
    },
    { region: 'Globalt', bullet: 'Global PMI stiger för tredje månaden i rad.' },
    { region: 'Sverige', bullet: 'Riksbanken lämnar reporäntan oförändrad.' },
    {
      region: 'Sverige',
      bullet: 'Svensk verkstadsindustri rapporterar stabil orderingång.',
    },
    { region: 'Europa', bullet: 'ECB-ledamöter signalerar fortsatt gradvis lättnad.' },
    { region: 'USA', bullet: 'Amerikansk kärninflation i linje med förväntan.' },
    {
      region: 'Tillväxtmarknader',
      bullet: 'Kina aviserar ytterligare riktade stimulansåtgärder.',
    },
  ],
  macroSection:
    'Den globala konjunkturen fortsätter att mjuklanda snarare än vika. Fed, ECB och Riksbanken rör sig alla i samma, gradvisa riktning, vilket minskar risken för politikmisstag. Kärninflationen normaliseras stegvis, om än i en ojämn takt mellan varor och tjänster.',
  equitySection:
    'Aktiemarknaden drivs för närvarande huvudsakligen av vinstutveckling snarare än av stigande värderingsmultiplar, vilket är en sundare grund för avkastning över en lång horisont. Svensk verkstad och bank ledde veckans uppgång, medan amerikansk halvledarsektor pressades av vinsthemtagningar.',
  bondSection:
    'Räntemarknaden har rört sig marginellt efter veckans centralbanksbesked. Kreditspreadar i både investment grade och high yield är historiskt hopprensade, vilket lämnar mindre marginal för besvikelser men ingen omedelbar stressignal.',
  fxSection:
    'Dollarn är fortsatt stödd av räntedifferenser mot övriga världen, medan den svenska kronan handlas i ett relativt stabilt intervall mot både euro och dollar.',
  commoditiesSection:
    'Oljepriset föll under veckan på nedreviderade efterfrågeprognoser, vilket i grunden är disinflationärt. Guldpriset var i stort sett oförändrat.',
  flowsAndSentimentSection:
    'Kapital fortsätter flöda in i globala kvalitetsaktiefonder och investment grade-krediter, medan långa amerikanska statspapper sett visst utflöde. Options- och sentimentindikatorer ligger nära sina historiska snitt, utan tecken på överdriven optimism eller pessimism.',
  charts: mockQuant.charts,
  cioView: mockCIO,
  whatThisMeansForYou:
    'För dig som långsiktig investerare är veckans viktigaste budskap kontinuitet: centralbankerna rör sig i väntad riktning och konjunkturbilden stärks snarare än försvagas. Håll fast vid en väldiversifierad portfölj anpassad efter din horisont och ditt risktagande, och betrakta kortsiktig volatilitet som en normal del av investeringsresan snarare än en signal att agera.',
  weeklyLesson:
    'Under inflationschocken 2022 föll både aktier och obligationer samtidigt, vilket fick många investerare att ifrågasätta traditionell diversifiering. De som höll fast vid sin långsiktiga allokering återhämtade sig dock i takt med att marknaderna normaliserades — ett exempel på att disciplin under stress historiskt har belönat sig.',
  weeklyQuote: {
    author: 'Warren Buffett',
    quote: 'Vår favorit innehavsperiod är för alltid.',
  },
  weeklySmile:
    'Marknaden påminner ibland om vädret – den kan vara stormig en vecka, men den som bygger sitt hus för 30 år flyttar sällan på grund av en regnskur.',
  conclusion: [
    'Håll fast vid en väldiversifierad portfölj anpassad efter din horisont.',
    'Betrakta kortsiktig volatilitet som en normal, inte alarmerande, del av investeringsresan.',
    'Låt inte enskilda dagsrörelser eller rubriker styra långsiktiga beslut.',
  ],
}

export const mockWeeklyLetterDraft: WeeklyLetterDraft = draft

const complianceChecklist = evaluatePublicationChecklist(draft)

export const mockComplianceReview = {
  checklist: complianceChecklist,
  approved: complianceChecklist.every((item) => item.passed),
  disclaimer: MANDATORY_DISCLAIMER,
}

export const mockWeeklyLetter: WeeklyLetter = {
  ...draft,
  compliance: mockComplianceReview,
  publishedAt: MOCK_NOW.toISOString(),
}
