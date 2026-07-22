import { jsxs, jsx } from "react/jsx-runtime";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { c as cn } from "./router-Cn-L1ueB.js";
import { b as formatPercent, h as changeTone } from "./format-jzA_cNCn.js";
const TONE_CLASS = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-content-muted"
};
function ChangeValue({
  value,
  label,
  showIcon = true,
  className
}) {
  const tone = changeTone(value);
  const Icon = tone === "positive" ? TrendingUp : tone === "negative" ? TrendingDown : Minus;
  return /* @__PURE__ */ jsxs(
    "span",
    {
      className: cn(
        "tabular inline-flex items-center gap-1 font-medium",
        TONE_CLASS[tone],
        className
      ),
      children: [
        showIcon && /* @__PURE__ */ jsx(Icon, { className: "h-3.5 w-3.5", "aria-hidden": "true" }),
        label ?? formatPercent(value)
      ]
    }
  );
}
export {
  ChangeValue as C
};
