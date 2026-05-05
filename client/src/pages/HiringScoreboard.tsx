import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, RefreshCw, Download, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal } from "lucide-react";
import { parseCandidateInfo } from "./Hiring";

// ── Hiring Scoreboard ──────────────────────────────────────────────────
// Flat table of every candidate with per-test scores and a weighted
// composite. Columns: Date · Logic · Verbal · Excel · P1 · P2 · TG ·
// Intro · CS Rate · CS LM (HSA / PPT / Final removed — CS LM is the
// authoritative case-study number).
//
// Table is split into 4 tier sections:
//   Tier 1  — meets all tier-1 score thresholds
//   Tier 2  — meets tier-2 but not tier-1 thresholds
//   Tier 3  — active candidates below tier-2 thresholds
//   OUT     — stage is "out" (rejected / withdrawn)
// ───────────────────────────────────────────────────────────────────────

interface Candidate {
  id: number;
  name: string;
  info: string;
  stage: string;
  scores: Record<string, number | null> | null;
  external_id?: string;
  created_at: string;
}

// ── Composite weights — no longer include HSA, PPT, or Final ──────────
// Old 7-key rubric (hsa 25 · ppt 10 · excel 10 · tg 15 · intro 10 · case 15 · final 15)
// was condensed: hsa+ppt+final weight redistributed proportionally across the
// 4 remaining keys → excel 20 · tg 30 · intro 20 · case 30.
const WEIGHTS_KEY = "scoreboard_weights_v2"; // bump version so old 7-key cache is ignored
const DEFAULT_WEIGHTS: Record<string, number> = {
  excel: 20, testgorilla: 30, intro_call: 20, case_study: 30,
};
const WEIGHT_LABELS: Record<string, string> = {
  excel: "Excel", testgorilla: "TG", intro_call: "Intro", case_study: "CS LM",
};

function loadWeights(): Record<string, number> {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (typeof parsed === "object" && Object.keys(DEFAULT_WEIGHTS).every(k => typeof parsed[k] === "number")) return parsed;
    }
  } catch {}
  return { ...DEFAULT_WEIGHTS };
}

// Weights dialog
function WeightsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<string, number>>(() => loadWeights());
  const total = Object.values(draft).reduce((a, b) => a + b, 0);
  const valid = total === 100;

  const save = () => {
    if (!valid) return;
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(draft));
    onClose();
    window.location.reload();
  };

  const reset = () => setDraft({ ...DEFAULT_WEIGHTS });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Composite Weights</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">All weights must sum to 100. Changes apply immediately.</p>
        <div className="space-y-2">
          {Object.entries(draft).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <Label className="w-16 text-xs">{WEIGHT_LABELS[k] ?? k}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={v}
                onChange={e => setDraft(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                className="h-7 w-20 text-sm"
              />
            </div>
          ))}
          <div className={`text-xs font-mono pt-1 ${valid ? "text-emerald-700" : "text-red-600 font-bold"}`}>
            Sum: {total} / 100 {!valid && "— must equal 100"}
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={save} disabled={!valid}>Save</Button>
          <Button size="sm" variant="outline" onClick={reset}>Reset defaults</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface Col {
  key: string;
  label: string;
  sub?: string;
  kind: "text" | "score";
  align?: "left" | "center";
  width?: string;
}

// HSA, PPT and Final removed. CS LM (case_study) is the authoritative
// case-study headline — same data, no duplication needed.
const STATIC_COLS: Col[] = [
  { key: "applied",     label: "Applied",   kind: "text",  align: "left",   width: "w-20" },
  { key: "logic",       label: "Logic",     kind: "score", align: "center" },
  { key: "verbal",      label: "Verbal",    kind: "score", align: "center" },
  { key: "excel",       label: "Excel",     kind: "score", align: "center" },
  { key: "pres1",       label: "P1",        kind: "score", align: "center" },
  { key: "pres2",       label: "P2",        kind: "score", align: "center" },
  { key: "testgorilla", label: "TG",        kind: "score", align: "center" },
  { key: "intro_call",  label: "Intro",     kind: "score", align: "center" },
  { key: "cs_rate",     label: "CS Rate",   kind: "score", align: "center" },
  { key: "case_study",  label: "CS LM",     kind: "score", align: "center" },
];

