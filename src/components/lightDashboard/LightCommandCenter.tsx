import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  Briefcase,
  Building2,
  Cpu,
  Factory,
  FileText,
  Flame,
  Landmark,
  LayoutGrid,
  Newspaper,
  Package,
  Plus,
  Radio,
  Search,
  Settings,
  ShoppingBag,
  Star,
  TrendingUp,
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
import { COUNTRY_MOCK_NOW, getGlobalNewsFeed } from '~/data/countryExplorer'
import { GERMANY_DATA } from '~/data/countryExplorer/germany'
import { JAPAN_DATA } from '~/data/countryExplorer/japan'
import {
  GLOBAL_MARKET_OVERVIEW,
  GLOBAL_RISK_SENTIMENT,
} from '~/data/countryExplorer/globalMarketOverview'
import {
  getMarketStatus,
  MARKET_CENTERS,
} from '~/data/countryExplorer/marketCenters'
import { marketIndices, watchlist } from '~/data/mockData'
import { countryExplorerService } from '~/services/countryExplorerService'
import { cn } from '~/lib/cn'
import { formatNumber, formatPercent, formatRelativeTime } from '~/lib/format'
import type {
  CountryMacroData,
  CountryRegistryEntry,
} from '~/types/countryExplorer'

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
const CARD_HOVER =
  'transition-colors duration-200 hover:border-[rgba(54,119,155,0.36)]'
const LABEL = 'text-[11px] font-medium tracking-[0.2em] uppercase text-[#6f88a0]'
// Semantic up/down colours are the app-wide tokens, not local literals, so a
// gain reads the same green here as on every dark page and chart.
const POSITIVE = 'var(--color-positive)'
const NEGATIVE = 'var(--color-negative)'

/* ------------------------------------------------------------------ data — */

/**
 * All figures below reuse the app's existing mock datasets wherever they
 * exist (indices, DAX/Nikkei country data, VIX/10Y overview, news, watch-
 * list, sentiment). Entries with no dataset yet (FTSE, EUR/USD, commodities,
 * extra yields, sector day-moves, intraday curves) are local deterministic
 * mock values — same convention as the rest of the mock layer.
 */

interface DisplayQuote {
  id: string
  label: string
  value: string
  changePercent: number
  icon?: string
}

function seededSeries(seed: number, points: number, drift: number): number[] {
  let a = seed
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out: number[] = []
  let level = 0
  for (let i = 0; i < points; i++) {
    level += (next() - 0.5 + drift) * 0.22
    out.push(level)
  }
  return out
}

function indexQuote(id: string): DisplayQuote | null {
  const q = marketIndices.find((quote) => quote.id === id)
  if (!q) return null
  return {
    id,
    label: q.name,
    value: formatNumber(q.value, q.precision),
    changePercent: q.changePercent,
  }
}

function parseSignedPercent(text: string): number {
  const normalized = text.replace('−', '-').replace('%', '').replace(',', '.').trim()
  return Number.parseFloat(normalized) || 0
}

function buildMarketCards(): Array<DisplayQuote & { spark: number[] }> {
  const cards: Array<DisplayQuote & { spark: number[] }> = []
  const push = (quote: DisplayQuote | null, seed: number) => {
    if (quote)
      cards.push({
        ...quote,
        spark: seededSeries(seed, 16, quote.changePercent >= 0 ? 0.16 : -0.16),
      })
  }
  push(indexQuote('omxs30'), 3)
  push(indexQuote('sp500'), 5)
  const dax = GERMANY_DATA.markets!
  push(
    {
      id: 'dax',
      label: dax.primaryIndexName,
      value: dax.primaryIndexValue,
      changePercent: parseSignedPercent(dax.indexChangeToday),
    },
    7,
  )
  // FTSE 100 has no country dataset yet — local mock quote.
  push({ id: 'ftse', label: 'FTSE 100', value: '8 363,95', changePercent: 0.28 }, 11)
  const nikkei = JAPAN_DATA.markets!
  push(
    {
      id: 'nikkei',
      label: nikkei.primaryIndexName,
      value: nikkei.primaryIndexValue,
      changePercent: parseSignedPercent(nikkei.indexChangeToday),
    },
    13,
  )
  push(indexQuote('nasdaq'), 17)
  return cards
}

