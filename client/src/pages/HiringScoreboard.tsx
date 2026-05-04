import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
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
// Flat, read-only table mirroring the Eendigo admin page's columns so
// the hiring lead sees EVERY data point captured per candidate:
//   Date · Logic · Verbal · Excel · P1 · P2 · TG · Intro · CS Rate · CS LM
// plus the manual-only composite inputs (HSA / PPT / Final) and the
// final Weighted Average.
//
// Data flow:
//   `info` blob   →  parseCandidateInfo() →  detail fields (sub-scores, dates)
//   `scores` JSON →  manual overrides (Candidate Scoring page)
//   Manual entries ALWAYS win over parsed values — they represent a
//   deliberate human decision.
//
// Weighted Avg uses the 6-test rubric (HSA 30 · TG 25 · Case 25 · Intro
// 10 · PPT 5 · Final 5). TG sub-scores and CS Rate are *display-only*
// — they don't double-count in the composite because TG overall and
// CS LM already capture the headline number for those sections.
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

// Composite rubric — editable via the Weights popup (persists to localStorage).
const WEIGHTS_KEY = "scoreboard_weights_v1";
const DEFAULT_WEIGHTS: Record<string, number> = {
  hsa: 25, ppt: 10, excel: 10, testgorilla: 15, intro_call: 10, case_study: 15, final: 15,
};
const WEIGHT_LABELS: Record<string, string> = {
  hsa: "HSA", ppt: "PPT", excel: "Excel", testgorilla: "TG", intro_call: "Intro", case_study: "CS LM", final: "Final",
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

// Weights dialog — shown on demand
function WeightsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<string, number>>(() => loadWeights());
  const total = Object.values(draft).reduce((a, b) => a + b, 0);
  const valid = total === 100;

  const save = () => {
    if (!valid) return;
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(draft));
    onClose();
    window.location.reload(); // refresh so composites recompute
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

// Display columns in the table, left-to-right. Each column pulls from
// either the parsed `info` or the manual `scores` JSON.
//   kind:
//     "text"     — render as plain text (e.g. applied date)
//     "score"    — render as coloured score cell (0-100)
//   sortKey used for column click-to-sort.
interface Col {
  key: string;
  label: string;
  sub?: string;           // tiny hint under the header (e.g. "w25")
  kind: "text" | "score";
  align?: "left" | "center";
  width?: string;
}
// COLS is computed dynamically in the component to reflect live weights.
// Static keys that have no weight get no sub-label.
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
  { key: "hsa",         label: "HSA",       kind: "score", align: "center" },
  { key: "ppt",         label: "PPT",       kind: "score", align: "center" },
  { key: "final",       label: "Final",     kind: "score", align: "center" },
];

function scoreColor(n: number | null | undefined): string {
  if (n == null) return "bg-muted/20 text-muted-foreground";
  if (n >= 85) return "bg-emerald-500 text-white font-semibold";
  if (n >= 70) return "bg-emerald-200 text-emerald-900 font-semibold";
  if (n >= 55) return "bg-amber-200 text-amber-900 font-semibold";
  if (n >= 40) return "bg-orange-300 text-orange-950 font-semibold";
  return "bg-red-300 text-red-950 font-semibold";
}

// Normalise a TG sub-score label from the parser into our column key.
// The parser preserves whatever label the sync wrote ("Logic", "Verbal",
// "Excel", "Pres1", "Presentation 1", "Pres 2", etc.) so we match loosely.
function mapSubLabel(label: string): string | null {
  const l = label.toLowerCase().replace(/\s+/g, "");
  if (l.includes("logic"))  return "logic";
  if (l.includes("verbal")) return "verbal";
  if (l.includes("excel"))  return "excel";
  if (l.startsWith("pres1") || l === "pres1" || l === "presentation1") return "pres1";
  if (l.startsWith("pres2") || l === "pres2" || l === "presentation2") return "pres2";
  return null;
}

// Resolve every display field for one candidate.
// Returns:
//   text fields  → string or ""
//   score fields → number or null
// Manual `scores[k]` always wins over parsed values for the 6 composite
// keys. TG sub-scores and CS Rate live only in the parsed blob today
// (no manual override yet — add one here if the team wants it later).
function resolveRow(c: Candidate): Record<string, number | string | null> {
  const parsed = parseCandidateInfo(c.info ?? "");
  const manual = c.scores ?? {};
  const out: Record<string, number | string | null> = {
    applied: parsed.applied || "",
    logic:  null, verbal: null, excel: null, pres1: null, pres2: null,
    testgorilla: null, intro_call: null, cs_rate: null, case_study: null,
    hsa: null, ppt: null, final: null,
  };
  // TG sub-scores (parser-only)
  for (const { label, pct } of parsed.tgScores) {
    const k = mapSubLabel(label);
    if (k) out[k] = pct;
  }
  // Headline scores from parser
  if (parsed.tgOverall  != null) out.testgorilla = parsed.tgOverall;
  if (parsed.introScore != null) out.intro_call  = parsed.introScore;
  if (parsed.csRateScore != null) out.cs_rate    = parsed.csRateScore;
  if (parsed.csLMScore  != null) out.case_study  = parsed.csLMScore;
  // Manual override wins for the seven composite keys (added 'excel'
  // alongside 'ppt' as a separate test — the Excel parsed sub-score
  // still lights up the Excel column when no manual override is set).
  for (const k of ["hsa", "testgorilla", "case_study", "intro_call", "ppt", "excel", "final"]) {
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

type SortKey = "name" | "stage" | "composite" | "filled" | string;

export default function HiringScoreboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("composite");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [weights, setWeightsState] = useState<Record<string, number>>(loadWeights);

  // Reload weights from localStorage whenever the dialog closes
  const handleWeightsClose = () => {
    setWeightsOpen(false);
    setWeightsState(loadWeights());
  };

  // Cols with dynamic weight sub-labels
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

  const rows = useMemo(() => {
    return candidates.map(c => {
      const row = resolveRow(c);
      const composite = compositeScore(row, weights);
      const filled = Object.keys(weights).filter(k => typeof row[k] === "number").length;
      return { c, row, composite, filled };
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

  // CSV export — honours current sort + filter. Every visible column is
  // exported so Excel / Google Sheets gets a 1:1 copy of the on-screen
  // view (easy to paste into the Eendigo admin or email to the team).
  const exportCsv = () => {
    const headerCells = ["Name", "Stage", ...cols.map(c => c.label), "Weighted Avg", "Filled /6"];
    const lines = [headerCells.join(",")];
    for (const r of sorted) {
      const cells: string[] = [
        `"${r.c.name.replace(/"/g, '""')}"`,
        r.c.stage ?? "",
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
          <div className="text-[10px] text-muted-foreground italic ml-auto">
            Sub-scores (Logic · Verbal · Excel · P1 · P2) are displayed only — TG overall already carries their weight. CS Rate is the assessor rating; CS LM is the final line-manager decision (authoritative for the composite).
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
                    / 6<SortIcon k="filled" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r, i) => (
                  <TableRow key={r.c.id} className="hover:bg-muted/20">
                    <TableCell className="text-[11px] text-muted-foreground font-mono">{i + 1}</TableCell>
                    <TableCell className="font-semibold text-sm">
                      {r.c.name}
                    </TableCell>
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
                      {r.filled}/6
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
