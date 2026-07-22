import { jsxs, jsx } from "react/jsx-runtime";
import { c as cn } from "./router-Cn-L1ueB.js";
const TONE_CLASS = {
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-surface-3 text-content-muted"
};
function StatusBadge({
  tone = "neutral",
  children,
  className,
  dot = false
}) {
  return /* @__PURE__ */ jsxs(
    "span",
    {
      className: cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className
      ),
      children: [
        dot && /* @__PURE__ */ jsx("span", { className: "h-1.5 w-1.5 rounded-full bg-current", "aria-hidden": "true" }),
        children
      ]
    }
  );
}
const SIGNAL_META = {
  buy: { label: "Köpsignal", tone: "positive" },
  sell: { label: "Säljsignal", tone: "negative" },
  hold: { label: "Behåll", tone: "neutral" },
  watch: { label: "Bevaka", tone: "warning" }
};
function SignalBadge({ signal }) {
  const meta = SIGNAL_META[signal];
  return /* @__PURE__ */ jsx(StatusBadge, { tone: meta.tone, children: meta.label });
}
const ANALYSIS_STATUS_META = {
  completed: { label: "Klar", tone: "positive" },
  running: { label: "Pågår", tone: "accent" },
  queued: { label: "I kö", tone: "warning" },
  failed: { label: "Misslyckades", tone: "negative" }
};
function AnalysisStatusBadge({ status }) {
  const meta = ANALYSIS_STATUS_META[status];
  return /* @__PURE__ */ jsx(StatusBadge, { tone: meta.tone, children: meta.label });
}
export {
  AnalysisStatusBadge as A,
  StatusBadge as S,
  SignalBadge as a
};
