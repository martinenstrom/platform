import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { D as DashboardCard, S as SectionHeading } from "./DashboardCard-BTCtsqDt.js";
import { S as Stat, P as PerformanceChart, T as TimeRangeSelector } from "./PerformanceChart-2bg0WdNb.js";
import { C as ChangeValue } from "./ChangeValue-C_Bo7YCU.js";
import { M as MarketTickerList } from "./MarketTicker-CSwuRVat.js";
import { A as AgentCard } from "./AgentCard-CzouiS8T.js";
import { g as getPerformanceSeries, a as agents, p as portfolioSummary, m as marketIndices } from "./router-Cn-L1ueB.js";
import { f as formatCurrency, a as formatSignedCurrency, b as formatPercent } from "./format-jzA_cNCn.js";
import "recharts";
import "clsx";
function DashboardPage() {
  const [range, setRange] = useState("1M");
  const performance = useMemo(() => getPerformanceSeries(range), [range]);
  const {
    currency
  } = portfolioSummary;
  const activeAgents = agents.filter((agent) => agent.status === "running").length;
  return /* @__PURE__ */ jsxs("div", { className: "mx-auto flex max-w-[1400px] flex-col gap-12", children: [
    /* @__PURE__ */ jsxs("section", { className: "pt-6", "aria-labelledby": "overview-heading", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-4", children: [
        /* @__PURE__ */ jsx("h1", { id: "overview-heading", className: "text-sm font-medium text-content", children: "Översikt" }),
        /* @__PURE__ */ jsx(AgentPulse, { count: activeAgents })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-6 flex flex-wrap items-end gap-x-6 gap-y-3", children: [
        /* @__PURE__ */ jsx(Stat, { label: "Portföljvärde", size: "hero", value: formatCurrency(portfolioSummary.totalValue, currency) }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3 pb-2", children: [
          /* @__PURE__ */ jsx(ChangeValue, { value: portfolioSummary.dayChangePercent, showIcon: false, className: "rounded-md bg-surface px-2 py-1 text-sm" }),
          /* @__PURE__ */ jsxs("span", { className: "tabular text-sm text-content-subtle", children: [
            formatSignedCurrency(portfolioSummary.dayChange, currency),
            " idag"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-10 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4", children: [
        /* @__PURE__ */ jsx(Stat, { label: "Senaste månaden", size: "md", tone: "positive", value: formatPercent(portfolioSummary.monthChangePercent) }),
        /* @__PURE__ */ jsx(Stat, { label: "Tillgängligt kapital", size: "md", value: formatCurrency(portfolioSummary.cashBalance, currency) }),
        /* @__PURE__ */ jsx(Stat, { label: "Köpkraft", size: "md", value: formatCurrency(portfolioSummary.buyingPower, currency) }),
        /* @__PURE__ */ jsx(Stat, { label: "Investerat kapital", size: "md", value: formatCurrency(portfolioSummary.investedCapital, currency) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 gap-6 lg:grid-cols-3", children: [
      /* @__PURE__ */ jsx(DashboardCard, { title: "Utveckling", className: "lg:col-span-2", action: /* @__PURE__ */ jsx(TimeRangeSelector, { value: range, onChange: setRange }), children: /* @__PURE__ */ jsx(PerformanceChart, { data: performance, range }) }),
      /* @__PURE__ */ jsx(DashboardCard, { title: "Marknad", children: /* @__PURE__ */ jsx(MarketTickerList, { quotes: marketIndices }) })
    ] }),
    /* @__PURE__ */ jsxs("section", { "aria-labelledby": "agent-activity-heading", children: [
      /* @__PURE__ */ jsx(SectionHeading, { action: /* @__PURE__ */ jsxs(Link, { to: "/agents", className: "inline-flex items-center gap-1.5 rounded-sm text-xs text-content-muted transition-colors duration-150 hover:text-content", children: [
        "Alla agenter",
        /* @__PURE__ */ jsx(ArrowRight, { className: "h-3.5 w-3.5", "aria-hidden": "true" })
      ] }), children: /* @__PURE__ */ jsx("span", { id: "agent-activity-heading", children: "Agentaktivitet" }) }),
      /* @__PURE__ */ jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", children: agents.slice(0, 4).map((agent) => /* @__PURE__ */ jsx(AgentCard, { agent }, agent.id)) }),
      /* @__PURE__ */ jsx("p", { className: "mt-4 text-xs text-content-subtle", children: "Agenterna och deras resultat är simulerade. Innehållet utgör inte investeringsrådgivning." })
    ] })
  ] });
}
function AgentPulse({
  count
}) {
  if (count === 0) {
    return /* @__PURE__ */ jsx("span", { className: "text-xs text-content-subtle", children: "Inga agenter arbetar just nu" });
  }
  return /* @__PURE__ */ jsxs(Link, { to: "/agents", className: "inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs text-content-muted transition-colors duration-150 hover:bg-surface-2 hover:text-content", children: [
    /* @__PURE__ */ jsxs("span", { className: "relative flex h-1.5 w-1.5", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("span", { className: "absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" }),
      /* @__PURE__ */ jsx("span", { className: "relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" })
    ] }),
    count === 1 ? "1 agent arbetar" : `${count} agenter arbetar`
  ] });
}
export {
  DashboardPage as component
};
