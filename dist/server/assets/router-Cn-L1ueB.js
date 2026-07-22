import { Link, createRootRoute, Outlet, HeadContent, Scripts, createFileRoute, lazyRouteComponent, createRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { useRef, useId, useState, useEffect } from "react";
import { Menu, RefreshCw, Sparkles, Search, LayoutDashboard, Bot, Wallet, LineChart, Eye, FileText, PanelLeft, Settings, X } from "lucide-react";
import clsx from "clsx";
function cn(...inputs) {
  return clsx(inputs);
}
const VARIANTS = {
  primary: "bg-accent-solid text-white hover:bg-accent-hover",
  secondary: "bg-surface-2 text-content hover:bg-surface-3",
  ghost: "text-content-muted hover:bg-surface-2 hover:text-content"
};
const SIZES = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2"
};
function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  children,
  ...props
}) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      type,
      className: cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className
      ),
      ...props,
      children
    }
  );
}
function IconButton({ label, className, children, ...props }) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      "aria-label": label,
      title: label,
      className: cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg",
        "text-content-subtle transition-colors duration-150",
        "hover:bg-surface-2 hover:text-content",
        className
      ),
      ...props,
      children
    }
  );
}
const CATEGORICAL = [
  "#5f71d8",
  // 1 — indigo
  "#00a0b5",
  // 2 — cyan
  "#af4aba",
  // 3 — magenta
  "#3f821e",
  // 4 — olive
  "#b08b34"
  // 5 — bronze
];
const STATUS = {
  positive: "#2ecc84",
  negative: "#f2555a"
};
const CHART_SURFACE = "#10151f";
const CHART_GRID = "#222b3b";
const CHART_AXIS_TEXT = "#818da1";
const SERIES = {
  portfolio: CATEGORICAL[0],
  benchmark: CATEGORICAL[1]
};
const MOCK_NOW = /* @__PURE__ */ new Date("2025-03-14T16:40:00+01:00");
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const portfolioSummary = {
  totalValue: 2847320,
  dayChange: 18940,
  dayChangePercent: 0.67,
  monthChangePercent: 3.42,
  investedCapital: 231e4,
  cashBalance: 184500,
  buyingPower: 246800,
  unrealizedResult: 352820,
  unrealizedResultPercent: 15.27,
  currency: "SEK"
};
const marketStatus = {
  label: "Stockholmsbörsen öppen",
  detail: "Stänger 17:30 CET"
};
const marketIndices = [
  { id: "omxs30", name: "OMXS30", value: 2612.48, changePercent: 0.74, precision: 2 },
  { id: "sp500", name: "S&P 500", value: 5843.12, changePercent: 0.41, precision: 2 },
  {
    id: "nasdaq",
    name: "Nasdaq 100",
    value: 20418.65,
    changePercent: -0.28,
    precision: 2
  },
  { id: "eursek", name: "EUR/SEK", value: 11.2384, changePercent: -0.12, precision: 4 },
  { id: "usdsek", name: "USD/SEK", value: 10.4127, changePercent: 0.19, precision: 4 },
  {
    id: "btc",
    name: "Bitcoin",
    value: 843200,
    changePercent: 2.14,
    precision: 0,
    currency: "SEK"
  }
];
const allocation = [
  {
    id: "se-equity",
    label: "Svenska aktier",
    value: 1082e3,
    percent: 38,
    color: CATEGORICAL[0]
  },
  {
    id: "global-equity",
    label: "Globala aktier",
    value: 740300,
    percent: 26,
    color: CATEGORICAL[1]
  },
  { id: "funds", label: "Fonder", value: 512500, percent: 18, color: CATEGORICAL[2] },
  { id: "etf", label: "ETF:er", value: 328020, percent: 11.5, color: CATEGORICAL[3] },
  {
    id: "cash",
    label: "Likvida medel",
    value: 184500,
    percent: 6.5,
    color: CATEGORICAL[4]
  }
];
const watchlist = [
  {
    id: "inve-b",
    name: "Investor B",
    ticker: "INVE B",
    price: 289.4,
    changePercent: 1.12,
    currency: "SEK",
    spark: [281, 283, 282, 286, 285, 288, 287, 289.4],
    signal: "buy"
  },
  {
    id: "volv-b",
    name: "Volvo B",
    ticker: "VOLV B",
    price: 274.85,
    changePercent: -0.63,
    currency: "SEK",
    spark: [278, 277, 279, 276, 275, 276, 275, 274.85],
    signal: "hold"
  },
  {
    id: "evo",
    name: "Evolution",
    ticker: "EVO",
    price: 812.2,
    changePercent: 2.48,
    currency: "SEK",
    spark: [782, 788, 795, 790, 801, 806, 809, 812.2],
    signal: "buy"
  },
  {
    id: "avanza",
    name: "Avanza Bank",
    ticker: "AZA",
    price: 268.9,
    changePercent: 0.34,
    currency: "SEK",
    spark: [266, 267, 266.5, 268, 267.5, 269, 268.4, 268.9],
    signal: "watch"
  },
  {
    id: "atco-a",
    name: "Atlas Copco A",
    ticker: "ATCO A",
    price: 178.15,
    changePercent: -1.24,
    currency: "SEK",
    spark: [181, 180.5, 181.2, 179.8, 179, 178.6, 178.9, 178.15],
    signal: "sell"
  },
  {
    id: "seb-a",
    name: "SEB A",
    ticker: "SEB A",
    price: 158.6,
    changePercent: 0.88,
    currency: "SEK",
    spark: [155, 156, 155.8, 157, 157.4, 158, 158.2, 158.6],
    signal: "hold"
  }
];
const agents = [
  {
    id: "market-analyst",
    name: "Marknadsanalytiker",
    role: "Bevakar index, sektorer och rapportflöde",
    status: "running",
    activity: "Läser kvartalsrapporter från verkstadssektorn",
    lastRunAt: "2025-03-14T16:32:00+01:00",
    progress: 64
  },
  {
    id: "portfolio-agent",
    name: "Portföljagent",
    role: "Granskar innehav, vikter och exponering",
    status: "finished",
    activity: "Genomgång av innehav klar",
    result: "2 uppslag hittade",
    lastRunAt: "2025-03-14T16:12:00+01:00"
  },
  {
    id: "risk-agent",
    name: "Riskagent",
    role: "Följer koncentration, volatilitet och nedsidesrisk",
    status: "waiting",
    activity: "Väntar på stängningskurser",
    lastRunAt: "2025-03-13T17:35:00+01:00"
  },
  {
    id: "news-agent",
    name: "Nyhetsagent",
    role: "Filtrerar nyhetsflödet mot dina innehav",
    status: "finished",
    activity: "Dagens genomgång klar",
    result: "4 viktiga händelser idag",
    lastRunAt: "2025-03-14T15:58:00+01:00"
  },
  {
    id: "earnings-agent",
    name: "Rapportagent",
    role: "Sammanfattar kommande och släppta rapporter",
    status: "failed",
    activity: "Datakällan svarade inte",
    lastRunAt: "2025-03-14T09:20:00+01:00"
  }
];
const recentAnalyses = [
  {
    id: "an-1",
    instrument: "Evolution",
    ticker: "EVO",
    type: "Fundamental analys",
    generatedAt: "2025-03-14T15:42:00+01:00",
    status: "completed"
  },
  {
    id: "an-2",
    instrument: "Volvo B",
    ticker: "VOLV B",
    type: "Teknisk analys",
    generatedAt: "2025-03-14T14:18:00+01:00",
    status: "completed"
  },
  {
    id: "an-3",
    instrument: "Investor B",
    ticker: "INVE B",
    type: "Substansvärdering",
    generatedAt: "2025-03-14T13:05:00+01:00",
    status: "running"
  },
  {
    id: "an-4",
    instrument: "Atlas Copco A",
    ticker: "ATCO A",
    type: "Riskgenomlysning",
    generatedAt: "2025-03-14T11:30:00+01:00",
    status: "queued"
  },
  {
    id: "an-5",
    instrument: "SEB A",
    ticker: "SEB A",
    type: "Sektorjämförelse",
    generatedAt: "2025-03-13T17:02:00+01:00",
    status: "failed"
  }
];
const marketTrends = [
  {
    id: "momentum",
    label: "Momentum",
    value: "Stigande",
    description: "Andelen bolag över MA50 har ökat fyra dagar i rad.",
    strength: 72,
    tone: "positive",
    trend: "up"
  },
  {
    id: "volatility",
    label: "Volatilitet",
    value: "Förhöjd",
    description: "Implicit volatilitet ligger över tremånaderssnittet.",
    strength: 58,
    tone: "warning",
    trend: "up"
  },
  {
    id: "breadth",
    label: "Bredd",
    value: "Neutral",
    description: "54 % av OMXS30-bolagen stiger under dagen.",
    strength: 54,
    tone: "neutral",
    trend: "flat"
  },
  {
    id: "volume",
    label: "Omsättning",
    value: "Under snitt",
    description: "Handelsvolymen är 12 % lägre än tjugodagarssnittet.",
    strength: 38,
    tone: "negative",
    trend: "down"
  }
];
const instrumentUniverse = [
  {
    id: "inve-b",
    name: "Investor B",
    ticker: "INVE B",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "volv-b",
    name: "Volvo B",
    ticker: "VOLV B",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "evo",
    name: "Evolution",
    ticker: "EVO",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "avanza",
    name: "Avanza Bank",
    ticker: "AZA",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "atco-a",
    name: "Atlas Copco A",
    ticker: "ATCO A",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "seb-a",
    name: "SEB A",
    ticker: "SEB A",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "hm-b",
    name: "H&M B",
    ticker: "HM B",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "eric-b",
    name: "Ericsson B",
    ticker: "ERIC B",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "assa-b",
    name: "Assa Abloy B",
    ticker: "ASSA B",
    type: "stock",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "avanza-global",
    name: "Avanza Global",
    ticker: "AVGLOB",
    type: "fund",
    market: "Fond",
    currency: "SEK"
  },
  {
    id: "xact-norden",
    name: "XACT Norden 30",
    ticker: "XACTNORDEN",
    type: "etf",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "omxs30",
    name: "OMXS30",
    ticker: "OMXS30",
    type: "index",
    market: "Stockholm",
    currency: "SEK"
  },
  {
    id: "usdsek",
    name: "USD/SEK",
    ticker: "USDSEK",
    type: "currency",
    market: "FX",
    currency: "SEK"
  },
  {
    id: "btc",
    name: "Bitcoin",
    ticker: "BTC",
    type: "crypto",
    market: "Krypto",
    currency: "SEK"
  }
];
const holdings = [
  {
    id: "inve-b",
    name: "Investor B",
    ticker: "INVE B",
    quantity: 1200,
    averagePrice: 231.4,
    lastPrice: 289.4,
    marketValue: 347280,
    changePercent: 1.12,
    weight: 12.2,
    currency: "SEK"
  },
  {
    id: "volv-b",
    name: "Volvo B",
    ticker: "VOLV B",
    quantity: 900,
    averagePrice: 248.1,
    lastPrice: 274.85,
    marketValue: 247365,
    changePercent: -0.63,
    weight: 8.7,
    currency: "SEK"
  },
  {
    id: "evo",
    name: "Evolution",
    ticker: "EVO",
    quantity: 310,
    averagePrice: 924.5,
    lastPrice: 812.2,
    marketValue: 251782,
    changePercent: 2.48,
    weight: 8.8,
    currency: "SEK"
  },
  {
    id: "atco-a",
    name: "Atlas Copco A",
    ticker: "ATCO A",
    quantity: 1500,
    averagePrice: 152.3,
    lastPrice: 178.15,
    marketValue: 267225,
    changePercent: -1.24,
    weight: 9.4,
    currency: "SEK"
  },
  {
    id: "avanza-global",
    name: "Avanza Global",
    ticker: "AVGLOB",
    quantity: 2400,
    averagePrice: 198.2,
    lastPrice: 241.7,
    marketValue: 580080,
    changePercent: 0.42,
    weight: 20.4,
    currency: "SEK"
  },
  {
    id: "xact-norden",
    name: "XACT Norden 30",
    ticker: "XACTNORDEN",
    quantity: 1800,
    averagePrice: 168.4,
    lastPrice: 182.24,
    marketValue: 328032,
    changePercent: 0.61,
    weight: 11.5,
    currency: "SEK"
  }
];
const reports = [
  {
    id: "rep-1",
    title: "Månadsrapport portfölj – februari",
    type: "Portföljrapport",
    createdAt: "2025-03-01T09:00:00+01:00",
    status: "completed",
    pages: 14
  },
  {
    id: "rep-2",
    title: "Sektoranalys: svensk verkstad",
    type: "Sektoranalys",
    createdAt: "2025-03-08T11:20:00+01:00",
    status: "completed",
    pages: 22
  },
  {
    id: "rep-3",
    title: "Riskgenomlysning Q1",
    type: "Riskrapport",
    createdAt: "2025-03-12T14:45:00+01:00",
    status: "running",
    pages: 0
  },
  {
    id: "rep-4",
    title: "Utdelningsöversikt 2025",
    type: "Utdelningar",
    createdAt: "2025-03-13T08:15:00+01:00",
    status: "queued",
    pages: 0
  }
];
const RANGE_CONFIG = {
  "1D": {
    points: 26,
    seed: 11,
    drift: 0.7,
    label: (i) => {
      const start = 9 * 60;
      const minutes = start + i * 20;
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
  },
  "1W": {
    points: 28,
    seed: 23,
    drift: 1.6,
    label: (i, n) => dayLabel(i, n, 7)
  },
  "1M": { points: 30, seed: 37, drift: 4.1, label: (i, n) => dayLabel(i, n, 30) },
  "3M": { points: 45, seed: 53, drift: 7.8, label: (i, n) => dayLabel(i, n, 90) },
  "1Y": { points: 52, seed: 71, drift: 18.4, label: (i, n) => dayLabel(i, n, 365) },
  ALL: { points: 60, seed: 97, drift: 46.2, label: (i, n) => dayLabel(i, n, 365 * 5) }
};
function dayLabel(index, total, spanDays) {
  const daysBack = Math.round((total - 1 - index) / Math.max(total - 1, 1) * spanDays);
  const date = new Date(MOCK_NOW);
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}
function getPerformanceSeries(range) {
  const config = RANGE_CONFIG[range];
  const random = createRandom(config.seed);
  const points = [];
  let portfolio = 100;
  let benchmark = 100;
  for (let i = 0; i < config.points; i += 1) {
    const progress = i / Math.max(config.points - 1, 1);
    const noise = (random() - 0.5) * (config.drift / 3);
    const benchNoise = (random() - 0.5) * (config.drift / 3.6);
    portfolio = 100 + config.drift * progress + noise * 2;
    benchmark = 100 + config.drift * 0.72 * progress + benchNoise * 2;
    points.push({
      t: config.label(i, config.points),
      portfolio: Number(portfolio.toFixed(2)),
      benchmark: Number(benchmark.toFixed(2))
    });
  }
  return points;
}
function searchInstrumentsLocal(query, limit = 6) {
  const q = query.trim().toLocaleLowerCase("sv-SE");
  if (!q) return [];
  return instrumentUniverse.filter(
    (instrument) => instrument.name.toLocaleLowerCase("sv-SE").includes(q) || instrument.ticker.toLocaleLowerCase("sv-SE").includes(q)
  ).slice(0, limit);
}
const INSTRUMENT_TYPE_LABEL = {
  stock: "Aktie",
  fund: "Fond",
  etf: "ETF",
  index: "Index",
  currency: "Valuta",
  crypto: "Krypto"
};
function AppHeader({ onOpenMobileNav }) {
  return /* @__PURE__ */ jsxs("header", { className: "sticky top-0 z-30 flex h-16 items-center gap-4 bg-canvas/90 px-6 backdrop-blur-md", children: [
    /* @__PURE__ */ jsx(IconButton, { label: "Öppna menyn", onClick: onOpenMobileNav, className: "lg:hidden", children: /* @__PURE__ */ jsx(Menu, { className: "h-4 w-4", "aria-hidden": "true" }) }),
    /* @__PURE__ */ jsx(InstrumentSearch, {}),
    /* @__PURE__ */ jsxs("div", { className: "ml-auto flex items-center gap-3", children: [
      /* @__PURE__ */ jsx(MarketStatusIndicator, {}),
      /* @__PURE__ */ jsx(IconButton, { label: "Uppdatera data", children: /* @__PURE__ */ jsx(RefreshCw, { className: "h-4 w-4", "aria-hidden": "true" }) }),
      /* @__PURE__ */ jsxs(Button, { variant: "primary", size: "sm", children: [
        /* @__PURE__ */ jsx(Sparkles, { className: "h-3.5 w-3.5", "aria-hidden": "true" }),
        "Ny analys"
      ] })
    ] })
  ] });
}
function MarketStatusIndicator() {
  const { label, detail } = marketStatus;
  return /* @__PURE__ */ jsxs(
    "span",
    {
      className: "hidden items-center gap-2 text-xs text-content-muted md:inline-flex",
      title: detail,
      children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            "aria-hidden": "true",
            className: cn(
              "h-1.5 w-1.5 rounded-full",
              "bg-positive"
            )
          }
        ),
        label
      ]
    }
  );
}
function InstrumentSearch() {
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = searchInstrumentsLocal(query);
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  const showResults = open && query.trim().length > 0;
  return /* @__PURE__ */ jsxs("div", { ref: containerRef, className: "relative w-full max-w-sm", children: [
    /* @__PURE__ */ jsxs("search", { children: [
      /* @__PURE__ */ jsx("label", { htmlFor: `${listId}-input`, className: "sr-only", children: "Sök instrument" }),
      /* @__PURE__ */ jsxs("div", { className: "relative", children: [
        /* @__PURE__ */ jsx(
          Search,
          {
            className: "pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-content-subtle",
            "aria-hidden": "true"
          }
        ),
        /* @__PURE__ */ jsx(
          "input",
          {
            id: `${listId}-input`,
            ref: inputRef,
            type: "search",
            role: "combobox",
            "aria-expanded": showResults,
            "aria-controls": listId,
            autoComplete: "off",
            value: query,
            placeholder: "Sök…",
            onChange: (event) => {
              setQuery(event.target.value);
              setOpen(true);
            },
            onFocus: () => setOpen(true),
            className: cn(
              "h-9 w-full rounded-lg bg-surface pr-14 pl-9 text-sm text-content",
              "placeholder:text-content-subtle transition-colors duration-150",
              "hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
              "[&::-webkit-search-cancel-button]:appearance-none"
            )
          }
        ),
        /* @__PURE__ */ jsx("kbd", { className: "pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 font-sans text-[11px] text-content-subtle sm:block", children: "⌘K" })
      ] })
    ] }),
    showResults && /* @__PURE__ */ jsx(
      "ul",
      {
        id: listId,
        role: "listbox",
        "aria-label": "Sökresultat",
        className: "absolute top-12 left-0 z-40 w-full overflow-hidden rounded-lg bg-surface-2 p-1 shadow-pop",
        children: results.length === 0 ? /* @__PURE__ */ jsxs("li", { className: "px-3 py-2.5 text-sm text-content-muted", children: [
          "Inga träffar för ”",
          query,
          "”."
        ] }) : results.map((instrument) => /* @__PURE__ */ jsx("li", { role: "option", "aria-selected": false, children: /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            onClick: () => {
              setQuery(instrument.name);
              setOpen(false);
            },
            className: "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-3",
            children: [
              /* @__PURE__ */ jsxs("span", { className: "min-w-0", children: [
                /* @__PURE__ */ jsx("span", { className: "block truncate text-sm text-content", children: instrument.name }),
                /* @__PURE__ */ jsx("span", { className: "block text-xs text-content-subtle", children: instrument.ticker })
              ] }),
              /* @__PURE__ */ jsx("span", { className: "shrink-0 text-xs text-content-subtle", children: INSTRUMENT_TYPE_LABEL[instrument.type] })
            ]
          }
        ) }, instrument.id))
      }
    )
  ] });
}
const primaryNav = [
  { to: "/", label: "Översikt", icon: LayoutDashboard },
  { to: "/agents", label: "Agenter", icon: Bot },
  { to: "/portfolio", label: "Portfölj", icon: Wallet },
  { to: "/markets", label: "Marknader", icon: LineChart },
  { to: "/watchlist", label: "Bevakning", icon: Eye },
  { to: "/reports", label: "Rapporter", icon: FileText }
];
function AppSidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate
}) {
  return /* @__PURE__ */ jsxs("div", { className: "flex h-full flex-col bg-canvas", children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        className: cn(
          "flex h-16 items-center px-4",
          collapsed ? "justify-center" : "justify-between"
        ),
        children: [
          /* @__PURE__ */ jsxs(
            Link,
            {
              to: "/",
              onClick: onNavigate,
              className: "flex items-center gap-2.5 rounded-sm",
              "aria-label": "Stack – till översikten",
              children: [
                /* @__PURE__ */ jsx(Logo, {}),
                !collapsed && /* @__PURE__ */ jsx("span", { className: "text-[15px] font-semibold tracking-tight text-content", children: "Stack" })
              ]
            }
          ),
          !collapsed && /* @__PURE__ */ jsx(IconButton, { label: "Fäll ihop sidopanelen", onClick: onToggleCollapsed, children: /* @__PURE__ */ jsx(PanelLeft, { className: "h-4 w-4", "aria-hidden": "true" }) })
        ]
      }
    ),
    collapsed && /* @__PURE__ */ jsx("div", { className: "flex justify-center pb-2", children: /* @__PURE__ */ jsx(IconButton, { label: "Expandera sidopanelen", onClick: onToggleCollapsed, children: /* @__PURE__ */ jsx(PanelLeft, { className: "h-4 w-4", "aria-hidden": "true" }) }) }),
    /* @__PURE__ */ jsx("nav", { "aria-label": "Huvudnavigation", className: "flex-1 overflow-y-auto px-3 py-2", children: /* @__PURE__ */ jsx("ul", { className: "flex flex-col gap-0.5", children: primaryNav.map((item) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(SidebarLink, { item, collapsed, onNavigate }) }, item.to)) }) }),
    /* @__PURE__ */ jsx("div", { className: cn("px-3 py-4", collapsed ? "flex justify-center" : ""), children: /* @__PURE__ */ jsx(
      Link,
      {
        to: "/settings",
        onClick: onNavigate,
        "aria-label": "Inställningar",
        title: "Inställningar",
        className: "inline-flex h-8 w-8 items-center justify-center rounded-md text-content-subtle transition-colors duration-150 hover:bg-surface-2 hover:text-content",
        activeProps: { className: "text-content" },
        children: /* @__PURE__ */ jsx(Settings, { className: "h-4 w-4", "aria-hidden": "true" })
      }
    ) })
  ] });
}
function Logo() {
  return /* @__PURE__ */ jsx(
    "span",
    {
      className: "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-solid",
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsxs("svg", { viewBox: "0 0 16 16", className: "h-3.5 w-3.5", fill: "none", children: [
        /* @__PURE__ */ jsx("path", { d: "M2 5.5 8 2.5l6 3-6 3-6-3Z", fill: "white", fillOpacity: "0.95" }),
        /* @__PURE__ */ jsx(
          "path",
          {
            d: "M2 10.5 8 13.5l6-3",
            stroke: "white",
            strokeOpacity: "0.55",
            strokeWidth: "1.5",
            strokeLinecap: "round",
            strokeLinejoin: "round"
          }
        )
      ] })
    }
  );
}
function SidebarLink({
  item,
  collapsed,
  onNavigate
}) {
  const Icon = item.icon;
  return /* @__PURE__ */ jsxs(
    Link,
    {
      to: item.to,
      onClick: onNavigate,
      activeOptions: { exact: item.to === "/" },
      title: collapsed ? item.label : void 0,
      className: cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
        "text-content-muted hover:bg-surface-2 hover:text-content",
        collapsed && "justify-center px-0"
      ),
      activeProps: {
        className: "bg-surface-2 text-content font-medium",
        "aria-current": "page"
      },
      children: [
        /* @__PURE__ */ jsx(Icon, { className: "h-4 w-4 shrink-0", "aria-hidden": "true" }),
        collapsed ? /* @__PURE__ */ jsx("span", { className: "sr-only", children: item.label }) : item.label
      ]
    }
  );
}
const COLLAPSE_STORAGE_KEY = "stack.sidebar.collapsed";
function AppLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  }, []);
  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  }
  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(event) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);
  return /* @__PURE__ */ jsxs("div", { className: "flex min-h-screen bg-canvas", children: [
    /* @__PURE__ */ jsx(
      "aside",
      {
        className: cn(
          "hidden shrink-0 transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-60"
        ),
        "aria-label": "Sidopanel",
        children: /* @__PURE__ */ jsx(
          "div",
          {
            className: cn(
              "fixed inset-y-0 left-0 transition-[width] duration-200",
              collapsed ? "w-16" : "w-60"
            ),
            children: /* @__PURE__ */ jsx(AppSidebar, { collapsed, onToggleCollapsed: toggleCollapsed })
          }
        )
      }
    ),
    mobileNavOpen && /* @__PURE__ */ jsxs("div", { className: "fixed inset-0 z-50 lg:hidden", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          "aria-label": "Stäng menyn",
          onClick: () => setMobileNavOpen(false),
          className: "absolute inset-0 bg-black/70"
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "relative h-full w-64", children: [
        /* @__PURE__ */ jsx(
          AppSidebar,
          {
            collapsed: false,
            onToggleCollapsed: () => setMobileNavOpen(false),
            onNavigate: () => setMobileNavOpen(false)
          }
        ),
        /* @__PURE__ */ jsx(
          IconButton,
          {
            label: "Stäng menyn",
            onClick: () => setMobileNavOpen(false),
            className: "absolute top-3 -right-11 bg-surface-2",
            children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4", "aria-hidden": "true" })
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex min-w-0 flex-1 flex-col", children: [
      /* @__PURE__ */ jsx(AppHeader, { onOpenMobileNav: () => setMobileNavOpen(true) }),
      /* @__PURE__ */ jsx("main", { className: "flex-1 px-6 pt-2 pb-16 lg:px-10", children })
    ] })
  ] });
}
const appCss = "/assets/app--keVXEgQ.css";
const Route$7 = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "dark" },
      { title: "Stack" },
      {
        name: "description",
        content: "Stack är ett operativsystem för analysagenter, med portfölj- och marknadsöversikt. All data i denna version är exempeldata."
      }
    ],
    links: [{ rel: "stylesheet", href: appCss }]
  }),
  component: RootComponent
});
function RootComponent() {
  return /* @__PURE__ */ jsx(RootDocument, { children: /* @__PURE__ */ jsx(AppLayout, { children: /* @__PURE__ */ jsx(Outlet, {}) }) });
}
function RootDocument({ children }) {
  return /* @__PURE__ */ jsxs("html", { lang: "sv", children: [
    /* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }),
    /* @__PURE__ */ jsxs("body", { children: [
      children,
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
const $$splitComponentImporter$6 = () => import("./index-CS2fG52F.js");
const Route$6 = createFileRoute("/")({
  component: lazyRouteComponent($$splitComponentImporter$6, "component")
});
const $$splitComponentImporter$5 = () => import("./agents-BLH33AoS.js");
const Route$5 = createFileRoute("/agents")({
  component: lazyRouteComponent($$splitComponentImporter$5, "component")
});
const $$splitComponentImporter$4 = () => import("./markets-BW2GVT00.js");
const Route$4 = createFileRoute("/markets")({
  component: lazyRouteComponent($$splitComponentImporter$4, "component")
});
const $$splitComponentImporter$3 = () => import("./portfolio-BtzUrCix.js");
const Route$3 = createFileRoute("/portfolio")({
  component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
const $$splitComponentImporter$2 = () => import("./reports-DppZzIWz.js");
const Route$2 = createFileRoute("/reports")({
  component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
const $$splitComponentImporter$1 = () => import("./settings-B4KBS1w9.js");
const Route$1 = createFileRoute("/settings")({
  component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
const $$splitComponentImporter = () => import("./watchlist-vNqid2f_.js");
const Route = createFileRoute("/watchlist")({
  component: lazyRouteComponent($$splitComponentImporter, "component")
});
const IndexRoute = Route$6.update({
  id: "/",
  path: "/",
  getParentRoute: () => Route$7
});
const AgentsRoute = Route$5.update({
  id: "/agents",
  path: "/agents",
  getParentRoute: () => Route$7
});
const MarketsRoute = Route$4.update({
  id: "/markets",
  path: "/markets",
  getParentRoute: () => Route$7
});
const PortfolioRoute = Route$3.update({
  id: "/portfolio",
  path: "/portfolio",
  getParentRoute: () => Route$7
});
const ReportsRoute = Route$2.update({
  id: "/reports",
  path: "/reports",
  getParentRoute: () => Route$7
});
const SettingsRoute = Route$1.update({
  id: "/settings",
  path: "/settings",
  getParentRoute: () => Route$7
});
const WatchlistRoute = Route.update({
  id: "/watchlist",
  path: "/watchlist",
  getParentRoute: () => Route$7
});
const rootRouteChildren = {
  IndexRoute,
  AgentsRoute,
  MarketsRoute,
  PortfolioRoute,
  ReportsRoute,
  SettingsRoute,
  WatchlistRoute
};
const routeTree = Route$7._addFileChildren(rootRouteChildren)._addFileTypes();
function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent"
  });
}
const router = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getRouter
}, Symbol.toStringTag, { value: "Module" }));
export {
  Button as B,
  CHART_SURFACE as C,
  MOCK_NOW as M,
  SERIES as S,
  agents as a,
  marketTrends as b,
  cn as c,
  allocation as d,
  CHART_GRID as e,
  CHART_AXIS_TEXT as f,
  getPerformanceSeries as g,
  holdings as h,
  reports as i,
  STATUS as j,
  router as k,
  marketIndices as m,
  portfolioSummary as p,
  recentAnalyses as r,
  watchlist as w
};
