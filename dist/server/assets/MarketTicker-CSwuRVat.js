import { jsx, jsxs } from "react/jsx-runtime";
import { c as cn } from "./router-Cn-L1ueB.js";
import { C as ChangeValue } from "./ChangeValue-C_Bo7YCU.js";
import { f as formatCurrency, e as formatNumber } from "./format-jzA_cNCn.js";
function MarketTicker({
  quote,
  className
}) {
  const value = quote.currency ? formatCurrency(quote.value, quote.currency) : formatNumber(quote.value, quote.precision);
  return /* @__PURE__ */ jsxs(
    "li",
    {
      className: cn(
        "flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2",
        className
      ),
      children: [
        /* @__PURE__ */ jsx("span", { className: "min-w-0 truncate text-sm text-content", children: quote.name }),
        /* @__PURE__ */ jsxs("span", { className: "flex shrink-0 items-center gap-3", children: [
          /* @__PURE__ */ jsx("span", { className: "tabular text-sm font-medium text-content", children: value }),
          /* @__PURE__ */ jsx(
            ChangeValue,
            {
              value: quote.changePercent,
              showIcon: false,
              className: "w-16 justify-end text-xs"
            }
          )
        ] })
      ]
    }
  );
}
function MarketTickerList({ quotes }) {
  return /* @__PURE__ */ jsx("ul", { className: "-mx-2 flex flex-col", children: quotes.map((quote) => /* @__PURE__ */ jsx(MarketTicker, { quote }, quote.id)) });
}
export {
  MarketTickerList as M
};
