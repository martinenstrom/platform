import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useMemo } from "react";
import { P as PageShell, a as PageHeader } from "./PageHeader-Ba6TgEpl.js";
import { D as DashboardCard } from "./DashboardCard-BTCtsqDt.js";
import { C as ChartTooltip, S as Stat, P as PerformanceChart, T as TimeRangeSelector } from "./PerformanceChart-2bg0WdNb.js";
import { C as ChangeValue } from "./ChangeValue-C_Bo7YCU.js";
import { T as TableWrapper, a as Table, b as Th, c as Tr, d as Td } from "./Table-hGsko79z.js";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { C as CHART_SURFACE, g as getPerformanceSeries, d as allocation, h as holdings, p as portfolioSummary } from "./router-Cn-L1ueB.js";
import { f as formatCurrency, e as formatNumber, b as formatPercent, a as formatSignedCurrency } from "./format-jzA_cNCn.js";
import "lucide-react";
import "@tanstack/react-router";
import "clsx";
function AllocationChart({ data, total, currency = "SEK" }) {
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-4 sm:flex-row sm:items-center", children: [
    /* @__PURE__ */ jsxs("figure", { className: "relative m-0 h-44 w-44 shrink-0 self-center", children: [
      /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height: "100%", children: /* @__PURE__ */ jsxs(PieChart, { children: [
        /* @__PURE__ */ jsx(
          Pie,
          {
            data,
            dataKey: "value",
            nameKey: "label",
            innerRadius: "66%",
            outerRadius: "100%",
            paddingAngle: 2,
            stroke: CHART_SURFACE,
            strokeWidth: 2,
            isAnimationActive: false,
            children: data.map((slice) => /* @__PURE__ */ jsx(Cell, { fill: slice.color }, slice.id))
          }
        ),
        /* @__PURE__ */ jsx(Tooltip, { content: /* @__PURE__ */ jsx(AllocationTooltip, { currency }) })
      ] }) }),
      /* @__PURE__ */ jsxs("div", { className: "pointer-events-none absolute inset-0 flex flex-col items-center justify-center", children: [
        /* @__PURE__ */ jsx("span", { className: "text-[11px] text-content-subtle", children: "Totalt" }),
        /* @__PURE__ */ jsx("span", { className: "tabular text-sm font-semibold text-content", children: formatCurrency(total, currency, {
          notation: "compact",
          maximumFractionDigits: 1
        }) })
      ] }),
      /* @__PURE__ */ jsx("figcaption", { className: "sr-only", children: "Fördelning av portföljens värde per tillgångsslag. Exempeldata." })
    ] }),
    /* @__PURE__ */ jsx("ul", { className: "min-w-0 flex-1 space-y-1.5", children: data.map((slice) => /* @__PURE__ */ jsxs("li", { className: "flex items-center gap-2.5 text-sm", children: [
      /* @__PURE__ */ jsx(
        "span",
        {
          "aria-hidden": "true",
          className: "h-2.5 w-2.5 shrink-0 rounded-xs",
          style: { backgroundColor: slice.color }
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "min-w-0 flex-1 truncate text-content-muted", children: slice.label }),
      /* @__PURE__ */ jsxs("span", { className: "tabular w-12 text-right font-medium text-content", children: [
        formatNumber(slice.percent, 1),
        " %"
      ] }),
      /* @__PURE__ */ jsx("span", { className: "tabular hidden w-24 text-right text-xs text-content-subtle sm:block", children: formatCurrency(slice.value, currency) })
    ] }, slice.id)) })
  ] });
}
function AllocationTooltip({
  active,
  payload,
  currency = "SEK"
}) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return /* @__PURE__ */ jsx(
    ChartTooltip,
    {
      title: slice.label,
      rows: [
        {
          label: "Andel",
          value: `${formatNumber(slice.percent, 1)} %`,
          color: slice.color
        },
        { label: "Värde", value: formatCurrency(slice.value, currency) }
      ]
    }
  );
}
function PortfolioPage() {
  const [range, setRange] = useState("1Y");
  const performance = useMemo(() => getPerformanceSeries(range), [range]);
  const allocationTotal = allocation.reduce((sum, slice) => sum + slice.value, 0);
  const {
    currency
  } = portfolioSummary;
  return /* @__PURE__ */ jsxs(PageShell, { children: [
    /* @__PURE__ */ jsx(PageHeader, { title: "Portfölj" }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4", children: [
      /* @__PURE__ */ jsx(Stat, { label: "Portföljvärde", size: "xl", value: formatCurrency(portfolioSummary.totalValue, currency) }),
      /* @__PURE__ */ jsx(Stat, { label: "Orealiserat resultat", size: "xl", tone: "positive", value: formatSignedCurrency(portfolioSummary.unrealizedResult, currency), detail: /* @__PURE__ */ jsx("span", { className: "text-content-subtle", children: formatPercent(portfolioSummary.unrealizedResultPercent) }) }),
      /* @__PURE__ */ jsx(Stat, { label: "Investerat kapital", size: "xl", value: formatCurrency(portfolioSummary.investedCapital, currency) }),
      /* @__PURE__ */ jsx(Stat, { label: "Köpkraft", size: "xl", value: formatCurrency(portfolioSummary.buyingPower, currency) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 gap-6 lg:grid-cols-3", children: [
      /* @__PURE__ */ jsx(DashboardCard, { title: "Utveckling", className: "lg:col-span-2", action: /* @__PURE__ */ jsx(TimeRangeSelector, { value: range, onChange: setRange }), children: /* @__PURE__ */ jsx(PerformanceChart, { data: performance, range }) }),
      /* @__PURE__ */ jsx(DashboardCard, { title: "Fördelning", children: /* @__PURE__ */ jsx(AllocationChart, { data: allocation, total: allocationTotal }) })
    ] }),
    /* @__PURE__ */ jsx(DashboardCard, { title: "Innehav", children: /* @__PURE__ */ jsx(TableWrapper, { children: /* @__PURE__ */ jsxs(Table, { children: [
      /* @__PURE__ */ jsx("caption", { className: "sr-only", children: "Portföljens innehav med värde och vikt." }),
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx(Th, { children: "Instrument" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "Antal" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "GAV" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "Kurs" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "Värde" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "Idag" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "Vikt" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: holdings.map((holding) => /* @__PURE__ */ jsxs(Tr, { children: [
        /* @__PURE__ */ jsxs(Td, { children: [
          /* @__PURE__ */ jsx("span", { className: "block text-sm text-content", children: holding.name }),
          /* @__PURE__ */ jsx("span", { className: "block text-xs text-content-subtle", children: holding.ticker })
        ] }),
        /* @__PURE__ */ jsx(Td, { numeric: true, children: formatNumber(holding.quantity, 0) }),
        /* @__PURE__ */ jsx(Td, { numeric: true, children: formatNumber(holding.averagePrice) }),
        /* @__PURE__ */ jsx(Td, { numeric: true, children: formatNumber(holding.lastPrice) }),
        /* @__PURE__ */ jsx(Td, { numeric: true, children: formatCurrency(holding.marketValue, holding.currency) }),
        /* @__PURE__ */ jsx(Td, { numeric: true, children: /* @__PURE__ */ jsx(ChangeValue, { value: holding.changePercent, showIcon: false, className: "justify-end" }) }),
        /* @__PURE__ */ jsxs(Td, { numeric: true, children: [
          formatNumber(holding.weight, 1),
          " %"
        ] })
      ] }, holding.id)) })
    ] }) }) })
  ] });
}
export {
  PortfolioPage as component
};
