import { jsx } from "react/jsx-runtime";
import { c as cn } from "./router-Cn-L1ueB.js";
function TableWrapper({
  children,
  className
}) {
  return /* @__PURE__ */ jsx("div", { className: cn("-mx-3 overflow-x-auto px-3", className), children });
}
function Table({
  children,
  className
}) {
  return /* @__PURE__ */ jsx("table", { className: cn("w-full min-w-[560px] border-collapse text-sm", className), children });
}
function Th({
  children,
  className,
  align = "left",
  ...props
}) {
  return /* @__PURE__ */ jsx(
    "th",
    {
      scope: "col",
      className: cn(
        "px-3 pb-3 text-xs font-normal text-content-subtle",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className
      ),
      ...props,
      children
    }
  );
}
function Td({
  children,
  className,
  numeric = false,
  ...props
}) {
  return /* @__PURE__ */ jsx(
    "td",
    {
      className: cn(
        "border-t border-line px-3 py-3 text-content",
        numeric && "tabular text-right",
        className
      ),
      ...props,
      children
    }
  );
}
function Tr({ children, className }) {
  return /* @__PURE__ */ jsx("tr", { className: cn("transition-colors duration-150 hover:bg-surface-2", className), children });
}
export {
  TableWrapper as T,
  Table as a,
  Th as b,
  Tr as c,
  Td as d
};
