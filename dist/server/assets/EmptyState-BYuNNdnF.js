import { jsxs, jsx } from "react/jsx-runtime";
import { c as cn } from "./router-Cn-L1ueB.js";
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className
}) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className
      ),
      children: [
        /* @__PURE__ */ jsx("span", { className: "flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2", children: /* @__PURE__ */ jsx(Icon, { className: "h-5 w-5 text-content-muted", "aria-hidden": "true" }) }),
        /* @__PURE__ */ jsx("h3", { className: "mt-3 text-sm font-semibold text-content", children: title }),
        /* @__PURE__ */ jsx("p", { className: "mt-1 max-w-sm text-xs leading-relaxed text-content-muted", children: description }),
        action && /* @__PURE__ */ jsx("div", { className: "mt-4", children: action })
      ]
    }
  );
}
export {
  EmptyState as E
};
