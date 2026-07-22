import { jsxs, jsx } from "react/jsx-runtime";
import { c as cn, M as MOCK_NOW } from "./router-Cn-L1ueB.js";
import { d as formatRelativeTime } from "./format-jzA_cNCn.js";
const AGENT_STATUS_META = {
  running: { label: "Kör", dot: "bg-accent", text: "text-accent" },
  finished: { label: "Klar", dot: "bg-positive", text: "text-positive" },
  waiting: { label: "Väntar", dot: "bg-content-subtle", text: "text-content-subtle" },
  failed: { label: "Fel", dot: "bg-negative", text: "text-negative" }
};
function AgentStatusDot({
  status,
  className
}) {
  const meta = AGENT_STATUS_META[status];
  return /* @__PURE__ */ jsxs("span", { className: cn("inline-flex items-center gap-2 text-xs", meta.text, className), children: [
    /* @__PURE__ */ jsxs("span", { className: "relative flex h-1.5 w-1.5", "aria-hidden": "true", children: [
      status === "running" && /* @__PURE__ */ jsx("span", { className: "absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" }),
      /* @__PURE__ */ jsx("span", { className: cn("relative inline-flex h-1.5 w-1.5 rounded-full", meta.dot) })
    ] }),
    meta.label
  ] });
}
function AgentCard({ agent, className }) {
  return /* @__PURE__ */ jsxs(
    "article",
    {
      className: cn(
        "group flex flex-col rounded-xl bg-surface p-5 shadow-card transition-colors duration-150 hover:bg-surface-2",
        className
      ),
      children: [
        /* @__PURE__ */ jsxs("header", { className: "flex items-start justify-between gap-3", children: [
          /* @__PURE__ */ jsx("h3", { className: "truncate text-sm font-medium text-content", children: agent.name }),
          /* @__PURE__ */ jsx(AgentStatusDot, { status: agent.status, className: "shrink-0" })
        ] }),
        /* @__PURE__ */ jsx("p", { className: "mt-3 text-sm leading-relaxed text-content-muted", children: agent.result ?? agent.activity }),
        agent.status === "running" && agent.progress !== void 0 && /* @__PURE__ */ jsx(
          "div",
          {
            className: "mt-4 h-0.5 w-full overflow-hidden rounded-full bg-surface-3",
            role: "progressbar",
            "aria-valuenow": agent.progress,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-label": `Förlopp för ${agent.name}`,
            children: /* @__PURE__ */ jsx(
              "div",
              {
                className: "h-full rounded-full bg-accent transition-[width] duration-500",
                style: { width: `${agent.progress}%` }
              }
            )
          }
        ),
        /* @__PURE__ */ jsxs("footer", { className: "mt-4 flex items-center justify-between gap-3 text-xs text-content-subtle", children: [
          /* @__PURE__ */ jsx("span", { className: "truncate", children: agent.result ? agent.activity : agent.role }),
          /* @__PURE__ */ jsx("time", { dateTime: agent.lastRunAt, className: "shrink-0", children: formatRelativeTime(agent.lastRunAt, MOCK_NOW) })
        ] })
      ]
    }
  );
}
export {
  AgentCard as A,
  AgentStatusDot as a
};
