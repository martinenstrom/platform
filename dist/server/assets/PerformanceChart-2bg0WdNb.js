import { jsxs, jsx } from "react/jsx-runtime";
import { c as cn, S as SERIES, e as CHART_GRID, f as CHART_AXIS_TEXT } from "./router-Cn-L1ueB.js";
import { useId } from "react";
import { ResponsiveContainer, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, Area } from "recharts";
import { e as formatNumber } from "./format-jzA_cNCn.js";
const VALUE_SIZE = {
  md: "text-xl",
  lg: "text-2xl",
  xl: "text-4xl",
  hero: "text-5xl"
};
const TONE = {
  default: "text-content",
  positive: "text-positive",
  negative: "text-negative"
};
function Stat({
  label,
  value,
  detail,
  size = "lg",
  tone = "default",
  className
}) {
  return /* @__PURE__ */ jsxs("div", { className: cn("min-w-0", className), children: [
    /* @__PURE__ */ jsx("p", { className: "text-xs text-content-muted", children: label }),
    /* @__PURE__ */ jsx(
      "p",
      {
        className: cn(
          "tabular mt-2 font-semibold tracking-tight",
          VALUE_SIZE[size],
          TONE[tone]
        ),
        children: value
      }
    ),
    detail && /* @__PURE__ */ jsx("div", { className: "mt-1.5 text-sm", children: detail })
  ] });
}
const TIME_RANGES = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1V" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Å" },
  { value: "ALL", label: "Allt" }
];
function TimeRangeSelector({
  value,
  onChange,
  label = "Tidsintervall"
}) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      role: "group",
      "aria-label": label,
      className: "inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5",
      children: TIME_RANGES.map((range) => {
        const isActive = range.value === value;
        return /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            "aria-pressed": isActive,
            onClick: () => onChange(range.value),
            className: cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
              isActive ? "bg-surface-3 text-content" : "text-content-muted hover:text-content"
            ),
            children: range.label
          },
          range.value
        );
      })
    }
  );
}
function ChartTooltip({
  title,
  rows,
  footer
}) {
  return /* @__PURE__ */ jsxs("div", { className: "rounded-lg bg-surface-3 px-3 py-2.5 shadow-pop", children: [
    /* @__PURE__ */ jsx("p", { className: "text-xs font-medium text-content", children: title }),
    /* @__PURE__ */ jsx("ul", { className: "mt-1.5 space-y-1", children: rows.map((row) => /* @__PURE__ */ jsxs("li", { className: "flex items-center gap-2 text-xs", children: [
      row.color && /* @__PURE__ */ jsx(
        "span",
        {
          "aria-hidden": "true",
          className: "h-2 w-2 shrink-0 rounded-xs",
          style: { backgroundColor: row.color }
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "text-content-muted", children: row.label }),
      /* @__PURE__ */ jsx("span", { className: "tabular ml-auto font-medium text-content", children: row.value })
    ] }, row.label)) }),
    footer && /* @__PURE__ */ jsx("div", { className: "mt-1.5 text-[11px] text-content-subtle", children: footer })
  ] });
}
const SERIES_LABEL = {
  portfolio: "Portfölj",
  benchmark: "Jämförelseindex"
};
function PerformanceChart({ data, range }) {
  const gradientId = useId().replace(/:/g, "");
  const first = data[0];
  const last = data[data.length - 1];
  const totalReturn = first && last ? last.portfolio - first.portfolio : 0;
  return /* @__PURE__ */ jsxs("figure", { className: "m-0", children: [
    /* @__PURE__ */ jsx(SeriesLegend, {}),
    /* @__PURE__ */ jsx("div", { className: "mt-3 h-64 w-full", children: /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height: "100%", children: /* @__PURE__ */ jsxs(AreaChart, { data, margin: { top: 4, right: 8, bottom: 0, left: -18 }, children: [
      /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsxs("linearGradient", { id: `${gradientId}-portfolio`, x1: "0", y1: "0", x2: "0", y2: "1", children: [
        /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: SERIES.portfolio, stopOpacity: 0.28 }),
        /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: SERIES.portfolio, stopOpacity: 0 })
      ] }) }),
      /* @__PURE__ */ jsx(CartesianGrid, { stroke: CHART_GRID, strokeDasharray: "3 3", vertical: false }),
      /* @__PURE__ */ jsx(
        XAxis,
        {
          dataKey: "t",
          tickFormatter: (value) => formatAxisLabel(value, range),
          tick: { fill: CHART_AXIS_TEXT, fontSize: 11 },
          tickLine: false,
          axisLine: false,
          minTickGap: 28
        }
      ),
      /* @__PURE__ */ jsx(
        YAxis,
        {
          domain: ["dataMin - 1", "dataMax + 1"],
          tick: { fill: CHART_AXIS_TEXT, fontSize: 11 },
          tickLine: false,
          axisLine: false,
          width: 48,
          tickFormatter: (value) => formatNumber(value, 0)
        }
      ),
      /* @__PURE__ */ jsx(
        Tooltip,
        {
          cursor: { stroke: CHART_GRID, strokeWidth: 1 },
          content: /* @__PURE__ */ jsx(PerformanceTooltip, { range })
        }
      ),
      /* @__PURE__ */ jsx(
        Area,
        {
          type: "monotone",
          dataKey: "benchmark",
          stroke: SERIES.benchmark,
          strokeWidth: 2,
          strokeDasharray: "4 3",
          fill: "none",
          dot: false,
          activeDot: { r: 3, strokeWidth: 0 },
          isAnimationActive: false
        }
      ),
      /* @__PURE__ */ jsx(
        Area,
        {
          type: "monotone",
          dataKey: "portfolio",
          stroke: SERIES.portfolio,
          strokeWidth: 2,
          fill: `url(#${gradientId}-portfolio)`,
          dot: false,
          activeDot: { r: 3, strokeWidth: 0 },
          isAnimationActive: false
        }
      )
    ] }) }) }),
    /* @__PURE__ */ jsxs("figcaption", { className: "sr-only", children: [
      "Portföljens utveckling jämfört med jämförelseindex, indexerat till 100 vid periodens start. Portföljen slutar på ",
      formatNumber(last?.portfolio ?? 100),
      " och index på ",
      formatNumber(last?.benchmark ?? 100),
      ", en skillnad på",
      " ",
      formatNumber(totalReturn),
      " indexenheter. Exempeldata."
    ] })
  ] });
}
function SeriesLegend() {
  return /* @__PURE__ */ jsxs("ul", { className: "flex flex-wrap items-center gap-4", children: [
    /* @__PURE__ */ jsx(LegendItem, { color: SERIES.portfolio, label: SERIES_LABEL.portfolio }),
    /* @__PURE__ */ jsx(LegendItem, { color: SERIES.benchmark, label: SERIES_LABEL.benchmark, dashed: true })
  ] });
}
function LegendItem({
  color,
  label,
  dashed = false
}) {
  return /* @__PURE__ */ jsxs("li", { className: "flex items-center gap-2 text-xs text-content-muted", children: [
    /* @__PURE__ */ jsx(
      "span",
      {
        "aria-hidden": "true",
        className: "h-0.5 w-5 rounded-full",
        style: dashed ? {
          backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 9px)`
        } : { backgroundColor: color }
      }
    ),
    label
  ] });
}
function PerformanceTooltip({
  active,
  payload,
  label,
  range
}) {
  if (!active || !payload?.length) return null;
  return /* @__PURE__ */ jsx(
    ChartTooltip,
    {
      title: formatAxisLabel(String(label ?? ""), range, true),
      rows: payload.map((entry) => ({
        label: SERIES_LABEL[entry.dataKey] ?? String(entry.dataKey),
        value: formatNumber(entry.value ?? 0),
        color: entry.color
      })),
      footer: "Index = 100 vid periodens start"
    }
  );
}
function formatAxisLabel(value, range, long = false) {
  if (range === "1D") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (long) {
    return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(date);
  }
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    ...range === "ALL" || range === "1Y" ? { year: "2-digit" } : {}
  }).format(date);
}
export {
  ChartTooltip as C,
  PerformanceChart as P,
  Stat as S,
  TimeRangeSelector as T
};