// ── Tier thresholds ───────────────────────────────────────────────────
// Missing scores are assumed optimistically to pass (candidate mid-funnel
// isn't unfairly penalised vs one who has completed every test).
// OUT is stage-driven (stage === "out"), not score-driven.
const TIER_THRESHOLDS = {
  tier1: { logic: 78, verbal: 100, testgorilla: 71, intro_call: 50, case_study: 60 },
  tier2: { logic: 68, verbal: 80,  testgorilla: 60, intro_call: 40, case_study: 50 },
} as const;
const TIER_FIELDS = ["logic", "verbal", "testgorilla", "intro_call", "case_study"] as const;
type TierResult = "Tier 1" | "Tier 2" | "Tier 3" | "OUT";

function computeTier(row: Record<string, number | string | null>, stage?: string): TierResult {
  if (stage === "out") return "OUT";
  const meetsTier = (thresholds: Record<string, number>) =>
    TIER_FIELDS.every(f => {
      const v = row[f];
      if (typeof v !== "number") return true; // missing → optimistic pass
      return v >= thresholds[f];
    });
  if (meetsTier(TIER_THRESHOLDS.tier1)) return "Tier 1";
  if (meetsTier(TIER_THRESHOLDS.tier2)) return "Tier 2";
  return "Tier 3";
}

// ─────────────────────────────────────────────────────────────────────

function scoreColor(n: number | null | undefined): string {
  if (n == null) return "bg-muted/20 text-muted-foreground";
  if (n >= 85) return "bg-emerald-500 text-white font-semibold";
  if (n >= 70) return "bg-emerald-200 text-emerald-900 font-semibold";
  if (n >= 55) return "bg-amber-200 text-amber-900 font-semibold";
  if (n >= 40) return "bg-orange-300 text-orange-950 font-semibold";
  return "bg-red-300 text-red-950 font-semibold";
}

function tierStyle(t: TierResult): string {
  if (t === "Tier 1") return "bg-emerald-100 text-emerald-800 border border-emerald-300";
  if (t === "Tier 2") return "bg-amber-100 text-amber-800 border border-amber-300";
  if (t === "Tier 3") return "bg-orange-100 text-orange-800 border border-orange-300";
  return "bg-red-100 text-red-700 border border-red-300"; // OUT
}

function tierSepStyle(t: TierResult): string {
  if (t === "Tier 1") return "bg-emerald-50 border-b border-emerald-200 text-emerald-800";
  if (t === "Tier 2") return "bg-amber-50 border-b border-amber-200 text-amber-800";
  if (t === "Tier 3") return "bg-orange-50 border-b border-orange-200 text-orange-800";
  return "bg-red-50 border-b border-red-200 text-red-700"; // OUT
}

function mapSubLabel(label: string): string | null {
  const l = label.toLowerCase().replace(/\s+/g, "");
  if (l.includes("logic"))  return "logic";
  if (l.includes("verbal")) return "verbal";
  if (l.includes("excel"))  return "excel";
  if (l.startsWith("pres1") || l === "pres1" || l === "presentation1") return "pres1";
  if (l.startsWith("pres2") || l === "pres2" || l === "presentation2") return "pres2";
  return null;
}