/** Right-panel quotes: real where datasets exist, local mock for FX/commodities/crypto. */
function buildCurrentMarkets(): DisplayQuote[] {
  const usdsek = indexQuote('usdsek')
  const bitcoin = indexQuote('bitcoin')
  return [
    usdsek
      ? { ...usdsek, icon: '🇺🇸' }
      : { id: 'usdsek', label: 'USD/SEK', value: '10,4127', changePercent: 0.19, icon: '🇺🇸' },
    { id: 'eurusd', label: 'EUR/USD', value: '1,0812', changePercent: -0.15, icon: '🇪🇺' },
    { id: 'brent', label: 'Brent Olja', value: '65,72', changePercent: 0.38, icon: '🛢️' },
    { id: 'gold', label: 'Guld (USD/oz)', value: '2 385,40', changePercent: 0.27, icon: '🥇' },
    bitcoin
      ? { ...bitcoin, label: 'Bitcoin (USD)', icon: '₿' }
      : { id: 'bitcoin', label: 'Bitcoin (USD)', value: '71 386,25', changePercent: 1.18, icon: '₿' },
  ]
}

/** 10Y U.S. from the real overview dataset; the rest are local mock yields. */
function buildRates(): Array<{ label: string; value: string; change: string; negative: boolean }> {
  const us10 = GLOBAL_MARKET_OVERVIEW.find((i) => i.id === '10y-us-yield')
  return [
    {
      label: '10Y U.S. Yield',
      value: us10?.value ?? '4,32%',
      change: us10?.change ?? '+0,00 bp',
      negative: us10?.tone === 'negative',
    },
    { label: '10Y Germany Yield', value: '2,48%', change: '−0,04 bp', negative: true },
    { label: '2Y U.S. Yield', value: '3,91%', change: '+0,01 bp', negative: false },
    { label: 'Sweden 10Y Yield', value: '2,34%', change: '+0,02 bp', negative: false },
  ]
}

/** Sector day-moves — local mock, S&P sector taxonomy. */
const SECTORS: Array<{ label: string; change: number; icon: typeof Cpu }> = [
  { label: 'Teknologi', change: 0.81, icon: Cpu },
  { label: 'Kommunikation', change: 0.68, icon: Radio },
  { label: 'Industri', change: 0.42, icon: Factory },
  { label: 'Finans', change: 0.27, icon: Landmark },
  { label: 'Sällanköp', change: 0.15, icon: ShoppingBag },
  { label: 'Hälsovård', change: -0.11, icon: Activity },
  { label: 'Fastigheter', change: -0.18, icon: Building2 },
  { label: 'Energi', change: -0.36, icon: Flame },
  { label: 'Dagligvaror', change: -0.47, icon: Package },
]

const INTRADAY_RANGES = ['1D', '1V', '1M', '3M', '1Å', 'YTD'] as const
type IntradayRange = (typeof INTRADAY_RANGES)[number]

// Series colours come from the shared, CVD-validated CATEGORICAL palette — no
// ad-hoc per-screen colours, and OMXS30 is no longer green (which collided with
// the semantic positive/up green).
const INTRADAY_SERIES = [
  { id: 'omxs30', label: 'OMXS30', color: CATEGORICAL[0] },
  { id: 'sp500', label: 'S&P 500', color: CATEGORICAL[1] },
  { id: 'dax', label: 'DAX', color: CATEGORICAL[2] },
  { id: 'nikkei', label: 'Nikkei 225', color: CATEGORICAL[3] },
]

function buildIntraday(range: IntradayRange) {
  const rangeSeed = INTRADAY_RANGES.indexOf(range) * 97 + 29
  const hours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']
  const points = hours.length * 4 - 3
  const series = INTRADAY_SERIES.map((s, index) => ({
    ...s,
    values: seededSeries(rangeSeed + index * 13, points, 0.08 + index * 0.01),
  }))
  return Array.from({ length: points }, (_, i) => {
    const row: Record<string, number | string> = {
      time: i % 4 === 0 ? (hours[i / 4] ?? '') : '',
    }
    for (const s of series) row[s.id] = Number((s.values[i] ?? 0).toFixed(2))
    return row
  })
}

/** Small dotted yield-curve preview under the rates panel. */
const RATE_CURVE = seededSeries(61, 14, 0.02)

/* ------------------------------------------------------------- sections — */

const NAV_ITEMS = [
  { to: '/', label: 'Översikt', icon: LayoutGrid },
  { to: '/markets', label: 'Marknader', icon: TrendingUp },
  { to: '/watchlist', label: 'Bevakning', icon: Star },
  { to: '/portfolio', label: 'Portfölj', icon: Briefcase },
  { to: '/agents', label: 'Analys', icon: BarChart3 },
  { to: '/reports', label: 'Nyheter', icon: Newspaper },
  { to: '/reports', label: 'Rapporter', icon: FileText },
  { to: '/settings', label: 'Aviseringar', icon: BellRing },
  { to: '/settings', label: 'Inställningar', icon: Settings },
] as const

