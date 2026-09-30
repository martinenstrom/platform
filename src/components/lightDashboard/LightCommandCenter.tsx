import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  Building2,
  Cpu,
  Factory,
  FileText,
  Flame,
  Landmark,
  Package,
  Plus,
  Radio,
  ShoppingBag,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Sparkline } from '~/components/charts/Sparkline'
import { ChartTooltip } from '~/components/charts/ChartTooltip'
import { CATEGORICAL } from '~/lib/chartTheme'
import { CountryAnalysis } from '~/components/countryExplorer/CountryAnalysis'
import { CountryExplorerSkeleton } from '~/components/countryExplorer/CountryExplorerSkeleton'

// Lazy: react-globe.gl touches `window` at import time, so the globe must
// never enter the SSR bundle — same pattern as the dark explorer.
const LightGlobe = lazy(() =>
  import('./LightGlobe').then((module) => ({ default: module.LightGlobe })),
)
import { getMarketStatus, MARKET_CENTERS } from '~/data/countryExplorer/marketCenters'
import { countryExplorerService } from '~/services/countryExplorerService'
import { cn } from '~/lib/cn'
import { formatPercent } from '~/lib/format'
import {
  discloseEnvelope,
  discloseObservation,
  disclosureTitle,
  type Disclosure,
} from '~/presentation/marketData/disclosure'
import {
  dataOr,
  formatDataFreshness,
  toYieldCurveValues,
  toYieldViewModel,
  RANGE_LABELS,
  toIntradayRows,
  toMarketRowViewModel,
  toNewsViewModel,
  toQuoteViewModel,
  toSectorViewModel,
  toSparklineValues,
  toWatchlistViewModel,
} from '~/presentation/marketData/viewModels'
import { hasData, SERIES_RANGES, type SeriesRange } from '~/domain/market'
import type { OverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import type { MarketImpactBrief } from '~/application/advisory/marketImpact'
import {
  AffectedClientsMark,
  GlyphWithAffectedClients,
  meaningfulEvents,
} from '~/components/marketImpact/MarketImpactModule'
import type { CountryMacroData, CountryRegistryEntry } from '~/types/countryExplorer'
import type { CurrentOperator } from '~/application/analysis/currentOperator'

/**
 * Financial-District night photograph used as the sidebar background — a dark,
 * cinematic Lower-Manhattan scene (anonymous lit stone building, an illuminated
 * Handelsbanken flag, wet pavement). User-supplied asset; swap the file at this
 * path to change it.
 */
const WALL_STREET_PHOTO_URL = '/data/wall-street.jpg'

/** Dark institutional palette (matches the reference token set). */
const PANEL =
  'rounded-[14px] border border-[rgba(70,130,163,0.20)] bg-[rgba(4,14,23,0.88)] shadow-[0_22px_60px_rgba(0,0,0,0.42)]'
const CARD_INNER =
  'rounded-[10px] border border-[rgba(54,119,155,0.22)] bg-[rgba(6,18,29,0.55)]'
// These tiles are informational, not links — no lift or pointer that would
// promise navigation. Just an extremely subtle same-hue border response so the
// surface still feels alive under the cursor. (Navigation lives in each
// section's explicit "Visa alla / Lägg till" link.)
const CARD_HOVER = 'transition-colors duration-200 hover:border-[rgba(54,119,155,0.36)]'
const LABEL = 'text-[11px] font-medium tracking-[0.2em] uppercase text-[#6f88a0]'
// Semantic up/down colours are the app-wide tokens, not local literals, so a
// gain reads the same green here as on every dark page and chart.
const POSITIVE = 'var(--color-positive)'
const NEGATIVE = 'var(--color-negative)'

/* ------------------------------------------------------------------ data — */

/**
 * This screen no longer builds, generates or parses any data. Every value
 * arrives as an `OverviewSnapshot` from the application layer and is turned
 * into display strings by `~/presentation/marketData/viewModels`.
 *
 * What used to live here: nine local builders, a mulberry32 generator that
 * fabricated every sparkline and the whole intraday chart, string parsing of
 * localized figures, and direct imports of five mock modules.
 */

/** Sector glyphs. Decoration keyed by canonical symbol, not data. */
const SECTOR_ICONS: Record<string, typeof Cpu> = {
  'sector:technology': Cpu,
  'sector:communication': Radio,
  'sector:industrials': Factory,
  'sector:financials': Landmark,
  'sector:discretionary': ShoppingBag,
  'sector:healthcare': Activity,
  'sector:realestate': Building2,
  'sector:energy': Flame,
  'sector:staples': Package,
}

const INTRADAY_SERIES_COLORS = [
  CATEGORICAL[0],
  CATEGORICAL[1],
  CATEGORICAL[2],
  CATEGORICAL[3],
]

/**
 * A disclosure marker on a market row.
 *
 * Every number on this screen is presented as current market context, and
 * until now none of them said whether it was. The envelope has always known —
 * `ok`, `stale` or `fixture` — and the projection threw that away, leaving one
 * sentence at the foot of a panel to answer for every figure above it.
 *
 * The marker is deliberately small and unsaturated. This is institutional
 * disclosure: it has to be impossible to miss while reading the row and
 * impossible to mistake for an alarm. A current observation renders nothing,
 * which is what gives a marker meaning when it appears.
 */
function MarketDisclosure({ disclosure }: { disclosure: Disclosure }) {
  if (disclosure.marker === null) return null
  const fixture = disclosure.state === 'fixture'
  return (
    <span
      title={disclosureTitle(disclosure)}
      className="ml-2 shrink-0 whitespace-nowrap rounded-[3px] border px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.09em]"
      style={
        fixture
          ? { borderColor: 'rgba(214,164,90,0.45)', color: '#d6a45a' }
          : { borderColor: 'rgba(122,145,168,0.35)', color: '#8fa3b8' }
      }
    >
      {disclosure.marker}
    </span>
  )
}

/** Legend/series order for "Utveckling idag", matched to the snapshot order. */
function intradaySeriesMeta(snapshot: OverviewSnapshot, range: SeriesRange) {
  const byRange = dataOr(snapshot.intraday, {} as Record<SeriesRange, never[]>)
  const series = byRange[range] ?? []
  return series.map((entry, index) => ({
    id: entry.symbol,
    label: snapshot.instruments[entry.symbol]?.displayName ?? entry.symbol,
    color: INTRADAY_SERIES_COLORS[index % INTRADAY_SERIES_COLORS.length] as string,
    /*
     * Per series, not per chart. A `MarketSeries` carries its own provenance,
     * so two lines on one chart can differ in source and state — and the
     * legend, where each line is named, is the only place a reader can be told
     * which one is which.
     */
    disclosure: discloseObservation(entry.provenance, snapshot.intraday, {
      symbol: entry.symbol,
    }),
  }))
}

/* ------------------------------------------------------------- sections — */

/**
 * The column the left navigation used to take, and JARVIS takes now.
 *
 * Kept as a spacer so the composition to its right does not move: the hero
 * photograph still dissolves into the dashboard from behind it, and the market
 * panels keep the geometry they were approved with. The presence itself is
 * mounted from the root route, beside every page, and stands at the left edge
 * of this space — it is not this screen's to render.
 *
 * What stood here before is gone rather than hidden. The rail listed the
 * product's destinations; the presence carries them as shortcuts, and
 * `Bevakning` is linked from the panel that shows it. The operator plate that
 * named who is here is JARVIS's to show, because JARVIS is the one addressing
 * them.
 */
function RailSpace() {
  return (
    <div
      aria-hidden="true"
      className="relative z-10 hidden w-[306px] shrink-0 md:block"
    />
  )
}

/** Client-only clock: null during SSR/first paint so live time can't cause a
 *  hydration mismatch, then ticks every second. */
function useClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function Header({ asOf, operator }: { asOf: string; operator?: CurrentOperator }) {
  const now = useClock()
  // Before mount the snapshot's own timestamp stands in, so the greeting and
  // date come from real data rather than a frozen mock clock (defect D3).
  const ref = now ?? new Date(asOf)
  const hour = ref.getHours()
  const greeting = hour < 10 ? 'God morgon' : hour < 18 ? 'God eftermiddag' : 'God kväll'
  const dateText = new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(ref)
  const openCount = MARKET_CENTERS.filter(
    (center) => getMarketStatus(center, ref) === 'OPEN',
  ).length
  const clock = now
    ? new Intl.DateTimeFormat('sv-SE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Stockholm',
      }).format(now)
    : '––:––:––'

  return (
    <header className="flex flex-wrap items-start justify-between gap-6">
      <div>
        {/*
         * Addressed to the resolved operator, or to nobody. The name was a
         * literal for as long as this screen existed; a greeting the product
         * cannot back with an identity is a greeting it does not make.
         */}
        <h1 className="text-[31px] font-semibold tracking-tight text-[#f4f7fb]">
          {operator ? `${greeting}, ${operator.displayName}` : greeting}
        </h1>
        <p className="mt-1 text-sm text-[#9aa7b7]">
          Här är din globala marknadsöversikt för idag, {dateText}.
        </p>
        {/*
         * Sentinel's three counts stood beneath the greeting for one stage.
         * The market command centre greets with the market; the client half
         * of the morning is the JARVIS workspace's, one click away.
         */}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 rounded-[10px] border border-[rgba(70,130,163,0.2)] bg-[rgba(4,14,23,0.7)] px-3.5 py-2 text-[11px] font-medium tracking-[0.12em] text-[#9aa7b7] uppercase">
          <span
            aria-hidden="true"
            className={cn(
              'h-2 w-2 rounded-full',
              openCount > 0
                ? 'bg-positive shadow-[0_0_8px_var(--color-positive)]'
                : 'bg-negative',
            )}
          />
          {openCount > 0 ? 'Marknader öppna' : 'Marknader stängda'}
        </span>
        <span className="rounded-[10px] border border-[rgba(70,130,163,0.2)] bg-[rgba(4,14,23,0.7)] px-3.5 py-1.5 text-right">
          <span className="block text-[15px] font-semibold text-[#f4f7fb] tabular-nums">
            {clock}
          </span>
          <span className="block text-[10px] text-[#697787]">Stockholm</span>
        </span>
        {/*
         * A search button and a notifications button stood here with no
         * handler behind either. Removed rather than wired: the thing that will
         * answer a question or carry a notification on this page is the
         * presence the shell is about to gain, not two more buttons.
         */}
      </div>
    </header>
  )
}

function ChangeText({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn('font-medium tabular-nums', className)}
      style={{ color: value >= 0 ? POSITIVE : NEGATIVE }}
    >
      {formatPercent(value)}
    </span>
  )
}