function resolveRow(c: Candidate): Record<string, number | string | null> {
  const parsed = parseCandidateInfo(c.info ?? "");
  const manual = c.scores ?? {};
  const out: Record<string, number | string | null> = {
    applied: parsed.applied || "",
    logic: null, verbal: null, excel: null, pres1: null, pres2: null,
    testgorilla: null, intro_call: null, cs_rate: null, case_study: null,
  };
  // TG sub-scores from parser
  for (const { label, pct } of parsed.tgScores) {
    const k = mapSubLabel(label);
    if (k) out[k] = pct;
  }
  // Headline scores from parser
  if (parsed.tgOverall   != null) out.testgorilla = parsed.tgOverall;
  if (parsed.introScore  != null) out.intro_call  = parsed.introScore;
  if (parsed.csRateScore != null) out.cs_rate     = parsed.csRateScore;
  if (parsed.csLMScore   != null) out.case_study  = parsed.csLMScore;
  // Manual override wins for composite keys
  for (const k of ["testgorilla", "case_study", "intro_call", "excel"]) {
    const v = manual[k];
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

function compositeScore(row: Record<string, number | string | null>, weights: Record<string, number>): number | null {
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = row[k];
    if (typeof v === "number") { num += v * w; den += w; }
  }
  if (den === 0) return null;
  return Math.round(num / den);
}

type SortKey = "name" | "stage" | "composite" | "filled" | "tier" | string;

// Tier section definitions — order is fixed
const TIER_SECTIONS: { tier: TierResult; label: string }[] = [
  { tier: "Tier 1", label: "Tier 1" },
  { tier: "Tier 2", label: "Tier 2" },
  { tier: "Tier 3", label: "Tier 3" },
  { tier: "OUT",    label: "OUT" },
];

export default function HiringScoreboard() {
  const [, setLocation] = useLocation();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("composite");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [weights, setWeightsState] = useState<Record<string, number>>(loadWeights);

  const handleWeightsClose = () => {
    setWeightsOpen(false);
    setWeightsState(loadWeights());
  };

  const cols = useMemo<Col[]>(() => STATIC_COLS.map(c => ({
    ...c,
    sub: weights[c.key] != null ? `w${weights[c.key]}` : undefined,
  })), [weights]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/hiring/candidates", { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setCandidates(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const maxFilled = Object.keys(weights).length;

  const rows = useMemo(() => {
    return candidates.map(c => {
      const row = resolveRow(c);
      const composite = compositeScore(row, weights);
      const filled = Object.keys(weights).filter(k => typeof row[k] === "number").length;
      const tier = computeTier(row, c.stage);
      return { c, row, composite, filled, tier };
    });
  }, [candidates, weights]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.c.name.toLowerCase().includes(q) ||
      (r.c.stage ?? "").toLowerCase().includes(q) ||
      (r.c.info ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    const dir = sortDir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      const pick = (r: typeof a): string | number => {
        if (sortKey === "name")      return r.c.name.toLowerCase();
        if (sortKey === "stage")     return (r.c.stage ?? "").toLowerCase();
        if (sortKey === "composite") return r.composite ?? -1;
        if (sortKey === "filled")    return r.filled;
        if (sortKey === "tier") {
          const order: Record<TierResult, number> = { "Tier 1": 1, "Tier 2": 2, "Tier 3": 3, "OUT": 4 };
          return order[r.tier];
        }
        const v = r.row[sortKey];
        if (typeof v === "number") return v;
        if (typeof v === "string") return v.toLowerCase();
        return -1;
      };
      const av = pick(a), bv = pick(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(k);
      setSortDir(k === "name" || k === "stage" || k === "applied" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 inline opacity-40 ml-1" />;
    return sortDir === "desc"
      ? <ArrowDown className="w-3 h-3 inline ml-1" />
      : <ArrowUp className="w-3 h-3 inline ml-1" />;
  };

  const exportCsv = () => {
    const headerCells = ["Name", "Stage", "Tier", ...cols.map(c => c.label), "Weighted Avg", `Filled /${maxFilled}`];
    const lines = [headerCells.join(",")];
    for (const r of sorted) {
      const cells: string[] = [
        `"${r.c.name.replace(/"/g, '""')}"`,
        r.c.stage ?? "",
        r.tier,
        ...cols.map(col => {
          const v = r.row[col.key];
          if (v == null) return "";
          return typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '""')}"`;
        }),
        r.composite != null ? String(r.composite) : "",
        String(r.filled),
      ];
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hiring-scoreboard-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Total colspan for separator rows: # + Name + Stage + cols + WeightedAvg + Filled + Tier
  const totalCols = 3 + cols.length + 3;

  return (
    <div>
      <WeightsDialog open={weightsOpen} onClose={handleWeightsClose} />
      <PageHeader
        title="Hiring Scoreboard"
        description="Every candidate, every test score. Weighted Avg uses the configured weights. Missing scores are skipped and their weight redistributed."
        actions={
          <div className="flex gap-2">
            <Link href="/hiring">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Pipeline
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => setWeightsOpen(true)}>
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1" /> Weights
            </Button>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reload
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={sorted.length === 0}>
              <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
            </Button>
          </div>
        }
      />

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            placeholder="Search name, stage or notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 max-w-xs text-sm"
          />
          <div className="text-[11px] text-muted-foreground">
            {sorted.length} candidate{sorted.length === 1 ? "" : "s"}
            {search && ` (filtered from ${rows.length})`}
          </div>
          <div className="text-[10px] text-muted-foreground italic ml-auto space-y-0.5">
            <div>Sub-scores (Logic · Verbal · P1 · P2) are display-only — TG overall already carries their weight.</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold not-italic">Tiers</span>
              <span className="bg-emerald-100 text-emerald-800 px-1 rounded text-[9px] font-semibold">T1</span>
              <span>Logic≥78 · Verbal≥100 · TG≥71 · Intro≥50 · CS≥60</span>
              <span className="bg-amber-100 text-amber-800 px-1 rounded text-[9px] font-semibold">T2</span>
              <span>Logic≥68 · Verbal≥80 · TG≥60 · Intro≥40 · CS≥50</span>
              <span className="bg-orange-100 text-orange-800 px-1 rounded text-[9px] font-semibold">T3</span>
              <span>Below T2 · still active</span>
              <span className="bg-red-100 text-red-700 px-1 rounded text-[9px] font-semibold">OUT</span>
              <span>Stage = Out</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No candidates {search ? "match this search" : "yet"}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:bg-muted/50 min-w-[140px]"
                    onClick={() => toggleSort("name")}
                  >
                    Name<SortIcon k="name" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:bg-muted/50"
                    onClick={() => toggleSort("stage")}
                  >
                    Stage<SortIcon k="stage" />
                  </TableHead>
                  {cols.map(col => (
                    <TableHead
                      key={col.key}
                      className={`cursor-pointer select-none hover:bg-muted/50 ${col.align === "center" ? "text-center" : ""} ${col.width ?? ""}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      {col.sub && <>
                        <br />
                        <span className="text-[9px] font-normal text-muted-foreground">{col.sub}</span>
                      </>}
                      <SortIcon k={col.key} />
                    </TableHead>
                  ))}
                  <TableHead
                    className="cursor-pointer select-none hover:bg-muted/50 text-center font-bold"
                    onClick={() => toggleSort("composite")}
                  >
                    Weighted<br />avg<SortIcon k="composite" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:bg-muted/50 text-center"
                    onClick={() => toggleSort("filled")}
                  >
                    /{maxFilled}<SortIcon k="filled" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:bg-muted/50 text-center font-bold"
                    onClick={() => toggleSort("tier")}
                  >
                    Tier<SortIcon k="tier" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  let globalRank = 0;
                  return TIER_SECTIONS.flatMap(({ tier, label }) => {
                    const group = sorted.filter(r => r.tier === tier);
                    if (group.length === 0) return [];

                    const sepRow = (
                      <TableRow key={`sep-${tier}`}>
                        <TableCell colSpan={totalCols} className={`py-1.5 px-4 ${tierSepStyle(tier)}`}>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2 h-5 rounded-full text-[10px] font-bold ${tierStyle(tier)}`}>
                              {label}
                            </span>
                            <span className="text-[11px] font-medium">
                              {group.length} candidate{group.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );

                    const dataRows = group.map(r => {
                      globalRank++;
                      const rank = globalRank;
                      return (
                        <TableRow key={r.c.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setLocation("/hiring")}>
                          <TableCell className="text-[11px] text-muted-foreground font-mono">{rank}</TableCell>
                          <TableCell className="font-semibold text-sm">{r.c.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground capitalize whitespace-nowrap">
                            {(r.c.stage ?? "").replace(/_/g, " ")}
                          </TableCell>
                          {cols.map(col => {
                            const v = r.row[col.key];
                            if (col.kind === "text") {
                              return (
                                <TableCell key={col.key} className={`text-xs whitespace-nowrap ${col.align === "center" ? "text-center" : ""}`}>
                                  {typeof v === "string" && v ? v : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell key={col.key} className="text-center">
                                <span className={`inline-flex items-center justify-center w-11 h-7 rounded font-mono text-[11px] ${scoreColor(typeof v === "number" ? v : null)}`}>
                                  {typeof v === "number" ? (v % 1 === 0 ? v : v.toFixed(1)) : "—"}
                                </span>
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center justify-center w-14 h-8 rounded font-mono text-sm ${scoreColor(r.composite)}`}>
                              {r.composite ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground font-mono">
                            {r.filled}/{maxFilled}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center justify-center px-2 h-6 rounded-full text-[11px] font-semibold ${tierStyle(r.tier)}`}>
                              {r.tier}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    });

                    return [sepRow, ...dataRows];
                  });
                })()}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
