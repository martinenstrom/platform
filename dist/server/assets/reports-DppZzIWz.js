import { jsxs, jsx } from "react/jsx-runtime";
import { Plus, FileText } from "lucide-react";
import { P as PageShell, a as PageHeader } from "./PageHeader-Ba6TgEpl.js";
import { D as DashboardCard } from "./DashboardCard-BTCtsqDt.js";
import { B as Button, i as reports } from "./router-Cn-L1ueB.js";
import { A as AnalysisStatusBadge } from "./StatusBadge-DIJXu5p7.js";
import { T as TableWrapper, a as Table, b as Th, c as Tr, d as Td } from "./Table-hGsko79z.js";
import { g as formatDate } from "./format-jzA_cNCn.js";
import "@tanstack/react-router";
import "react";
import "clsx";
function ReportsPage() {
  return /* @__PURE__ */ jsxs(PageShell, { children: [
    /* @__PURE__ */ jsx(PageHeader, { title: "Rapporter", description: "Genererade rapporter och underlag. Exempeldata.", actions: /* @__PURE__ */ jsxs(Button, { variant: "primary", size: "sm", children: [
      /* @__PURE__ */ jsx(Plus, { className: "h-3.5 w-3.5", "aria-hidden": "true" }),
      "Ny rapport"
    ] }) }),
    /* @__PURE__ */ jsx(DashboardCard, { title: "Alla rapporter", children: /* @__PURE__ */ jsx(TableWrapper, { children: /* @__PURE__ */ jsxs(Table, { children: [
      /* @__PURE__ */ jsx("caption", { className: "sr-only", children: "Genererade rapporter med status." }),
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx(Th, { children: "Titel" }),
        /* @__PURE__ */ jsx(Th, { children: "Typ" }),
        /* @__PURE__ */ jsx(Th, { children: "Skapad" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "Sidor" }),
        /* @__PURE__ */ jsx(Th, { children: "Status" }),
        /* @__PURE__ */ jsx(Th, { align: "right", children: "Åtgärd" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: reports.map((report) => /* @__PURE__ */ jsxs(Tr, { children: [
        /* @__PURE__ */ jsx(Td, { className: "text-sm font-medium", children: report.title }),
        /* @__PURE__ */ jsx(Td, { className: "text-sm text-content-muted", children: report.type }),
        /* @__PURE__ */ jsx(Td, { className: "tabular text-sm whitespace-nowrap text-content-muted", children: formatDate(report.createdAt) }),
        /* @__PURE__ */ jsx(Td, { numeric: true, children: report.pages || "—" }),
        /* @__PURE__ */ jsx(Td, { children: /* @__PURE__ */ jsx(AnalysisStatusBadge, { status: report.status }) }),
        /* @__PURE__ */ jsx(Td, { className: "text-right", children: /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "ghost", disabled: report.status !== "completed", "aria-label": `Öppna rapporten ${report.title}`, children: [
          /* @__PURE__ */ jsx(FileText, { className: "h-3.5 w-3.5", "aria-hidden": "true" }),
          "Öppna"
        ] }) })
      ] }, report.id)) })
    ] }) }) })
  ] });
}
export {
  ReportsPage as component
};
