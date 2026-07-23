import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BarChart3,
  Bell,
  Briefcase,
  Eye,
  FileText,
  Home,
  LineChart as LineChartIcon,
  Plus,
  Settings,
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
 * Wall Street photograph for the left column.
 * "Sign of the New York Stock Exchange, Broad Street" by Billie Grace Ward —
 * CC0 (public domain dedication, no attribution required), sourced from
 * Wikimedia Commons:
 * https://commons.wikimedia.org/wiki/File:Sign_of_the_New_York_Stock_Exchange,_Broad_Street.jpg
 * Set to null to fall back to the built-in architectural line art.
 */
const WALL_STREET_PHOTO_URL: string | null = '/data/wall-street.jpg'

const CARD =
  'rounded-[20px] border border-[#E9EEF5] bg-white shadow-[0_10px_40px_rgba(30,40,60,0.06)]'
const CARD_HOVER =
  'transition-all duration-250 hover:-translate-y-[3px] hover:shadow-[0_14px_44px_rgba(30,40,60,0.09)]'
const LABEL = 'text-[11px] font-medium tracking-[0.2em] uppercase text-[#5b7a9d]'

/* ------------------------------------------------------------------ data — */

/**
 * All figures below reuse the app's existing mock datasets wherever they
 * exist (indices, DAX/Nikkei country data, VIX/10Y overview, news, watch-
 * list, sentiment). Entries that have no dataset yet (FTSE, EUR/USD-style
 * pairs, commodities, extra yields, sector day-moves, intraday curves) are
 * local deterministic mock values, marked as such — same convention as the
 * rest of the mock layer.
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

/** Right-panel quotes: real where datasets exist, local mock for commodities. */
function buildCurrentMarkets(): DisplayQuote[] {
  const rows: DisplayQuote[] = []
  const usdsek = indexQuote('usdsek')
  if (usdsek) rows.push({ ...usdsek, icon: '🇺🇸' })
  const eursek = indexQuote('eursek')
  if (eursek) rows.push({ ...eursek, icon: '🇪🇺' })
  rows.push(
    { id: 'brent', label: 'Brent Olja', value: '65,72', changePercent: 0.38, icon: '🛢️' },
    { id: 'gold', label: 'Guld (USD/oz)', value: '2 385,40', changePercent: 0.27, icon: '🥇' },
  )
  const bitcoin = indexQuote('bitcoin')
  if (bitcoin) rows.push({ ...bitcoin, icon: '₿' })
  return rows
}

/** 10Y U.S. from the real overview dataset; the rest are local mock yields. */
function buildRates(): Array<{ label: string; value: string; change: string; negative: boolean }> {
  const us10 = GLOBAL_MARKET_OVERVIEW.find((i) => i.id === '10y-us-yield')
  return [
    {
      label: '10Y U.S. Yield',
      value: us10?.value ?? '4.32%',
      change: us10?.change ?? '+0.00 pp',
      negative: us10?.tone === 'negative',
    },
    { label: '10Y Germany Yield', value: '2,48 %', change: '−0,04 pp', negative: true },
    { label: '2Y U.S. Yield', value: '3,91 %', change: '+0,01 pp', negative: false },
    { label: 'Sweden 10Y Yield', value: '2,34 %', change: '+0,02 pp', negative: false },
  ]
}

/** Sector day-moves — local mock, S&P sector taxonomy. */
const SECTORS = [
  { label: 'Teknologi', change: 0.81 },
  { label: 'Kommunikation', change: 0.68 },
  { label: 'Industri', change: 0.42 },
  { label: 'Finans', change: 0.27 },
  { label: 'Sällanköp', change: 0.15 },
  { label: 'Hälsovård', change: -0.11 },
  { label: 'Fastigheter', change: -0.18 },
  { label: 'Energi', change: -0.36 },
  { label: 'Dagligvaror', change: -0.47 },
]

const INTRADAY_RANGES = ['1D', '1V', '1M', '3M', '1Å', 'YTD'] as const
type IntradayRange = (typeof INTRADAY_RANGES)[number]