/**
 * Left navigation column — logo, nav items, active state and profile. It is a
 * transparent layer that sits on top of the hero photograph, which is rendered
 * behind it at the page root (see the hero block in the component's return) so
 * the image can extend past the nav and dissolve into the dashboard.
 */
function Sidebar() {
  return (
    <aside className="relative z-10 hidden w-[306px] shrink-0 md:flex">
      {/* Nav sits on top of the hero image, which is rendered behind at the page root. */}
      <div className="flex w-[112px] flex-col items-center py-5">
        <Link
          to="/"
          aria-label="Översikt"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(240,151,66,0.35)] bg-[rgba(111,66,29,0.55)] text-[15px] font-bold text-[#ffb366] shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm"
        >
          HX
        </Link>
        <nav className="mt-8 flex flex-1 flex-col gap-1.5">
          {NAV_ITEMS.map((item, index) => {
            const Icon = item.icon
            const active = index === 0
            return (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  'flex w-[72px] flex-col items-center gap-1 rounded-xl py-2.5 transition-colors duration-200',
                  active
                    ? 'border border-[rgba(240,151,66,0.3)] bg-[rgba(111,66,29,0.55)] text-[#ffb366] shadow-[0_0_18px_rgba(240,151,66,0.14)] backdrop-blur-sm'
                    : 'border border-transparent text-[#c4d0dd] hover:bg-white/[0.06] hover:text-white',
                )}
              >
                <Icon
                  className="h-[18px] w-[18px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="text-[9px] font-medium tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>
        <div className="mt-4 flex flex-col items-center gap-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(70,130,163,0.35)] bg-[rgba(9,24,37,0.75)] text-[12px] font-semibold text-[#dbe4ee] backdrop-blur-sm">
            AS
          </span>
          <span className="text-center text-[8px] leading-tight text-[#c4d0dd] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            Anders
            <br />
            Private Banking
          </span>
        </div>
      </div>
    </aside>
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

function Header() {
  const now = useClock()
  const ref = now ?? new Date(COUNTRY_MOCK_NOW)
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
        <h1 className="text-[31px] font-semibold tracking-tight text-[#f4f7fb]">
          {greeting}, Anders
        </h1>
        <p className="mt-1 text-sm text-[#9aa7b7]">
          Här är din globala marknadsöversikt för idag, {dateText}.
        </p>
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
        <button
          type="button"
          aria-label="Sök"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[rgba(70,130,163,0.2)] bg-[rgba(4,14,23,0.7)] text-[#9aa7b7] transition-colors duration-200 hover:text-[#f4f7fb]"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Notiser"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[rgba(70,130,163,0.2)] bg-[rgba(4,14,23,0.7)] text-[#9aa7b7] transition-colors duration-200 hover:text-[#f4f7fb]"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
        </button>
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

/** Routes the intraday chart's hover through the shared ChartTooltip, on the
 *  Overview's own dark ground — one tooltip component, theme-aware surface. */
function IntradayTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: IntradayTooltipEntry[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <ChartTooltip
      surface="overview"
      title={String(label ?? '')}
      rows={payload.map((entry) => {
        const series = INTRADAY_SERIES.find((s) => s.id === entry.dataKey)
        return {
          label: series?.label ?? String(entry.dataKey),
          value: `${formatNumber(entry.value ?? 0, 2)} %`,
          color: series?.color,
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

export function LightCommandCenter() {
  const [mounted, setMounted] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [entry, setEntry] = useState<CountryRegistryEntry | null>(null)
  const [analysis, setAnalysis] = useState<CountryMacroData | null>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [range, setRange] = useState<IntradayRange>('1D')

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

  const marketCards = buildMarketCards()
  const currentMarkets = buildCurrentMarkets()
  const rates = buildRates()
  const news = getGlobalNewsFeed(4)
  const intraday = buildIntraday(range)
  const sentimentPosition = GLOBAL_RISK_SENTIMENT.position

  const tickerItems = [
    ...marketCards.map((c) => ({ label: c.label, value: c.value, change: c.changePercent })),
    ...currentMarkets
      .filter((c) => ['usdsek', 'eurusd', 'brent'].includes(c.id))
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
        <div
          className="absolute inset-0 bg-[length:auto_100%] bg-[position:-46px_center] bg-no-repeat"
          style={{ backgroundImage: `url(${WALL_STREET_PHOTO_URL})` }}
        />
        <div className="absolute inset-0 bg-black/[0.12]" />
        {/* Darker behind the nav band so the labels stay effortless to read. */}
        <div className="absolute inset-y-0 left-0 w-[160px] bg-gradient-to-r from-[rgba(3,7,14,0.62)] to-transparent" />
        {/* Long, gentle dissolve into the dashboard — starts later and eases in so
            the transition is almost imperceptible. */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent from-[47%] via-[rgba(4,10,18,0.55)] via-[70%] to-[#020711]" />
      </div>

      <Sidebar />

      <main className="relative z-10 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-8 pt-6 pb-16">
          <Header />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {/* Market overview cards. */}
            <SectionCard title="Marknadsöversikt" className="xl:col-span-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {marketCards.map((card) => (
                  <div key={card.id} className={cn(CARD_INNER, CARD_HOVER, 'p-3.5')}>
                    <p className="text-[12px] font-medium text-[#7f97ad]">{card.label}</p>
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
              <Link
                to="/markets"
                className="mt-4 inline-block text-[13px] font-medium text-[#48a7e8] transition-colors duration-200 hover:text-[#73a4ff]"
              >
                Visa alla marknader →
              </Link>
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
                  <LightGlobe onSelectCountry={selectCountry} reducedMotion={reducedMotion} />
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
                        <span aria-hidden="true" className="text-base leading-none">
                          {row.icon}
                        </span>
                        <span className="truncate">{row.label}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-semibold text-[#f4f7fb] tabular-nums">
                          {row.value}
                        </span>
                        <ChangeText value={row.changePercent} className="w-14 text-right text-[12px]" />
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title="Sentiment"
                action={
                  <span className="text-[13px] font-semibold" style={{ color: POSITIVE }}>
                    {GLOBAL_RISK_SENTIMENT.sentiment === 'risk-on'
                      ? 'Risk-on'
                      : GLOBAL_RISK_SENTIMENT.sentiment === 'risk-off'
                        ? 'Risk-off'
                        : 'Neutral'}
                  </span>
                }
              >
                <div className="relative flex h-2 gap-1">
                  {[
                    '#e0483f', '#ef6a3a', '#f5ad3a', '#e7d43c', '#a9d84a',
                    '#5fce6a', '#33c06a', '#27d879',
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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {/* Intraday chart. */}
            <SectionCard
              title="Utveckling idag"
              className="xl:col-span-5"
              action={
                <div
                  role="group"
                  aria-label="Tidsintervall"
                  className="flex gap-0.5 rounded-full border border-[rgba(70,130,163,0.2)] bg-[rgba(6,18,29,0.7)] p-0.5"
                >
                  {INTRADAY_RANGES.map((r) => (
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
                      {r}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={intraday} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
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
                      content={<IntradayTooltip />}
                      isAnimationActive={false}
                    />
                    {INTRADAY_SERIES.map((s) => (
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
                {INTRADAY_SERIES.map((s) => {
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
                    <span className="text-sm text-[#9aa7b7]">{rate.label}</span>
                    <span className="flex shrink-0 items-center gap-3">
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
                <Sparkline data={RATE_CURVE} trendUp width={260} height={40} />
              </div>
            </SectionCard>

            {/* Sectors. */}
            <SectionCard title="Sektorer (S&P 500)" className="xl:col-span-2">
              <ul className="flex flex-col gap-2">
                {SECTORS.map((sector) => {
                  const width = Math.min(100, (Math.abs(sector.change) / 0.9) * 100)
                  const Icon = sector.icon
                  return (
                    <li key={sector.label} className="flex items-center gap-2">
                      <Icon className="h-3 w-3 shrink-0 text-[#6b7d90]" aria-hidden="true" />
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
                        {item.source} ·{' '}
                        {formatRelativeTime(item.publishedAt, COUNTRY_MOCK_NOW)}
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
              <Link
                to="/watchlist"
                className="flex items-center gap-1.5 text-[12px] font-medium text-[#48a7e8] transition-colors duration-200 hover:text-[#73a4ff]"
              >
                Lägg till bevakning <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {watchlist.slice(0, 6).map((item) => (
                <div key={item.id} className={cn(CARD_INNER, CARD_HOVER, 'p-3.5')}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-[#dbe4ee]">
                      {item.name}
                    </p>
                    <span className="text-sm font-semibold text-[#f4f7fb] tabular-nums">
                      {formatNumber(item.price, 2)}
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
            <span key={item.label} className="flex shrink-0 items-center gap-2 text-[12px]">
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
          <span className="ml-auto shrink-0 text-[11px] text-[#5a6a7c]">
            Data uppdaterad{' '}
            {mounted
              ? new Intl.DateTimeFormat('sv-SE', {
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date())
              : '––:––'}
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
