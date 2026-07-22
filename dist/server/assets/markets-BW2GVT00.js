import { jsxs, jsx } from "react/jsx-runtime";
import { Globe } from "lucide-react";
import { P as PageShell, a as PageHeader } from "./PageHeader-Ba6TgEpl.js";
import { D as DashboardCard } from "./DashboardCard-BTCtsqDt.js";
import { E as EmptyState } from "./EmptyState-BYuNNdnF.js";
import { M as MarketTickerList } from "./MarketTicker-CSwuRVat.js";
import { m as marketIndices, b as marketTrends, c as cn } from "./router-Cn-L1ueB.js";
import "./ChangeValue-C_Bo7YCU.js";
import "./format-jzA_cNCn.js";
import "@tanstack/react-router";
import "react";
import "clsx";
const TREND_TONE = {
  positive: "text-positive",
  negative: "text-negative",
  warning: "text-warning",
  accent: "text-accent",
  neutral: "text-content"
};
function MarketsPage() {
  return /* @__PURE__ */ jsxs(PageShell, { children: [
    /* @__PURE__ */ jsx(PageHeader, { title: "Marknader" }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 gap-6 lg:grid-cols-3", children: [
      /* @__PURE__ */ jsx(DashboardCard, { title: "Index och valutor", children: /* @__PURE__ */ jsx(MarketTickerList, { quotes: marketIndices }) }),
      /* @__PURE__ */ jsx(DashboardCard, { title: "Marknadsklimat", children: /* @__PURE__ */ jsx("dl", { className: "flex flex-col gap-5", children: marketTrends.map((trend) => /* @__PURE__ */ jsxs("div", { className: "flex items-baseline justify-between gap-4", children: [
        /* @__PURE__ */ jsx("dt", { className: "text-sm text-content-muted", children: trend.label }),
        /* @__PURE__ */ jsx("dd", { className: cn("text-sm font-medium", TREND_TONE[trend.tone] ?? "text-content"), children: trend.value })
      ] }, trend.id)) }) }),
      /* @__PURE__ */ jsx(DashboardCard, { title: "Sektorer", children: /* @__PURE__ */ jsx(EmptyState, { icon: Globe, title: "Sektordata saknas", description: "Sektorrotation visas här när marknadsdatakällan är ansluten." }) })
    ] })
  ] });
}
export {
  MarketsPage as component
};