const INTRADAY_SERIES = [
  { id: 'omxs30', label: 'OMXS30', color: '#16a34a' },
  { id: 'sp500', label: 'S&P 500', color: '#2563eb' },
  { id: 'dax', label: 'DAX', color: '#7c3aed' },
  { id: 'nikkei', label: 'Nikkei 225', color: '#0ea5e9' },
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

/* ------------------------------------------------------------- sections — */

function WallStreetPanel() {
  const navItems = [
    { to: '/', label: 'Hem', icon: Home },
    { to: '/markets', label: 'Marknad', icon: LineChartIcon },
    { to: '/watchlist', label: 'Bevakning', icon: Eye },
    { to: '/agents', label: 'Analys', icon: BarChart3 },
    { to: '/portfolio', label: 'Portfölj', icon: Briefcase },
    { to: '/reports', label: 'Rapporter', icon: FileText },
    { to: '/settings', label: 'Inställningar', icon: Settings },
  ]

  return (
    <aside className="relative hidden w-[20%] min-w-[230px] shrink-0 overflow-hidden lg:block">
      {/* Architectural fallback art — replaced by the licensed photograph once
          WALL_STREET_PHOTO_URL is configured. */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#eef4fb] via-[#f6f8fb] to-[#eef1f6]" />
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-[0.32]"
        preserveAspectRatio="xMidYMax slice"
        viewBox="0 0 100 200"
      >
        {[
          [4, 30, 15], [22, 16, 13], [38, 40, 12], [52, 8, 16], [71, 26, 14], [88, 44, 11],
        ].map(([x = 0, top = 20, w = 12]) => (
          <rect key={`b-${x}`} x={x} y={top} width={w} height={200 - top} fill="#cdd9e8" />
        ))}
        {[
          [7, 44], [10, 58], [25, 30], [28, 46], [41, 54], [44, 70], [55, 24],
          [58, 40], [74, 42], [77, 58], [90, 58], [93, 74],
        ].map(([x = 0, y = 40], i) => (
          <rect key={`w-${i}`} x={x} y={y} width={2} height={3} fill="#b3c4da" />
        ))}
        <rect x={30} y={96} width={2.4} height={64} fill="#9fb3c9" />
        <rect x={16} y={100} width={30} height={7} rx={1.4} fill="#8199b3" />
        <rect x={20} y={112} width={26} height={6.5} rx={1.4} fill="#93a9c0" />
        <path d="M60 118 L60 160 L84 160 L84 118 L72 108 Z" fill="#c2d2e4" />
        {[63, 68.5, 74, 79.5].map((x) => (
          <rect key={`c-${x}`} x={x} y={122} width={2.4} height={36} fill="#a9bed4" />
        ))}
      </svg>
      {WALL_STREET_PHOTO_URL && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${WALL_STREET_PHOTO_URL})` }}
        />
      )}
      <div className="absolute inset-0 bg-white/30" />
      {/* Readability ramp behind the nav rail. */}
      <div className="absolute inset-y-0 left-0 w-3/4 bg-gradient-to-r from-white/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#FAFAFA]" />

      <nav className="relative flex h-full flex-col px-6 py-8">
        <Link to="/" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2563eb] text-lg font-bold text-white shadow-[0_10px_30px_rgba(37,99,235,0.35)]">
          S
        </Link>
        <ul className="mt-12 flex flex-col gap-2.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = item.to === '/'
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl px-4 py-3 text-[13px] font-medium transition-colors duration-250',
                    active
                      ? 'bg-white text-[#1d4ed8] shadow-[0_10px_30px_rgba(30,40,60,0.08)]'
                      : 'bg-white/40 text-slate-700 backdrop-blur-[2px] hover:bg-white/75 hover:text-slate-900',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="mt-auto flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-3 shadow-[0_10px_30px_rgba(30,40,60,0.07)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1d4ed8] text-xs font-semibold text-white">
            M
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-slate-800">
              Martin
            </span>
            <span className="block text-[11px] text-slate-500">Private Banking</span>
          </span>
        </div>
      </nav>
    </aside>
  )
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function Header() {
  const now = useClock()
  const hour = now.getHours()
  const greeting = hour < 10 ? 'God morgon' : hour < 18 ? 'God eftermiddag' : 'God kväll'
  const dateText = new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
  const openCount = MARKET_CENTERS.filter(
    (center) => getMarketStatus(center, now) === 'OPEN',
  ).length
  const clock = new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Stockholm',
  }).format(now)

  return (
    <header className="flex flex-wrap items-start justify-between gap-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">
          {greeting}, Martin
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Här är din marknadsöversikt för idag, {dateText}
        </p>
      </div>
      <div className="flex items-center gap-6">
        <span className="flex items-center gap-2 text-[12px] font-medium tracking-[0.14em] text-slate-600 uppercase">
          <span
            aria-hidden="true"
            className={cn(
              'h-2 w-2 rounded-full',
              openCount > 0 ? 'bg-[#16a34a]' : 'bg-[#dc2626]',
            )}
          />
          {openCount > 0 ? 'Marknader öppna' : 'Marknader stängda'}
        </span>
        <span className="text-right">
          <span className="block text-xl font-semibold text-slate-900 tabular-nums">
            {clock}
          </span>
          <span className="block text-[11px] text-slate-500">Stockholm</span>
        </span>
        <button
          type="button"
          aria-label="Notiser"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[#E9EEF5] bg-white text-slate-600 shadow-[0_10px_40px_rgba(30,40,60,0.06)] transition-colors duration-250 hover:text-slate-900"
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
      className={cn(
        'font-medium tabular-nums',
        value >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]',
        className,
      )}
    >
      {formatPercent(value)}
    </span>
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
    <section className={cn(CARD, 'p-6', className)}>
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

  return (
    <div className="flex min-h-screen bg-[#FAFAFA] font-sans text-slate-900 antialiased">
      <WallStreetPanel />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1560px] flex-col gap-8 p-10">
          <Header />

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
            {/* Market cards. */}
            <SectionCard title="Marknadsöversikt" className="xl:col-span-5">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {marketCards.map((card) => (
                  <div
                    key={card.id}
                    className={cn(
                      'rounded-2xl border border-[#E9EEF5] bg-white p-4',
                      CARD_HOVER,
                    )}
                  >
                    <p className="text-[11px] font-medium tracking-[0.08em] text-slate-500 uppercase">
                      {card.label}
                    </p>
                    <p className="mt-1.5 text-lg font-semibold text-slate-900 tabular-nums">
                      {card.value}
                    </p>
                    <ChangeText value={card.changePercent} className="text-[13px]" />
                    <div className="mt-2">
                      <Sparkline
                        data={card.spark}
                        trendUp={card.changePercent >= 0}
                        width={104}
                        height={26}
                        area
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Link
                to="/markets"
                className="mt-4 inline-block text-[13px] font-medium text-[#2563eb] transition-colors duration-250 hover:text-[#1d4ed8]"
              >
                Visa fler marknader →
              </Link>
            </SectionCard>

            {/* Globe centerpiece. */}
            <div className="relative min-h-[420px] xl:col-span-4">
              {/* Soft grounding shadow beneath the globe — pale blue, wide, airy. */}
              <div
                aria-hidden="true"
                className="absolute bottom-6 left-1/2 h-9 w-2/3 -translate-x-1/2 rounded-[50%] blur-2xl"
                style={{ background: 'rgba(90, 150, 220, 0.14)' }}
              />
              {mounted && (
                <Suspense fallback={null}>
                  <LightGlobe
                    onSelectCountry={selectCountry}
                    reducedMotion={reducedMotion}
                  />
                </Suspense>
              )}
              <p className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[11px] text-slate-400">
                Dra för att rotera · klicka på ett land för analys
              </p>
            </div>

            {/* Right column. */}
            <div className="flex flex-col gap-8 xl:col-span-3">
              <SectionCard title="Aktuella marknader">
                <ul className="flex flex-col">
                  {currentMarkets.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 border-t border-[#EFF3F8] py-2.5 first:border-t-0"
                    >
                      <span className="flex min-w-0 items-center gap-2.5 text-sm text-slate-700">
                        <span aria-hidden="true" className="text-base leading-none">
                          {row.icon}
                        </span>
                        <span className="truncate">{row.label}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {row.value}
                        </span>
                        <ChangeText value={row.changePercent} className="text-[12px]" />
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title="Sentiment"
                action={
                  <span className="text-[13px] font-semibold text-[#16a34a]">
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
                    '#dc2626', '#ef4444', '#f59e0b', '#facc15', '#a3e635',
                    '#4ade80', '#22c55e', '#16a34a',
                  ].map((color) => (
                    <span
                      key={color}
                      aria-hidden="true"
                      className="h-full flex-1 rounded-full"
                      style={{ background: color, opacity: 0.75 }}
                    />
                  ))}
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-800"
                    style={{ left: `${sentimentPosition}%` }}
                  />
                </div>
              </SectionCard>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
            {/* Intraday chart. */}
            <SectionCard
              title="Utveckling idag"
              className="xl:col-span-5"
              action={
                <div className="flex gap-1 rounded-full border border-[#E9EEF5] bg-[#F6F8FB] p-1">
                  {INTRADAY_RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRange(r)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-250',
                        r === range
                          ? 'bg-white text-slate-900 shadow-[0_4px_14px_rgba(30,40,60,0.1)]'
                          : 'text-slate-500 hover:text-slate-800',
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={intraday} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="#EEF2F7" vertical={false} />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tickFormatter={(value: string) => value}
                    />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) => `${value.toFixed(1)}%`}
                    />
                    <Tooltip
                      cursor={{ stroke: '#cbd5e1' }}
                      contentStyle={{
                        borderRadius: 12,
                        border: '1px solid #E9EEF5',
                        boxShadow: '0 10px 40px rgba(30,40,60,0.1)',
                        fontSize: 12,
                      }}
                      formatter={(value, name) => [
                        `${Number(value ?? 0).toFixed(2)}%`,
                        INTRADAY_SERIES.find((s) => s.id === name)?.label ??
                          String(name),
                      ]}
                    />
                    {INTRADAY_SERIES.map((s) => (
                      <Line
                        key={s.id}
                        type="monotone"
                        dataKey={s.id}
                        stroke={s.color}
                        strokeWidth={1.6}
                        dot={false}
                        isAnimationActive={!reducedMotion}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-[#EFF3F8] pt-3">
                {INTRADAY_SERIES.map((s) => {
                  const card = marketCards.find((c) => c.id === s.id)
                  return (
                    <span key={s.id} className="flex items-center gap-2 text-[12px]">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ background: s.color }}
                      />
                      <span className="text-slate-600">{s.label}</span>
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
                    className="flex items-center justify-between gap-3 border-t border-[#EFF3F8] py-3 first:border-t-0"
                  >
                    <span className="text-sm text-slate-600">{rate.label}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold text-slate-900 tabular-nums">
                        {rate.value}
                      </span>
                      <span
                        className={cn(
                          'text-[12px] font-medium tabular-nums',
                          rate.negative ? 'text-[#dc2626]' : 'text-[#16a34a]',
                        )}
                      >
                        {rate.change}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>

            {/* Sectors. */}
            <SectionCard title="Sektorer (S&P 500)" className="xl:col-span-2">
              <ul className="flex flex-col gap-2.5">
                {SECTORS.map((sector) => {
                  const width = Math.min(100, (Math.abs(sector.change) / 0.9) * 100)
                  return (
                    <li key={sector.label} className="flex items-center gap-2">
                      <span className="w-20 truncate text-[12px] text-slate-600">
                        {sector.label}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EFF3F8]">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${width}%`,
                            background: sector.change >= 0 ? '#22c55e' : '#f87171',
                          }}
                        />
                      </span>
                      <span
                        className={cn(
                          'w-14 text-right text-[11px] font-medium whitespace-nowrap tabular-nums',
                          sector.change >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]',
                        )}
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
                  className="text-[12px] font-medium text-[#2563eb] transition-colors duration-250 hover:text-[#1d4ed8]"
                >
                  Visa fler →
                </Link>
              }
            >
              <ul className="flex flex-col">
                {news.map((item) => (
                  <li
                    key={item.id}
                    className="border-t border-[#EFF3F8] py-3 first:border-t-0"
                  >
                    <p className="line-clamp-2 text-[13px] leading-snug font-medium text-slate-800">
                      {item.headline}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          item.importance === 'critical'
                            ? 'bg-[#dc2626]'
                            : item.importance === 'high'
                              ? 'bg-[#f59e0b]'
                              : 'bg-[#94a3b8]',
                        )}
                      />
                      {item.source} ·{' '}
                      {formatRelativeTime(item.publishedAt, COUNTRY_MOCK_NOW)}
                    </p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          {/* Watchlist row. */}
          <SectionCard
            title="Följda aktier"
            action={
              <Link
                to="/watchlist"
                className="flex items-center gap-1.5 text-[12px] font-medium text-[#2563eb] transition-colors duration-250 hover:text-[#1d4ed8]"
              >
                Lägg till bevakning <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              {watchlist.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className={cn('rounded-2xl border border-[#E9EEF5] bg-white p-4', CARD_HOVER)}
                >
                  <p className="truncate text-[13px] font-semibold text-slate-800">
                    {item.name}
                  </p>
                  <p className="text-[11px] text-slate-500">{item.ticker}</p>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {formatNumber(item.price, 2)}
                    </span>
                    <ChangeText value={item.changePercent} className="text-[12px]" />
                  </div>
                  <div className="mt-2">
                    <Sparkline
                      data={item.spark}
                      trendUp={item.changePercent >= 0}
                      width={96}
                      height={20}
                    />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </main>

      {/* Country analysis — the full existing analyzer, presented as a modal. */}
      {analysisOpen && entry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6 backdrop-blur-sm"
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
