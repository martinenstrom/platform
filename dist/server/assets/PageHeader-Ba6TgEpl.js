import { jsx, jsxs } from "react/jsx-runtime";
import { c as cn } from "./router-Cn-L1ueB.js";
function PageHeader({ title, description, actions, className }) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: cn(
        "flex flex-col gap-4 pt-6 lg:flex-row lg:items-center lg:justify-between",
        className
      ),
      children: [
        /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
          /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold tracking-tight text-content", children: title }),
          description && /* @__PURE__ */ jsx("p", { className: "mt-1 max-w-2xl text-sm text-content-muted", children: description })
        ] }),
        actions && /* @__PURE__ */ jsx("div", { className: "flex flex-wrap items-center gap-2 lg:justify-end", children: actions })
      ]
    }
  );
}
function PageShell({
  children,
  className
}) {
  return /* @__PURE__ */ jsx("div", { className: cn("mx-auto flex max-w-[1400px] flex-col gap-10", className), children });
}
export {
  PageShell as P,
  PageHeader as a
};