interface IntradayTooltipEntry {
  dataKey?: string | number
  value?: number
}

/** Two-decimal series value for the tooltip, matching the chart's own scale. */
function formatSeriesValue(value: number): string {
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Routes the intraday chart's hover through the shared ChartTooltip, on the
 *  Overview's own dark ground — one tooltip component, theme-aware surface. */
function IntradayTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean
  payload?: IntradayTooltipEntry[]
  label?: string
  series: Array<{ id: string; label: string; color: string }>
}) {
  if (!active || !payload?.length) return null
  return (
    <ChartTooltip
      surface="overview"
      title={String(label ?? '')}
      rows={payload.map((entry) => {
        const match = series.find((s) => s.id === entry.dataKey)
        return {
          label: match?.label ?? String(entry.dataKey),
          value: `${formatSeriesValue(entry.value ?? 0)} %`,
          color: match?.color,
        }
      })}
    />
  )
}

function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(PANEL, 'p-5', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={LABEL}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/* ----------------------------------------------------------------- page — */

export function LightCommandCenter({
  snapshot,
  operator,
  marketImpact,
}: {
  snapshot: OverviewSnapshot
  /** Who the product is addressing; absent when no operator is configured. */
  operator?: CurrentOperator
  /**
   * Market-to-Client, for the row marks only: a muted "3 klienter" beside a
   * market row at least one client is meaningfully exposed to, linking into
   * the JARVIS workspace. Absent when the advisory record did not answer;
   * then no row carries a count, and the market screen is complete without
   * it. The Sentinel and Marknadspåverkan modules that stood on this screen
   * for one stage live at `/sentinel` and `/market-impact` now: this is the
   * market command centre, and clients are not its subject.
   */
  marketImpact?: MarketImpactBrief
}) {
  const [mounted, setMounted] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [entry, setEntry] = useState<CountryRegistryEntry | null>(null)
  const [analysis, setAnalysis] = useState<CountryMacroData | null>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [range, setRange] = useState<SeriesRange>('1d')

  useEffect(() => {
    setMounted(true)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!analysisOpen) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAnalysisOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [analysisOpen])

  async function selectCountry(nextEntry: CountryRegistryEntry) {
    setEntry(nextEntry)
    setAnalysis(null)
    setAnalysisOpen(true)
    try {
      setAnalysis(await countryExplorerService.getCountryAnalysis(nextEntry.countryCode))
    } catch (error) {
      console.error('Kunde inte hämta landsanalys:', error)
      setAnalysisOpen(false)
    }
  }

  // Every figure below is read from the snapshot and formatted by the
  // presentation layer. Nothing on this screen computes, parses or invents a
  // financial value any more.
  /*
   * Disclosure per category, resolved once and carried onto every row it
   * governs. `dataOr` is still the right call for the decorative series — a
   * sparkline is a shape, not a quoted figure — but every number a reader
   * could take for a current market observation now travels with its state.
   */
  /*
   * The only panel-level marker left on this screen, and it is panel-level
   * because the panel renders exactly one observation.
   *
   * `MarketSentiment` is a single derived score with a single `Provenance`.
   * Its `components` carry their own `inputAsOf` and `inputQuality`, and the
   * domain already folds the stalest input into the score's own provenance —
   * "a score is only as fresh as its stalest input". None of the components is
   * rendered here, so there is no second value on this panel that could
   * disagree with the marker.
   */
  /*
   * Panel-level, but still judged as an observation: a derived sentiment
   * score served under stale-while-revalidate is not stale merely because the
   * cache turned over behind it.
   */
  const sentimentDisclosure = discloseEnvelope(snapshot.sentiment, {
    /*
     * The composite's own session, not a constituent's. `closed` earns the
     * closed-session allowance from the frozen freshness policy, which is what
     * keeps the last complete US-session reading current overnight instead of
     * stale fifteen minutes after the bell.
     */
    session: hasData(snapshot.sentiment) ? snapshot.sentiment.data.session : 'unknown',
  })

  const sparklines = dataOr(snapshot.indexSparklines, {})
  const marketCards = dataOr(snapshot.indices, []).map((quote) => ({
    ...toQuoteViewModel(quote),
    spark: toSparklineValues(sparklines[quote.symbol]),
    disclosure: discloseObservation(quote.provenance, snapshot.indices, {
      symbol: quote.symbol,
      session: quote.session,
    }),
  }))
  const currentMarkets = [
    ...dataOr(snapshot.fx, []).map((quote) => ({
      quote,
      disclosure: discloseObservation(quote.provenance, snapshot.fx, {
        symbol: quote.symbol,
        session: quote.session,
      }),
    })),
    ...dataOr(snapshot.commodities, []).map((quote) => ({
      quote,
      disclosure: discloseObservation(quote.provenance, snapshot.commodities, {
        symbol: quote.symbol,
        session: quote.session,
      }),
    })),
    ...dataOr(snapshot.crypto, []).map((quote) => ({
      quote,
      disclosure: discloseObservation(quote.provenance, snapshot.crypto, {
        symbol: quote.symbol,
        session: quote.session,
      }),
    })),
  ].map(({ quote, disclosure }) => ({ ...toMarketRowViewModel(quote), disclosure }))
  const rates = dataOr(snapshot.yields, []).map((entry) => ({
    ...toYieldViewModel(entry),
    id: String(entry.symbol),
    disclosure: discloseObservation(entry.provenance, snapshot.yields, {
      symbol: entry.symbol,
    }),
  }))
  /*
   * The client count beside a market row: which open event this series
   * belongs to, when at least one client is meaningfully exposed. Keyed by
   * the symbol the row already carries; the row itself computes nothing.
   */
  const affectedBySymbol = new Map(
    (marketImpact ? meaningfulEvents(marketImpact) : []).map((entry) => [
      entry.event.symbol,
      entry,
    ]),
  )
  const rateCurve = toYieldCurveValues(
    hasData(snapshot.yieldCurve) ? snapshot.yieldCurve.data : undefined,
  )
  const sectors = dataOr(snapshot.sectors, []).map((entry) => ({
    ...toSectorViewModel(entry),
    disclosure: discloseObservation(entry.provenance, snapshot.sectors, {
      symbol: entry.symbol,
    }),
  }))
  const watchlistSparks = dataOr(snapshot.watchlistSparklines, {})
  const watchlistItems = dataOr(snapshot.watchlist, []).map((quote) => ({
    ...toWatchlistViewModel(quote, watchlistSparks[quote.symbol]),
    disclosure: discloseObservation(quote.provenance, snapshot.watchlist, {
      symbol: quote.symbol,
      session: quote.session,
    }),
  }))
  // Relative news ages are measured against the snapshot's own generation
  // time, not a live clock: the labels stay stable between renders and the
  // page does not silently re-time itself every second.
  const newsNow = new Date(snapshot.generatedAt)
  const news = dataOr(snapshot.news, []).map((item) => toNewsViewModel(item, newsNow))
  const intradaySeries = intradaySeriesMeta(snapshot, range)
  const intraday = toIntradayRows(dataOr(snapshot.intraday, {} as never)[range] ?? [])
  const sentimentPosition = hasData(snapshot.sentiment)
    ? snapshot.sentiment.data.score
    : 50
  const sentimentLabel = hasData(snapshot.sentiment)
    ? snapshot.sentiment.data.label
    : 'neutral'

  /*
   * What a reader needs to act on the headline, in one inspectable string.
   *
   * A composite of 45 built from 43/45/47 and one built from 5/45/85 are the
   * same number and entirely different statements, so the legs and the
   * dispersion travel with the score rather than behind it. The credit leg's
   * proxy note comes too: the aggregate must never hide that it is measured
   * through two ETFs.
   */
  const riskAppetite = hasData(snapshot.sentiment) ? snapshot.sentiment.data : null
  const riskAppetiteDetail = riskAppetite
    ? [
        `${riskAppetite.score.toFixed(0)} (${riskAppetite.label})`,
        ...riskAppetite.components.map(
          (component) =>
            `${component.label} ${component.inputValue.toFixed(0)}` +
            (component.isProxy ? ' (proxy)' : ''),
        ),
        riskAppetite.dispersion === undefined
          ? null
          : `Spridning ${riskAppetite.dispersion.toFixed(0)}`,
        `Metod ${riskAppetite.formulaVersion}`,
        `Observerad ${riskAppetite.provenance.asOf.slice(0, 10)}` +
          (riskAppetite.session ? ` (${riskAppetite.session})` : ''),
        riskAppetite.components.find((component) => component.proxyNote)?.proxyNote ??
          null,
      ]
        .filter(Boolean)
        .join(' · ')
    : sentimentDisclosure.detail

  /**
   * Cross-asset disagreement, shown rather than buried.
   *
   * Dispersion never alters the score — that separation is the whole point —
   * but a headline produced by legs that disagree severely must not read like
   * a settled one. Measured over two years the median is ~41 and the top
   * quartile begins near 60, so 60 is where "the legs disagree" stops being
   * the normal state and starts being the thing to say out loud.
   */
  const riskAppetiteDispersion = riskAppetite?.dispersion ?? null
  const riskAppetiteDisagrees =
    riskAppetiteDispersion !== null && riskAppetiteDispersion > 60

  const tickerItems = [
    ...marketCards.map((c) => ({
      label: c.label,
      value: c.value,
      change: c.changePercent,
    })),
    ...currentMarkets
      .filter((c) => ['fx:usdsek', 'fx:eurusd', 'cmd:brent'].includes(c.id))
      .map((c) => ({ label: c.label, value: c.value, change: c.changePercent })),
  ]

  return (
    <div
      className="relative flex min-h-screen font-sans text-[#f2f6fa] antialiased"
      style={{
        background:
          'radial-gradient(circle at 60% 30%, rgba(14,88,126,0.18) 0%, rgba(4,19,32,0.10) 34%, rgba(2,7,17,0) 64%), linear-gradient(180deg, #020711 0%, #03101A 100%)',
      }}
    >
      {/* Hero background: the Financial-District photograph anchored left at full
          height, extended toward the content and dissolved into the dashboard
          over a long, progressively darker gradient — one continuous cinematic
          scene behind the UI rather than a narrow sidebar strip. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-[46vw] max-w-[760px] overflow-hidden"
      >
        {/* Overscanned by 8px top and bottom so the 6px environmental drift
            (.hero-photo-drift) never exposes an edge inside the clip. The
            photo stays vertically centred, so the framing is unchanged. */}
        <div
          className="hero-photo-drift absolute -inset-y-[8px] right-0 left-0 bg-[length:auto_100%] bg-[position:-46px_center] bg-no-repeat"
          style={{ backgroundImage: `url(${WALL_STREET_PHOTO_URL})` }}
        />
        <div className="absolute inset-0 bg-black/[0.12]" />
        {/* Darker behind the nav band so the labels stay effortless to read. */}
        <div className="absolute inset-y-0 left-0 w-[160px] bg-gradient-to-r from-[rgba(3,7,14,0.62)] to-transparent" />
        {/* Long, gentle dissolve into the dashboard — starts later and eases in so
            the transition is almost imperceptible. */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent from-[47%] via-[rgba(4,10,18,0.55)] via-[70%] to-[#020711]" />
      </div>

      <RailSpace />

      <main className="relative z-10 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-8 pt-6 pb-16">
          <Header asOf={snapshot.asOf} operator={operator} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {/* Market overview cards. */}
            <SectionCard title="Marknadsöversikt" className="xl:col-span-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {marketCards.map((card) => (
                  <div key={card.id} className={cn(CARD_INNER, CARD_HOVER, 'p-3.5')}>
                    <p className="flex items-center text-[12px] font-medium text-[#7f97ad]">
                      <span className="truncate">{card.label}</span>
                      <MarketDisclosure disclosure={card.disclosure} />
                      <AffectedClientsMark
                        entry={affectedBySymbol.get(card.id)}
                        variant="compact"
                      />
                    </p>
                    <p className="mt-1.5 text-[21px] font-semibold text-[#f4f7fb] tabular-nums">
                      {card.value}
                    </p>
                    <ChangeText value={card.changePercent} className="text-[13px]" />
                    <div className="mt-2">
                      <Sparkline
                        data={card.spark}
                        trendUp={card.changePercent >= 0}
                        width={112}
                        height={30}
                        area
                      />
                    </div>
                  </div>
                ))}
              </div>
              {/*
               * The link out to a fuller market list is gone with the route it
               * pointed at. `/markets` held a ticker list of indices, FX and
               * crypto, all of which this screen already shows — so the link
               * now redirects to the page it sits on, and promising "all
               * markets" somewhere else would promise a page that does not
               * exist.
               */}
            </SectionCard>

            {/* Globe centerpiece — overlaps down into the middle row. */}
            <div className="relative z-10 min-h-[440px] xl:col-span-4">
              {/* Subtle dark-blue space glow separating the globe from the page. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0"
                style={{
                  background:
                    'radial-gradient(circle at 50% 42%, rgba(30,72,120,0.3), rgba(12,30,54,0.12) 44%, transparent 68%)',
                }}
              />
              {mounted && (
                <Suspense fallback={null}>
                  <LightGlobe
                    onSelectCountry={selectCountry}
                    reducedMotion={reducedMotion}
                  />
                </Suspense>
              )}
              {/* Holographic projection platform beneath the globe. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
              >
                <div className="relative h-16 w-[62%]">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="absolute left-1/2 -translate-x-1/2 rounded-[50%] border"
                      style={{
                        bottom: `${i * 5}px`,
                        width: `${100 - i * 20}%`,
                        height: `${34 - i * 7}px`,
                        borderColor: `rgba(255,168,84,${0.4 - i * 0.07})`,
                        boxShadow: `0 0 ${10 - i * 2}px rgba(255,150,60,${0.22 - i * 0.045})`,
                      }}
                    />
                  ))}
                  <div
                    className="absolute bottom-1 left-1/2 h-2 w-10 -translate-x-1/2 rounded-[50%]"
                    style={{
                      background:
                        'radial-gradient(ellipse, rgba(255,214,150,0.95), rgba(255,150,60,0.4) 45%, transparent 72%)',
                    }}
                  />
                </div>
              </div>
              <p className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[10px] text-[#5a6a7c]">
                Dra för att rotera · klicka på ett land för analys
              </p>
            </div>

            {/* Right column. */}
            <div className="flex flex-col gap-6 xl:col-span-3">
              <SectionCard title="Aktuella marknader">
                <ul className="flex flex-col">
                  {currentMarkets.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 border-t border-[rgba(70,130,163,0.12)] py-2.5 first:border-t-0"
                    >
                      <span className="flex min-w-0 items-center gap-2.5 text-sm text-[#c9d6e2]">
                        <GlyphWithAffectedClients entry={affectedBySymbol.get(row.id)}>
                          <span aria-hidden="true" className="text-base leading-none">
                            {row.icon}
                          </span>
                        </GlyphWithAffectedClients>
                        <span className="truncate">{row.label}</span>
                        <MarketDisclosure disclosure={row.disclosure} />
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-semibold text-[#f4f7fb] tabular-nums">
                          {row.value}
                        </span>
                        <ChangeText
                          value={row.changePercent}
                          className="w-14 text-right text-[12px]"
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                /*
                 * The visible concept. Operator- and cache-facing identifiers
                 * (the `sentiment` category, MARKETDATA_CHAIN_SENTIMENT, the
                 * cache key, the port) stay as they are: renaming them would
                 * break configuration and invalidate cache keys for no reader's
                 * benefit. What changes is the claim made to a human — this
                 * measures cross-asset risk pricing, not investor psychology.
                 */
                title="Cross-Asset Risk Appetite"
                action={
                  <span className="flex items-center gap-2" title={riskAppetiteDetail}>
                    <MarketDisclosure disclosure={sentimentDisclosure} />
                    {riskAppetiteDispersion !== null && (
                      <span
                        className="text-[10px] font-medium uppercase tracking-[0.09em]"
                        style={{ color: riskAppetiteDisagrees ? '#d6a45a' : '#6f88a0' }}
                      >
                        {riskAppetiteDisagrees ? 'Spridning ' : 'Spr '}
                        {riskAppetiteDispersion.toFixed(0)}
                      </span>
                    )}
                    <span
                      className="text-[13px] font-semibold"
                      style={{ color: POSITIVE }}
                    >
                      {sentimentLabel === 'risk-on'
                        ? 'Risk-on'
                        : sentimentLabel === 'risk-off'
                          ? 'Risk-off'
                          : 'Neutral'}
                    </span>
                  </span>
                }
              >
                <div className="relative flex h-2 gap-1">
                  {[
                    '#e0483f',
                    '#ef6a3a',
                    '#f5ad3a',
                    '#e7d43c',
                    '#a9d84a',
                    '#5fce6a',
                    '#33c06a',
                    '#27d879',
                  ].map((color) => (
                    <span
                      key={color}
                      aria-hidden="true"
                      className="h-full flex-1 rounded-full"
                      style={{ background: color }}
                    />
                  ))}
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b1220] bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                    style={{ left: `${sentimentPosition}%` }}
                  />
                </div>
              </SectionCard>
            </div>
          </div>

          {/*
           * Klientprioriteringar (Sentinel) and Marknadspåverkan
           * (Market-to-Client) stood here as two modules for one stage, and
           * the market command centre became a client page with a globe on
           * it. Both are pages of the JARVIS workspace now — `/sentinel`,
           * `/market-impact` — and nothing about clients renders here beyond
           * the muted count beside a row a client is exposed to.
           */}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {/* Intraday chart. */}
            <SectionCard
              title="Utveckling idag"
              className="xl:col-span-5"
              action={
                <div className="flex items-center gap-2">
                  <div
                    role="group"
                    aria-label="Tidsintervall"
                    className="flex gap-0.5 rounded-full border border-[rgba(70,130,163,0.2)] bg-[rgba(6,18,29,0.7)] p-0.5"
                  >
                    {SERIES_RANGES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={r === range}
                        onClick={() => setRange(r)}
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-200',
                          r === range
                            ? 'bg-[rgba(72,167,232,0.18)] text-[#73c8ff]'
                            : 'text-[#6b7d90] hover:text-[#c9d6e2]',
                        )}
                      >
                        {RANGE_LABELS[r]}
                      </button>
                    ))}
                  </div>
                </div>
              }
            >
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={intraday}
                    margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
                  >
                    <CartesianGrid stroke="rgba(70,130,163,0.12)" vertical={false} />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: '#5a6a7c', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fill: '#5a6a7c', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) => `${value.toFixed(1)}%`}
                    />
                    <Tooltip
                      cursor={{ stroke: 'rgba(114,164,255,0.4)' }}
                      content={<IntradayTooltip series={intradaySeries} />}
                      isAnimationActive={false}
                    />
                    {intradaySeries.map((s) => (
                      <Line
                        key={s.id}
                        type="monotone"
                        dataKey={s.id}
                        stroke={s.color}
                        strokeWidth={1.6}
                        dot={false}
                        activeDot={{ r: 3, strokeWidth: 2, stroke: '#06121d' }}
                        isAnimationActive={!reducedMotion}
                        animationDuration={850}
                        animationEasing="ease-out"
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-[rgba(70,130,163,0.12)] pt-3">
                {intradaySeries.map((s) => {
                  const card = marketCards.find((c) => c.id === s.id)
                  return (
                    <span key={s.id} className="flex items-center gap-2 text-[12px]">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ background: s.color }}
                      />
                      <span className="text-[#9aa7b7]">{s.label}</span>
                      {card && <ChangeText value={card.changePercent} />}
                      <MarketDisclosure disclosure={s.disclosure} />
                    </span>
                  )
                })}
              </div>
            </SectionCard>

            {/* Rates. */}
            <SectionCard title="Räntemarknaden" className="xl:col-span-3">
              <ul className="flex flex-col">
                {rates.map((rate) => (
                  <li
                    key={rate.label}
                    className="flex items-center justify-between gap-3 border-t border-[rgba(70,130,163,0.12)] py-2.5 first:border-t-0"
                  >
                    <span className="flex min-w-0 items-center text-sm text-[#9aa7b7]">
                      <span className="truncate">{rate.label}</span>
                      <MarketDisclosure disclosure={rate.disclosure} />
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <AffectedClientsMark
                        entry={affectedBySymbol.get(rate.id)}
                        variant="compact"
                      />
                      <span className="text-sm font-semibold text-[#f4f7fb] tabular-nums">
                        {rate.value}
                      </span>
                      <span
                        className="w-16 text-right text-[12px] font-medium tabular-nums"
                        style={{ color: rate.negative ? NEGATIVE : POSITIVE }}
                      >
                        {rate.change}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 h-10">
                <Sparkline data={rateCurve} trendUp width={260} height={40} />
              </div>
            </SectionCard>

            {/* Sectors. */}
            <SectionCard title="Sektorer (S&P 500)" className="xl:col-span-2">
              <ul className="flex flex-col gap-2">
                {sectors.map((sector) => {
                  const width = Math.min(100, (Math.abs(sector.change) / 0.9) * 100)
                  const Icon = SECTOR_ICONS[sector.id] ?? Cpu
                  return (
                    <li key={sector.label} className="flex items-center gap-2">
                      <GlyphWithAffectedClients entry={affectedBySymbol.get(sector.id)}>
                        <Icon
                          className="h-3 w-3 shrink-0 text-[#6b7d90]"
                          aria-hidden="true"
                        />
                      </GlyphWithAffectedClients>
                      <span className="w-16 shrink-0 truncate text-[11px] text-[#9aa7b7]">
                        {sector.label}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(70,130,163,0.14)]">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${width}%`,
                            background: sector.change >= 0 ? POSITIVE : NEGATIVE,
                          }}
                        />
                      </span>
                      <span
                        className="w-12 text-right text-[11px] font-medium whitespace-nowrap tabular-nums"
                        style={{ color: sector.change >= 0 ? POSITIVE : NEGATIVE }}
                      >
                        {formatPercent(sector.change)}
                      </span>
                      <MarketDisclosure disclosure={sector.disclosure} />
                    </li>
                  )
                })}
              </ul>
            </SectionCard>

            {/* News. */}
            <SectionCard
              title="Senaste nytt"
              className="xl:col-span-2"
              action={
                <Link
                  to="/reports"
                  className="text-[12px] font-medium text-[#48a7e8] transition-colors duration-200 hover:text-[#73a4ff]"
                >
                  Visa fler →
                </Link>
              }
            >
              <ul className="flex flex-col">
                {news.map((item) => (
                  <li
                    key={item.id}
                    className="flex gap-2.5 border-t border-[rgba(70,130,163,0.12)] py-2.5 first:border-t-0"
                  >
                    <FileText
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#48a7e8]"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[13px] leading-snug font-medium text-[#dbe4ee]">
                        {item.headline}
                      </p>
                      <p className="mt-1 text-[11px] text-[#697787]">
                        {item.outlet} · {item.relativeTime}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          {/* Watchlist row. */}
          <SectionCard
            title="Bevakning"
            action={
              <span className="flex items-center gap-2">
                <Link
                  to="/watchlist"
                  className="flex items-center gap-1.5 text-[12px] font-medium text-[#48a7e8] transition-colors duration-200 hover:text-[#73a4ff]"
                >
                  Lägg till bevakning <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {watchlistItems.map((item) => (
                <div key={item.id} className={cn(CARD_INNER, CARD_HOVER, 'p-3.5')}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="flex min-w-0 items-baseline text-[13px] font-semibold text-[#dbe4ee]">
                      <span className="truncate">{item.name}</span>
                      <MarketDisclosure disclosure={item.disclosure} />
                    </p>
                    <span className="text-sm font-semibold text-[#f4f7fb] tabular-nums">
                      {item.price}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <Sparkline
                      data={item.spark}
                      trendUp={item.changePercent >= 0}
                      width={96}
                      height={22}
                    />
                    <ChangeText value={item.changePercent} className="text-[12px]" />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Bottom ticker rail. */}
        <div className="sticky bottom-0 z-20 flex items-center gap-6 overflow-x-auto border-t border-[rgba(70,130,163,0.2)] bg-[rgba(2,7,17,0.94)] px-8 py-2 backdrop-blur-sm">
          {tickerItems.map((item) => (
            <span
              key={item.label}
              className="flex shrink-0 items-center gap-2 text-[12px]"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: item.change >= 0 ? POSITIVE : NEGATIVE }}
              />
              <span className="font-medium text-[#c9d6e2]">{item.label}</span>
              <span className="text-[#9aa7b7] tabular-nums">{item.value}</span>
              <span
                className="font-medium tabular-nums"
                style={{ color: item.change >= 0 ? POSITIVE : NEGATIVE }}
              >
                {formatPercent(item.change)}
              </span>
            </span>
          ))}
          {/*
           * Whether every category on this screen is actually serving live
           * data, said out loud.
           *
           * `hasDegradedCategory` has been computed on the snapshot since Phase
           * 0 and rendered nowhere — so a panel could serve a fixture or a
           * stale value under `MARKETDATA_MODE=hybrid` and look exactly like a
           * live one. That is the plainest way a market surface misleads, and
           * the Command Center v1 gate required it closed wherever market
           * context could otherwise read as authoritative.
           *
           * It states the degraded case AND the clean one: "everything here is
           * current" is a claim the snapshot supports, and leaving it unsaid
           * would make the absence of a warning the only signal.
           */}
          <span className="ml-auto shrink-0 text-[11px] text-[#5a6a7c]">
            {snapshot.hasDegradedCategory
              ? 'Vissa kategorier är ej tillgängliga, fördröjda eller ersatta'
              : 'Alla kategorier levererar aktuell data'}
          </span>
          <span className="shrink-0 text-[11px] text-[#5a6a7c]">
            {/* When the dashboard was refreshed, from the server-resolved
                snapshot — not render time (D5), and deliberately not the
                oldest category (D16), which would let one daily source such as
                an ECB reference rate make the whole screen look stale.
                Per-category freshness lives on each envelope. */}
            Data uppdaterad {formatDataFreshness(snapshot.generatedAt)}
          </span>
        </div>
      </main>

      {/* Country analysis — the full existing analyzer, presented as a modal. */}
      {analysisOpen && entry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Landsanalys: ${entry.nameEn}`}
        >
          <div className="hud-frame h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-surface p-5 shadow-pop">
            {analysis ? (
              <CountryAnalysis
                data={analysis}
                flagEmoji={entry.flagEmoji}
                onBack={() => setAnalysisOpen(false)}
              />
            ) : (
              <CountryExplorerSkeleton />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
