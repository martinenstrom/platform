const LOCALE = "sv-SE";
function formatCurrency(value, currency = "SEK", options = {}) {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    ...options
  }).format(value);
}
function formatNumber(value, fractionDigits = 2) {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
}
function formatPercent(value, fractionDigits = 2) {
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(Math.abs(value));
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatted} %`;
}
function formatSignedCurrency(value, currency = "SEK") {
  const formatted = formatCurrency(Math.abs(value), currency);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatted}`;
}
function formatDate(input) {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" }).format(date);
}
function formatDateTime(input) {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
function formatRelativeTime(input, now = /* @__PURE__ */ new Date()) {
  const date = typeof input === "string" ? new Date(input) : input;
  const diffMs = date.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const units = [
    ["year", 1e3 * 60 * 60 * 24 * 365],
    ["month", 1e3 * 60 * 60 * 24 * 30],
    ["day", 1e3 * 60 * 60 * 24],
    ["hour", 1e3 * 60 * 60],
    ["minute", 1e3 * 60]
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return formatter.format(Math.round(diffMs / 1e3), "second");
}
function changeTone(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}
export {
  formatSignedCurrency as a,
  formatPercent as b,
  formatDateTime as c,
  formatRelativeTime as d,
  formatNumber as e,
  formatCurrency as f,
  formatDate as g,
  changeTone as h
};
