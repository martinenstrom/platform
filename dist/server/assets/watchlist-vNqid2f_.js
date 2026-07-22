import { jsx, jsxs } from "react/jsx-runtime";
import { Plus, Star } from "lucide-react";
import { P as PageShell, a as PageHeader } from "./PageHeader-Ba6TgEpl.js";
import { D as DashboardCard } from "./DashboardCard-BTCtsqDt.js";
import { j as STATUS, B as Button, w as watchlist } from "./router-Cn-L1ueB.js";
import { E as EmptyState } from "./EmptyState-BYuNNdnF.js";
import { C as ChangeValue } from "./ChangeValue-C_Bo7YCU.js";
import { a as SignalBadge } from "./StatusBadge-DIJXu5p7.js";
import { T as TableWrapper, a as Table, b as Th, c as Tr, d as Td } from "./Table-hGsko79z.js";
import { e as formatNumber } from "./format-jzA_cNCn.js";
import "@tanstack/react-router";
import "react";
import "clsx";
function Sparkline({ data, trendUp, width = 64, height = 20 }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((value, index) => {
    const x = index * stepX;
    const y = height - (value - min) / span * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return /* @__PURE__ */ jsx(
    "svg",
    {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "aria-hidden": "true",
      focusable: "false",
      className: "overflow-visible",
      children: /* @__PURE__ */ jsx(
        "polyline",
        {
          points,
          fill: "none",
          stroke: trendUp ? STATUS.positive : STATUS.negative,
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        }
      )
    }
  );
}
function WatchlistTable({ items }) {
  return /* @__PURE__ */ jsx(TableWrapper, { children: /* @__PURE__ */ jsxs(Table, { children: [
    /* @__PURE__ */ jsx("caption", { className: "sr-only", children: "Bevakade instrument med kurs, daglig utveckling och simulerad signal." }),
    /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx(Th, { children: "Instrument" }),
      /* @__PURE__ */ jsx(Th, { align: "right", children: "Kurs" }),
      /* @__PURE__ */ jsx(Th, { align: "right", children: "Idag" }),
      /* @__PURE__ */ jsx(Th, { align: "center", children: "Trend" }),
      /* @__PURE__ */ jsx(Th, { align: "right", children: "Signal" })
    ] }) }),
    /* @__PURE__ */ jsx("tbody", { children: items.map((item) => /* @__PURE__ */ jsxs(Tr, { children: [
      /* @__PURE__ */ jsxs(Td, { children: [
        /* @__PURE__ */ jsx("span", { className: "block text-sm font-medium text-content", children: item.name }),
        /* @__PURE__ */ jsx("span", { className: "block text-xs text-content-subtle", children: item.ticker })
      ] }),
      /* @__PURE__ */ jsx(Td, { numeric: true, children: formatNumber(item.price) }),
      /* @__PURE__ */ jsx(Td, { numeric: true, children: /* @__PURE__ */ jsx(
        ChangeValue,
        {
          value: item.changePercent,
          showIcon: false,
          className: "justify-end"
        }
      ) }),
      /* @__PURE__ */ jsx(Td, { className: "text-center", children: /* @__PURE__ */ jsx("span", { className: "inline-flex justify-center", children: /* @__PURE__ */ jsx(Sparkline, { data: item.spark, trendUp: item.changePercent >= 0 }) }) }),
      /* @__PURE__ */ jsx(Td, { className: "text-right", children: /* @__PURE__ */ jsx(SignalBadge, { signal: item.signal }) })
    ] }, item.id)) })
  ] }) });
}
function WatchlistPage() {
  return /* @__PURE__ */ jsxs(PageShell, { children: [
    /* @__PURE__ */ jsx(PageHeader, { title: "Bevakning", description: "Instrument du följer, med simulerade signaler från analysagenter.", actions: /* @__PURE__ */ jsxs(Button, { variant: "primary", size: "sm", children: [
      /* @__PURE__ */ jsx(Plus, { className: "h-3.5 w-3.5", "aria-hidden": "true" }),
      "Lägg till instrument"
    ] }) }),
    /* @__PURE__ */ jsx(DashboardCard, { title: "Bevakningslista", children: /* @__PURE__ */ jsx(WatchlistTable, { items: watchlist }) }),
    /* @__PURE__ */ jsx(DashboardCard, { title: "Delade listor", children: /* @__PURE__ */ jsx(EmptyState, { icon: Star, title: "Inga delade listor ännu", description: "Listor som delas i teamet visas här när samarbetsfunktionerna aktiveras.", action: /* @__PURE__ */ jsx(Button, { variant: "secondary", size: "sm", children: "Skapa lista" }) }) })
  ] });
}
export {
  WatchlistPage as component
};
