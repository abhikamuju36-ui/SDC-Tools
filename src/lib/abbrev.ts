// Display-only abbreviations for long domain words in fixed UI band labels
// (per the SDC brand guide's short-form convention). This runs at RENDER time
// on group/phase header labels ONLY — the underlying values (e.g. "Engineering"
// / "General Engineering" / "Shop") stay intact as logic keys (billing-group
// comparisons, color maps, filter params). Never run this on data-driven text
// (job names, part/BOM descriptions, supplier/customer values).
const RULES: readonly [RegExp, string][] = [
  [/\bGeneral Engineering\b/gi, "Gen Eng"],
  [/\bEngineering\b/gi, "Eng"],
  [/\bMechanical\b/gi, "Mech"],
  [/\bElectrical\b/gi, "Elec"],
  [/\bManufacturing\b/gi, "Mfg"],
  [/\bGeneral\b/gi, "Gen"],
];

export function abbreviateLabel(s: string): string {
  let out = s;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
