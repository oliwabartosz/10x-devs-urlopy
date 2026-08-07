// Polish plural selection.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.
//
// The prototype (`10xUrlopy.dc.html:1010`) uses `n >= 2 && n <= 4` for the "few" form,
// which is right for 2–4 and wrong for every higher number ending in 2–4: 22, 23, 24 and
// 122 all take "wpisy", not "wpisów". The teens are the exception to that exception —
// 12, 13, 14 take the "many" form despite ending in 2–4.
export function pluralPl(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const lastDigit = abs % 10;
  const lastTwo = abs % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

/** "1 wpis" / "2 wpisy" / "5 wpisów" — the count label on a details group header. */
export function entryCountLabel(n: number): string {
  return `${n} ${pluralPl(n, "wpis", "wpisy", "wpisów")}`;
}
