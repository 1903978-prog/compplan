import { describe, it, expect } from "vitest";
import { computeOptionColumn, centralOptionWeekly } from "./proposalOptions";
import type { CaseDiscount, Timeline } from "./proposalOptions";

// ─── computeOptionColumn ──────────────────────────────────────────────────────

describe("computeOptionColumn", () => {
  const noDiscounts: CaseDiscount[] = [];

  it("no discounts, no commitment → gross = net", () => {
    const r = computeOptionColumn({ weeks: 12, commitPct: 0 }, 10_000, noDiscounts);
    expect(r.grossTotal).toBe(120_000);
    expect(r.netTotal).toBe(120_000);
    expect(r.hasGrossOverride).toBe(false);
    expect(r.hasNetOverride).toBe(false);
  });

  it("commitment only (5 %) deducted flat from gross", () => {
    const r = computeOptionColumn({ weeks: 16, commitPct: 5 }, 10_000, noDiscounts);
    expect(r.grossTotal).toBe(160_000);
    expect(r.netTotal).toBe(152_000); // 160k − 8k
  });

  it("one enabled discount (10 %) + commitment (5 %): commitment applies on grossTotal, not post-discount", () => {
    const discounts: CaseDiscount[] = [{ id: "vol", name: "Volume", pct: 10, enabled: true }];
    const r = computeOptionColumn({ weeks: 12, commitPct: 5 }, 10_000, discounts);
    expect(r.grossTotal).toBe(120_000);
    // after vol: 108 000; commitAmt = round(120k*5/100) = 6 000
    expect(r.netTotal).toBe(102_000);
    expect(r.breakdown[0]).toMatchObject({ id: "vol", amount: 12_000 });
  });

  it("two discounts compound sequentially, commitment is flat on gross", () => {
    const discounts: CaseDiscount[] = [
      { id: "d1", name: "D1", pct: 10, enabled: true },
      { id: "d2", name: "D2", pct: 5, enabled: true },
    ];
    const r = computeOptionColumn({ weeks: 10, commitPct: 7 }, 20_000, discounts);
    expect(r.grossTotal).toBe(200_000);
    // 200k →d1→ 180k →d2→ 171k; commitAmt = round(200k*7%) = 14k
    expect(r.netTotal).toBe(157_000);
  });

  it("grossTotal override replaces grossWk×weeks", () => {
    const r = computeOptionColumn({ weeks: 12, commitPct: 0, grossTotal: 150_000 }, 10_000, noDiscounts);
    expect(r.grossTotal).toBe(150_000);
    expect(r.netTotal).toBe(150_000);
    expect(r.hasGrossOverride).toBe(true);
  });

  it("netTotal override wins over computed net", () => {
    const r = computeOptionColumn({ weeks: 12, commitPct: 5, netTotal: 100_000 }, 10_000, noDiscounts);
    expect(r.grossTotal).toBe(120_000);
    expect(r.netTotal).toBe(100_000); // override, not 120k−6k
    expect(r.hasNetOverride).toBe(true);
  });

  it("commitAmount override replaces pct×gross", () => {
    const r = computeOptionColumn({ weeks: 12, commitPct: 5, commitAmount: 3_000 }, 10_000, noDiscounts);
    // pct alone would give 6 000; override gives 3 000
    expect(r.netTotal).toBe(117_000);
    const commit = r.breakdown.find(b => b.id === "commitment");
    expect(commit?.amount).toBe(3_000);
  });

  it("disabled discount is not applied", () => {
    const discounts: CaseDiscount[] = [{ id: "d1", name: "D1", pct: 20, enabled: false }];
    const r = computeOptionColumn({ weeks: 12, commitPct: 0 }, 10_000, discounts);
    expect(r.netTotal).toBe(120_000);
  });

  it("zero-pct discount is not included in breakdown (only commitment row present)", () => {
    const discounts: CaseDiscount[] = [{ id: "d1", name: "D1", pct: 0, enabled: true }];
    const r = computeOptionColumn({ weeks: 12, commitPct: 0 }, 10_000, discounts);
    expect(r.breakdown).toHaveLength(1); // only the commitment row
    expect(r.breakdown[0].id).toBe("commitment");
  });

  it("commitment id in caseDiscounts does not double-count", () => {
    const discounts: CaseDiscount[] = [{ id: "commitment", name: "Commit", pct: 5, enabled: true }];
    // commitment in the list should be filtered out from baseEnabled, only applied via commitPct
    const r = computeOptionColumn({ weeks: 12, commitPct: 5 }, 10_000, discounts);
    expect(r.grossTotal).toBe(120_000);
    expect(r.netTotal).toBe(114_000); // 120k − 6k (once, not twice)
  });

  it("fractional grossWk rounds correctly", () => {
    const r = computeOptionColumn({ weeks: 3, commitPct: 0 }, 3_333.33, noDiscounts);
    expect(r.grossTotal).toBe(10_000); // round(9999.99)
  });
});

// ─── centralOptionWeekly ──────────────────────────────────────────────────────

describe("centralOptionWeekly", () => {
  const noDiscounts: CaseDiscount[] = [];
  const twoTimelines: Timeline[] = [
    { weeks: 12, commitPct: 0 },
    { weeks: 16, commitPct: 5 },
  ];

  it("returns null when recommendation is null", () => {
    expect(centralOptionWeekly({ recommendation: null, case_timelines: twoTimelines, case_discounts: noDiscounts })).toBeNull();
  });

  it("returns null when target_weekly is 0", () => {
    expect(centralOptionWeekly({ recommendation: { target_weekly: 0 }, case_timelines: twoTimelines, case_discounts: noDiscounts })).toBeNull();
  });

  it("returns null when timelines is empty", () => {
    expect(centralOptionWeekly({ recommendation: { target_weekly: 10_000 }, case_timelines: [], case_discounts: noDiscounts })).toBeNull();
  });

  it("returns null when option 2 weeks is 0", () => {
    const tls: Timeline[] = [{ weeks: 12, commitPct: 0 }, { weeks: 0, commitPct: 5 }];
    expect(centralOptionWeekly({ recommendation: { target_weekly: 10_000 }, case_timelines: tls, case_discounts: noDiscounts })).toBeNull();
  });

  it("uses option 2 (index 1) net ÷ weeks — no admin, no discounts, commit 5 %", () => {
    // grossWk = 10_000 (no admin, no discounts to reverse)
    // option 2: weeks=16, gross=160k, commit=8k, net=152k → 152k/16 = 9500
    const r = centralOptionWeekly({ recommendation: { target_weekly: 10_000 }, case_timelines: twoTimelines, case_discounts: noDiscounts });
    expect(r).toBe(9_500);
  });

  it("falls back to option 1 when only one timeline", () => {
    const oneTl: Timeline[] = [{ weeks: 12, commitPct: 0 }];
    // grossWk=10k, gross=120k, net=120k, weekly=10k
    const r = centralOptionWeekly({ recommendation: { target_weekly: 10_000 }, case_timelines: oneTl, case_discounts: noDiscounts });
    expect(r).toBe(10_000);
  });

  it("admin fee inflates grossWk before option computation", () => {
    const oneTl: Timeline[] = [{ weeks: 10, commitPct: 0 }];
    // grossWk = 10_000 * 1.10 = 11_000; gross=110k, net=110k, weekly=11k
    const r = centralOptionWeekly({ recommendation: { target_weekly: 10_000 }, case_timelines: oneTl, case_discounts: noDiscounts, admin_fee_pct: 10 });
    expect(r).toBe(11_000);
  });
});
