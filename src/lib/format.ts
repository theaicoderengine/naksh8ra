export function fmtDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", opts).format(new Date(d));
}
export function fmtDateTime(d: Date | string | null | undefined) {
  return fmtDate(d, { dateStyle: "medium", timeStyle: "short" });
}
export function fmtRelative(d: Date | string | null | undefined) {
  if (!d) return "—";
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return fmtDate(d);
}
export function fmtMoney(minor: number | null | undefined, currency = "USD") {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
}
export function fmtSalary(min?: number | null, max?: number | null, cur?: string | null, period?: string | null) {
  if (min == null && max == null) return null;
  const f = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: (cur ?? "USD").toUpperCase(), maximumFractionDigits: 0 }).format(n);
  const range = min != null && max != null ? `${f(min)} – ${f(max)}` : f((min ?? max)!);
  return `${range}${period ? ` / ${period.toLowerCase()}` : ""}`;
}
export function titleCase(s: string) {
  return s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export const RATING_LABEL: Record<string, string> = { INSUFFICIENT_EVIDENCE: "Insufficient evidence", R1: "1 · Limited", R2: "2 · Developing", R3: "3 · Competent", R4: "4 · Strong", R5: "5 · Exceptional" };
