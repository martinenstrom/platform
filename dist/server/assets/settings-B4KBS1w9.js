import { jsxs, jsx } from "react/jsx-runtime";
import { Plug, ShieldCheck } from "lucide-react";
import { P as PageShell, a as PageHeader } from "./PageHeader-Ba6TgEpl.js";
import { D as DashboardCard } from "./DashboardCard-BTCtsqDt.js";
import { B as Button } from "./router-Cn-L1ueB.js";
import { E as EmptyState } from "./EmptyState-BYuNNdnF.js";
import { S as StatusBadge } from "./StatusBadge-DIJXu5p7.js";
import "@tanstack/react-router";
import "react";
import "clsx";
const PREFERENCES = [{
  id: "currency",
  label: "Visningsvaluta",
  value: "SEK"
}, {
  id: "locale",
  label: "Språk och format",
  value: "Svenska (sv-SE)"
}, {
  id: "timezone",
  label: "Tidszon",
  value: "Europa/Stockholm"
}, {
  id: "benchmark",
  label: "Jämförelseindex",
  value: "OMXS30"
}];
function SettingsPage() {
  return /* @__PURE__ */ jsxs(PageShell, { children: [
    /* @__PURE__ */ jsx(PageHeader, { title: "Inställningar", description: "Kontoinställningar, format och framtida datakällor." }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-12", children: [
      /* @__PURE__ */ jsx(DashboardCard, { title: "Visning", className: "lg:col-span-6", bodyClassName: "p-0", children: /* @__PURE__ */ jsx("dl", { className: "divide-y divide-line", children: PREFERENCES.map((preference) => /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-3 px-4 py-3", children: [
        /* @__PURE__ */ jsx("dt", { className: "text-sm text-content-muted", children: preference.label }),
        /* @__PURE__ */ jsxs("dd", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsx("span", { className: "text-sm text-content", children: preference.value }),
          /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", children: "Ändra" })
        ] })
      ] }, preference.id)) }) }),
      /* @__PURE__ */ jsx(DashboardCard, { title: "Datakällor", className: "lg:col-span-6", children: /* @__PURE__ */ jsxs("ul", { className: "flex flex-col gap-2", children: [
        /* @__PURE__ */ jsxs("li", { className: "flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3", children: [
          /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-2.5", children: [
            /* @__PURE__ */ jsx(Plug, { className: "h-4 w-4 text-content-subtle", "aria-hidden": "true" }),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx("span", { className: "block text-sm text-content", children: "Avanza (MCP)" }),
              /* @__PURE__ */ jsx("span", { className: "block text-xs text-content-subtle", children: "Läsning av innehav och kurser" })
            ] })
          ] }),
          /* @__PURE__ */ jsx(StatusBadge, { tone: "warning", children: "Ej ansluten" })
        ] }),
        /* @__PURE__ */ jsxs("li", { className: "flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3", children: [
          /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-2.5", children: [
            /* @__PURE__ */ jsx(ShieldCheck, { className: "h-4 w-4 text-content-subtle", "aria-hidden": "true" }),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx("span", { className: "block text-sm text-content", children: "Analysagenter" }),
              /* @__PURE__ */ jsx("span", { className: "block text-xs text-content-subtle", children: "Genererar briefer och uppslag" })
            ] })
          ] }),
          /* @__PURE__ */ jsx(StatusBadge, { tone: "accent", children: "Simulerad" })
        ] })
      ] }) })
    ] }),
    /* @__PURE__ */ jsx(DashboardCard, { title: "Notiser", children: /* @__PURE__ */ jsx(EmptyState, { icon: ShieldCheck, title: "Notisregler saknas", description: "Regler för kurslarm och analysnotiser konfigureras här i ett senare steg.", action: /* @__PURE__ */ jsx(Button, { variant: "secondary", size: "sm", children: "Skapa regel" }) }) })
  ] });
}
export {
  SettingsPage as component
};
