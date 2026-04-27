// Commercial-proposal "3 timeline options" math.
//
// Single source of truth for the per-option net total computation used by:
//   - PricingTool.tsx case editor (renders the editable 3-column table)
//   - PricingTool.tsx Pricing Cases LIST (Target/wk column shows
//     centralOptionWeekly = Option 2 net / Option 2 weeks)
//   - Future call sites that need the same per-option net.
//
// IMPORTANT: keep the math here identical to what the case editor renders.
// The user's expectation is that the displayed "Target/wk" everywhere equals
// what they'd compute by hand from the central column of that table.

export type Timeline = {
  weeks: number;
  commitPct: number;
  grossTotal?: number;
  commitAmount?: number;
  note?: string;
};

export type CaseDiscount = { id: string; name: string; pct: number; enabled: boolean };

export type ColumnResult = {
  weeks: number;
  commitPct: number;
  grossTotal: number;
  netTotal: number;
  hasGrossOverride: boolean;
  breakdown: { id: string; name: string; pct: number; amount: number }[];
  note?: string;
};

/**
 * Compute one Option column from a timeline + the canonical gross weekly +
 * the case's discount list.
 *
 * Math (mirrors the user's commercial-proposal table):
 *   gross  = override if set, else grossWk × weeks
 *   net    = gross compounded through every enabled non-commitment discount,
 *            then minus a flat commitment deduction (override or commitPct ×
 *            grossTotal, NOT compound).
 */
export function computeOptionColumn(
  t: Timeline,
  grossWk: number,
  caseDiscounts: CaseDiscount[],
): ColumnResult {
  const weeks = t.weeks;
  const commitPct = t.commitPct;
  // Match the case editor's filter: only enabled, positive, non-commitment
  // discounts contribute compound deductions. Zero-pct discounts are
  // intentionally NOT shown as breakdown rows (parity with the inline
  // computeColumn that this helper replaces).
  const baseEnabled = caseDiscounts.filter(d => d.enabled && d.pct > 0 && d.id !== "commitment");
  const grossTotal = typeof t.grossTotal === "number" && t.grossTotal > 0
    ? Math.round(t.grossTotal)
    : Math.round(grossWk * weeks);
  let running = grossTotal;
  const breakdown: ColumnResult["breakdown"] = [];
  for (const d of baseEnabled) {
    const before = running;
    running = running * (1 - d.pct / 100);
    breakdown.push({ id: d.id, name: d.name, pct: d.pct, amount: Math.round(before - running) });
  }
  const commitAmt = typeof t.commitAmount === "number" && t.commitAmount > 0
    ? Math.round(t.commitAmount)
    : (commitPct > 0 ? Math.round(grossTotal * commitPct / 100) : 0);
  breakdown.push({ id: "commitment", name: "Additional commitment discount", pct: commitPct, amount: commitAmt });
  const netTotal = Math.round(running - commitAmt);
  return {
    weeks,
    commitPct,
    grossTotal,
    netTotal,
    hasGrossOverride: typeof t.grossTotal === "number" && t.grossTotal > 0,
    breakdown,
    note: t.note,
  };
}

/**
 * Derive the displayed "Target / wk" for a saved pricing case from its
 * central commercial-proposal column (Option 2 = caseTimelines[1]).
 *
 * Returns null when we can't compute it (no recommendation, no timelines,
 * missing discount config). Callers should fall back to the recommendation's
 * own target_weekly in that case.
 */
export function centralOptionWeekly(args: {
  recommendation: { target_weekly?: number } | null | undefined;
  case_timelines: Timeline[] | null | undefined;
  case_discounts: CaseDiscount[] | null | undefined;
  admin_fee_pct?: number | null;
}): number | null {
  const rec = args.recommendation;
  const timelines = args.case_timelines ?? [];
  const discounts = args.case_discounts ?? [];
  if (!rec || !rec.target_weekly || rec.target_weekly <= 0) return null;
  // Prefer Option 2 (index 1). Fall back to Option 1 if the user only
  // configured one timeline — better than returning null and showing "—".
  const t = timelines[1] ?? timelines[0];
  if (!t || !t.weeks || t.weeks <= 0) return null;
  // Reconstruct canonical gross weekly the same way PricingTool's
  // canonicalGrossWeekly does: net × (1+admin) compounded UP through every
  // enabled non-commitment discount. Commitment is applied per-option in
  // computeOptionColumn so it must NOT be folded into grossWk.
  const adminPct = args.admin_fee_pct ?? 0;
  const baseEnabled = discounts.filter(d => d.enabled && d.id !== "commitment" && d.pct > 0);
  let grossWk = rec.target_weekly * (1 + adminPct / 100);
  for (const d of baseEnabled) {
    grossWk = grossWk / (1 - d.pct / 100);
  }
  const col = computeOptionColumn(t, grossWk, discounts);
  if (!col.weeks) return null;
  return col.netTotal / col.weeks;
}
