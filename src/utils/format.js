// Display formatting helpers. Pure, no DOM.

export function money(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function money0(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function pct(n, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + (n * 100).toFixed(digits) + "%";
}

export function price(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

// Sign class for coloring positive/negative/neutral values.
export function signClass(n, epsilon = 1e-9) {
  if (n > epsilon) return "pos";
  if (n < -epsilon) return "neg";
  return "flat";
}

// Up/down/flat arrow glyph — the "stonks" tick. Pairs with a percentage.
export function arrow(n, epsilon = 1e-9) {
  if (n > epsilon) return "▲";
  if (n < -epsilon) return "▼";
  return "▪";
}

// Percentage prefixed with a direction arrow, e.g. "▲ 1.38%".
export function pctArrow(n, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  return arrow(n) + " " + Math.abs(n * 100).toFixed(digits) + "%";
}
