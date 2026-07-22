import { jsxs, jsx } from "react/jsx-runtime";
import { c as cn } from "./router-Cn-L1ueB.js";
function DashboardCard({
  title,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = "section"
}) {
  return /* @__PURE__ */ jsxs(Tag, { className: cn("flex flex-col rounded-xl bg-surface p-6 shadow-card", className), children: [
    (title || action) && /* @__PURE__ */ jsxs("header", { className: "mb-4 flex items-center justify-between gap-4", children: [
      title && /* @__PURE__ */ jsx("h2", { className: "truncate text-sm font-medium text-content", children: title }),
      action && /* @__PURE__ */ jsx("div", { className: "flex shrink-0 items-center gap-2", children: action })
    ] }),
    /* @__PURE__ */ jsx("div", { className: cn("flex-1", bodyClassName), children })
  ] });
}
function SectionHeading({
  children,
  action
}) {
  return /* @__PURE__ */ jsxs("div", { className: "mb-4 flex items-center justify-between gap-4", children: [
    /* @__PURE__ */ jsx("h2", { className: "text-sm font-medium text-content", children }),
    action
  ] });
}
export {
  DashboardCard as D,
  SectionHeading as S
};
