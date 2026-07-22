import { jsxs, jsx } from "react/jsx-runtime";
import { Plus } from "lucide-react";
import { P as PageShell, a as PageHeader } from "./PageHeader-Ba6TgEpl.js";
import { S as SectionHeading } from "./DashboardCard-BTCtsqDt.js";
import { a as agents, B as Button, r as recentAnalyses } from "./router-Cn-L1ueB.js";
import { A as AgentCard, a as AgentStatusDot } from "./AgentCard-CzouiS8T.js";
import { c as formatDateTime } from "./format-jzA_cNCn.js";
import "@tanstack/react-router";
import "react";
import "clsx";
const STATUS_ORDER = ["failed", "running", "finished", "waiting"];
function AgentsPage() {
  const sorted = [...agents].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return /* @__PURE__ */ jsxs(PageShell, { children: [
    /* @__PURE__ */ jsx(PageHeader, { title: "Agenter", description: "Dina agenter, vad de gör just nu och vad de senast kom fram till.", actions: /* @__PURE__ */ jsxs(Button, { variant: "primary", size: "sm", children: [
      /* @__PURE__ */ jsx(Plus, { className: "h-3.5 w-3.5", "aria-hidden": "true" }),
      "Ny agent"
    ] }) }),
    /* @__PURE__ */ jsx("section", { "aria-label": "Agentflotta", children: /* @__PURE__ */ jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", children: sorted.map((agent) => /* @__PURE__ */ jsx(AgentCard, { agent }, agent.id)) }) }),
    /* @__PURE__ */ jsxs("section", { "aria-labelledby": "agent-runs-heading", children: [
      /* @__PURE__ */ jsx(SectionHeading, { children: /* @__PURE__ */ jsx("span", { id: "agent-runs-heading", children: "Senaste körningar" }) }),
      /* @__PURE__ */ jsx("ul", { className: "flex flex-col", children: recentAnalyses.map((run) => /* @__PURE__ */ jsxs("li", { className: "flex items-center gap-4 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-surface", children: [
        /* @__PURE__ */ jsx(AgentStatusDot, { status: toAgentStatus(run.status), className: "w-16 shrink-0" }),
        /* @__PURE__ */ jsxs("span", { className: "min-w-0 flex-1", children: [
          /* @__PURE__ */ jsx("span", { className: "block truncate text-sm text-content", children: run.instrument }),
          /* @__PURE__ */ jsx("span", { className: "block truncate text-xs text-content-subtle", children: run.type })
        ] }),
        /* @__PURE__ */ jsx("time", { dateTime: run.generatedAt, className: "tabular shrink-0 text-xs text-content-subtle", children: formatDateTime(run.generatedAt) })
      ] }, run.id)) }),
      /* @__PURE__ */ jsx("p", { className: "mt-6 text-xs text-content-subtle", children: "Simulerade agentkörningar. Innehållet utgör inte investeringsrådgivning." })
    ] })
  ] });
}
function toAgentStatus(status) {
  switch (status) {
    case "completed":
      return "finished";
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "queued":
      return "waiting";
  }
}
export {
  AgentsPage as component
};
