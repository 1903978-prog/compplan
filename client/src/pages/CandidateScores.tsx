import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, ArrowLeft, Save, RefreshCw, Info, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { parseCandidateInfo } from "./Hiring";

// ── Candidate Scoring Dashboard ────────────────────────────────────────────
// A ranked view of every candidate with per-test scores across the funnel.
// Opens from a button on the Hiring Pipeline page. Each row is one
// candidate, each column is one test. The composite score is a weighted
// average of the available scores (tests without a score are skipped and
// their weight redistributed across the tests that do have scores, so a
// candidate mid-funnel isn't unfairly ranked lower than someone finished).
//
// Scale: 0-100 per test. 0 = failed, 100 = perfect. Null = not yet tested.
//
// Weights (sum to 100) — matching the user's stated order of importance:
//   HSA               30
//   TestGorilla       25
//   Case study (EM)   25
//   Intro call        10
//   PowerPoint task    5
//   Final interview    5
//
// All weights are editable inline at the top of the page. Changes persist
// in localStorage so the team can tune the formula without a deploy.

interface Candidate {
  id: number;
  name: string;
  info: string;
  stage: string;
  scores: Record<string, number | null> | null;
  external_id?: string;
  created_at: string;
}

interface TestDef { id: string; label: string; short: string }

// Order matters — left-to-right column order in the grid.
// Funnel-aligned tests:
//   Logic  → TestGorilla Logic sub-score (replaces the old "HSA" column;
//            HSA in practice was Logic + Verbal anyway, now split out)
//   Verbal → TestGorilla Verbal sub-score
//   PPT    → PowerPoint task / TG Pres
//   Excel  → Excel skills test (TG Excel)
//   TG     → TestGorilla overall composite
//   Intro  → ASC-EM intro call rating
//   Case   → case-study rating (ASC-EM)
//   LM     → line-manager review of the case (id 'final' for back-compat
//            with stored manual scores).
const TESTS: TestDef[] = [
  { id: "logic",       label: "Logic",           short: "Logic" },
  { id: "verbal",      label: "Verbal",          short: "Verbal"},
  { id: "ppt",         label: "PowerPoint task", short: "PPT"   },
  { id: "excel",       label: "Excel test",      short: "Excel" },
  { id: "testgorilla", label: "TestGorilla",     short: "TG"    },
  { id: "intro_call",  label: "Intro call",      short: "Intro" },
  { id: "case_study",  label: "Case study (EM)", short: "Case"  },
  { id: "final",       label: "LM case review",  short: "LM"    },
];

// Weights sum to 100. The old HSA bucket (25%) is now split between
// Logic (15) and Verbal (10) — Logic carries more weight per the
// founder's stated preference for analytical rigour. LM case stays
// the strongest go/no-go signal at 15%.
const DEFAULT_WEIGHTS: Record<string, number> = {
  logic: 15, verbal: 10, ppt: 10, excel: 10, testgorilla: 15, intro_call: 10, case_study: 15, final: 15,
};
const WEIGHTS_KEY = "candidate_score_weights_v1";

// Candidates who have ALL four of these tests are in Group 1 (complete screen).
// Everyone else lands in Group 2 (partial / still in progress).
const G1_REQUIRED = ["logic", "verbal", "testgorilla", "intro_call"];

// Color band for a 0-100 score — keeps the grid scannable without a key.
function scoreColor(n: number | null | undefined): string {
  if (n == null) return "bg-muted/30 text-muted-foreground";
  if (n >= 85) return "bg-emerald-500/90 text-white font-semibold";
  if (n >= 70) return "bg-emerald-200 text-emerald-900 font-semibold";
  if (n >= 55) return "bg-amber-200 text-amber-900 font-semibold";
  if (n >= 40) return "bg-orange-300 text-orange-950 font-semibold";
  return "bg-red-300 text-red-950 font-semibold";
}

function compositeScore(scores: Record<string, number | null> | null, weights: Record<string, number>): number | null {
  if (!scores) return null;
  let totalWeight = 0, weighted = 0;
  for (const t of TESTS) {
    const v = scores[t.id];
    const w = weights[t.id] ?? 0;
    if (typeof v === "number" && !isNaN(v) && w > 0) {
      weighted += v * w;
      totalWeight += w;
    }
  }
  if (totalWeight === 0) return null;
  return Math.round(weighted / totalWeight);
}

export default function CandidateScores() {
  const { toast } = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(WEIGHTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return { ...DEFAULT_WEIGHTS, ...parsed };
      }
    } catch { /* ignore */ }
    return DEFAULT_WEIGHTS;
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scoreBuffer, setScoreBuffer] = useState<Record<string, string>>({});
  const [backfilling, setBackfilling] = useState(false);

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

  const totalWeight = useMemo(() => Object.values(weights).reduce((s, w) => s + (w || 0), 0), [weights]);
  const weightsOff100 = Math.abs(totalWeight - 100) > 0.01;

  const saveWeights = () => {
    try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights)); } catch { /* quota */ }
    toast({ title: "Weights saved" });
  };

  const resetWeights = () => {
    setWeights(DEFAULT_WEIGHTS);
    try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(DEFAULT_WEIGHTS)); } catch { /* quota */ }
    toast({ title: "Weights reset to defaults" });
  };

  const startEditing = (c: Candidate) => {
    setEditingId(c.id);
    const buf: Record<string, string> = {};
    for (const t of TESTS) {
      const v = c.scores?.[t.id];
      buf[t.id] = typeof v === "number" ? String(v) : "";
    }
    setScoreBuffer(buf);
  };

  const saveScores = async (c: Candidate) => {
    const next: Record<string, number | null> = { ...(c.scores ?? {}) };
    for (const t of TESTS) {
      const v = scoreBuffer[t.id];
      if (v === "" || v == null) { next[t.id] = null; continue; }
      const n = parseFloat(v);
      if (isNaN(n)) { toast({ title: `Invalid ${t.label} score`, variant: "destructive" }); return; }
      next[t.id] = Math.max(0, Math.min(100, n));
    }
    // Optimistic update
    setCandidates(prev => prev.map(x => x.id === c.id ? { ...x, scores: next } : x));
    setEditingId(null);
    const r = await fetch(`/api/hiring/candidates/${c.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores: next }),
    });
    if (!r.ok) {
      toast({ title: "Failed to save scores", variant: "destructive" });
      load(); // re-sync
    }
  };

  // Backfill scores from the free-text `info` blob that the Eendigo sync
  // writes. Many candidates have real TestGorilla / Intro / CS LM values
  // sitting in `info` but their `scores` JSONB column is empty, so the
  // ranking ignores them. This sweeps every candidate, runs the same
  // parser used by the popup, and copies the numeric fields into
  // `scores` WITHOUT overwriting anything already present.
  //
  // Mapping:
  //   parsed.tgOverall    → scores.testgorilla
  //   parsed.introScore   → scores.intro_call
  //   parsed.csLMScore    → scores.case_study  (LM is the authoritative
  //                                             post-case-study score;
  //                                             falls back to csRateScore
  //                                             if LM absent)
  //   HSA / PPT / Final   → not present in info, left as-is
  //
  // Partial data is fine — the composite formula already redistributes
  // weight across whatever scores are present.
  const backfillFromNotes = async () => {
    if (!confirm(`Scan ${candidates.length} candidates and fill any missing scores from their notes? Existing scores are preserved.`)) return;
    setBackfilling(true);
    let updated = 0, skipped = 0;
    try {
      for (const c of candidates) {
        const parsed = parseCandidateInfo(c.info ?? "");
        const current = c.scores ?? {};
        const patch: Record<string, number> = {};
        const findSub = (label: string): number | null => {
          const lower = label.toLowerCase();
          const hit = parsed.tgScores.find(s => s.label.toLowerCase().includes(lower));
          return hit ? Math.max(0, Math.min(100, hit.pct)) : null;
        };
        // Only set a field if it's currently null/undefined AND we have a number
        if (current.testgorilla == null && parsed.tgOverall != null) {
          patch.testgorilla = Math.max(0, Math.min(100, parsed.tgOverall));
        }
        if (current.intro_call == null && parsed.introScore != null) {
          patch.intro_call = Math.max(0, Math.min(100, parsed.introScore));
        }
        if (current.case_study == null) {
          const csNum = parsed.csLMScore ?? parsed.csRateScore;
          if (csNum != null) patch.case_study = Math.max(0, Math.min(100, csNum));
        }
        // Logic / Verbal / Excel from TG sub-scores ("Logic 81.8%" lines)
        const lg = findSub("logic"); if (lg != null && current.logic == null)   patch.logic  = lg;
        const vb = findSub("verbal"); if (vb != null && current.verbal == null) patch.verbal = vb;
        const ex = findSub("excel"); if (ex != null && current.excel == null)   patch.excel  = ex;
        if (Object.keys(patch).length === 0) { skipped++; continue; }
        const next = { ...current, ...patch };
        // Optimistic local update so the ranking reshuffles immediately
        setCandidates(prev => prev.map(x => x.id === c.id ? { ...x, scores: next } : x));
        const r = await fetch(`/api/hiring/candidates/${c.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scores: next }),
        });
        if (r.ok) updated++;
      }
      toast({ title: `Backfill done`, description: `${updated} candidate${updated === 1 ? "" : "s"} updated, ${skipped} already complete or no parseable scores.` });
    } catch (e: any) {
      toast({ title: "Backfill failed", description: e?.message ?? "Unknown error", variant: "destructive" });
      load(); // re-sync from server
    } finally {
      setBackfilling(false);
    }
  };

  // Count how many of the "Not yet scored" candidates have at least one
  // parseable score in their info — used to label the button so the user
  // knows it'll do something before clicking.
  const backfillPreview = useMemo(() => {
    let n = 0;
    for (const c of candidates) {
      const parsed = parseCandidateInfo(c.info ?? "");
      const current = c.scores ?? {};
      const hasSub = (label: string) =>
        parsed.tgScores.some(s => s.label.toLowerCase().includes(label));
      const wouldAdd =
        (current.testgorilla == null && parsed.tgOverall != null) ||
        (current.intro_call == null && parsed.introScore != null) ||
        (current.case_study == null && (parsed.csLMScore != null || parsed.csRateScore != null)) ||
        (current.logic  == null && hasSub("logic")) ||
        (current.verbal == null && hasSub("verbal")) ||
        (current.excel  == null && hasSub("excel"));
      if (wouldAdd) n++;
    }
    return n;
  }, [candidates]);

  // Effective scores = manual entries FIRST, parsed-from-notes as
  // fallback. This way the ranking shows ALL candidates who have any
  // parseable data (TG overall, Intro, CS LM / CS Rate) without
  // requiring a DB write — the Backfill button just persists these
  // values so manual overrides don't disappear on next sync.
  const effectiveScores = (c: Candidate): Record<string, number | null> => {
    const manual = c.scores ?? {};
    const parsed = parseCandidateInfo(c.info ?? "");
    const out: Record<string, number | null> = { ...manual };
    if (out.testgorilla == null && parsed.tgOverall != null) out.testgorilla = parsed.tgOverall;
    if (out.intro_call == null && parsed.introScore != null) out.intro_call = parsed.introScore;
    if (out.case_study == null) {
      const cs = parsed.csLMScore ?? parsed.csRateScore;
      if (cs != null) out.case_study = cs;
    }
    // Logic + Verbal + Excel come from TG sub-score lines in the
    // parsed info blob ("Logic 81.8%", "Verbal 100.0%", "Excel 35.0%").
    // The Eendigo admin page surfaces these per candidate; we mirror
    // them here so the composite formula uses the real screen values.
    const findSub = (label: string): number | null => {
      const lower = label.toLowerCase();
      const hit = parsed.tgScores.find(s => s.label.toLowerCase().includes(lower));
      return hit ? Math.max(0, Math.min(100, hit.pct)) : null;
    };
    if (out.logic == null) {
      const v = findSub("logic"); if (v != null) out.logic = v;
    }
    if (out.verbal == null) {
      const v = findSub("verbal"); if (v != null) out.verbal = v;
    }
    if (out.excel == null) {
      const v = findSub("excel"); if (v != null) out.excel = v;
    }
    return out;
  };

  // Ranking — every candidate whose effective scores produce a
  // composite lands in the ranked table. "Not yet scored" now really
  // means "no parseable data AND no manual entries" — which is the
  // honest answer.
  const ranked = useMemo(() => {
    const enriched = candidates.map(c => {
      const eff = effectiveScores(c);
      return { c, score: compositeScore(eff, weights), eff };
    });
    const withScore = enriched.filter(r => r.score != null).sort((a, b) => (b.score! - a.score!));
    const noScore = enriched.filter(r => r.score == null);
    return { withScore, noScore };
  }, [candidates, weights]);

  const filtered = (list: { c: Candidate; score: number | null }[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(r =>
      r.c.name.toLowerCase().includes(q) ||
      (r.c.info ?? "").toLowerCase().includes(q) ||
      (r.c.external_id ?? "").toLowerCase().includes(q),
    );
  };

  return (
    <div>
      <PageHeader
        title="Candidate Scoring"
        description="Ranked view of every candidate with per-test scores and a weighted composite."
        actions={
          <div className="flex gap-2">
            <Link href="/hiring">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Pipeline
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reload
            </Button>
            <Button
              size="sm"
              onClick={backfillFromNotes}
              disabled={backfilling || backfillPreview === 0}
              title={backfillPreview === 0 ? "All scores already filled from notes" : `Will fill scores for ${backfillPreview} candidate${backfillPreview === 1 ? "" : "s"} with parseable data in notes`}
            >
              <Wand2 className="w-3.5 h-3.5 mr-1" />
              {backfilling ? "Backfilling…" : `Backfill from notes${backfillPreview > 0 ? ` (${backfillPreview})` : ""}`}
            </Button>
          </div>
        }
      />

      <div className="space-y-5">
        {/* Weight configuration ------------------------------------------- */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">Composite weights (must sum to 100)</h3>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded ml-auto ${
              weightsOff100 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}>
              Sum: {totalWeight}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {TESTS.map(t => (
              <div key={t.id} className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">{t.short}</label>
                <Input
                  type="number" min="0" max="100" step="1"
                  value={weights[t.id] ?? 0}
                  onChange={e => setWeights(w => ({ ...w, [t.id]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) }))}
                  className="h-8 text-sm text-center font-mono"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={resetWeights}>Reset to defaults</Button>
            <Button size="sm" onClick={saveWeights} disabled={weightsOff100}>
              <Save className="w-3.5 h-3.5 mr-1" /> Save weights
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground italic">
            Missing scores are skipped and their weight redistributed across the tests a candidate has actually taken, so
            someone mid-funnel isn't unfairly ranked lower than someone further along. Scale is 0-100 per test.
          </div>
        </Card>

        {/* Ranked table ---------------------------------------------------- */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="font-bold text-sm">
              Ranked candidates
              <span className="text-muted-foreground font-normal ml-2">({ranked.withScore.length} scored, {ranked.noScore.length} not scored)</span>
            </h3>
            <Input
              placeholder="Filter by name / email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-sm w-56 ml-auto"
            />
          </div>

          {loading ? (
            <div className="text-xs text-muted-foreground italic">Loading candidates…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-center">#</TableHead>
                    <TableHead>Candidate</TableHead>
                    {TESTS.map(t => (
                      <TableHead key={t.id} className="text-center w-20 text-[10px]">
                        <div>{t.short}</div>
                        <div className="font-normal text-muted-foreground text-[9px]">{weights[t.id] ?? 0}%</div>
                      </TableHead>
                    ))}
                    <TableHead className="text-center w-20">Composite</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered(ranked.withScore).map((row, i) => {
                    const c = row.c;
                    const comp = row.score!;
                    const isEditing = editingId === c.id;
                    const stageLabel = c.stage.replace(/_/g, " ");
                    return (
                      <TableRow key={c.id} className={i === 0 && !search ? "bg-amber-50/60" : ""}>
                        <TableCell className="text-center font-bold font-mono">
                          {i === 0 && !search ? <Trophy className="w-3.5 h-3.5 text-amber-500 mx-auto" /> : i + 1}
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-sm">{c.name || <span className="italic text-muted-foreground">Unnamed</span>}</div>
                          <div className="text-[10px] text-muted-foreground capitalize">{stageLabel}</div>
                        </TableCell>
                        {TESTS.map(t => {
                          // Prefer manual entry for display; fall back to
                          // the effective score (parsed from notes) so the
                          // ranking cells actually show a value before the
                          // user has saved anything.
                          const manualV = c.scores?.[t.id];
                          const v = typeof manualV === "number" ? manualV : row.eff[t.id];
                          if (isEditing) {
                            return (
                              <TableCell key={t.id} className="p-1">
                                <Input
                                  type="number" min="0" max="100" step="1"
                                  placeholder="—"
                                  value={scoreBuffer[t.id] ?? ""}
                                  onChange={e => setScoreBuffer(s => ({ ...s, [t.id]: e.target.value }))}
                                  className="h-7 text-xs text-center font-mono p-1"
                                />
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={t.id} className="text-center p-1">
                              <span className={`inline-flex items-center justify-center w-12 h-7 rounded font-mono text-xs ${scoreColor(v)}`}>
                                {typeof v === "number" ? v : "—"}
                              </span>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center justify-center w-14 h-8 rounded font-mono text-sm ${scoreColor(comp)}`}>
                            {comp}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingId(null)}>✕</Button>
                              <Button size="sm" className="h-7 w-7 p-0" onClick={() => saveScores(c)}>✓</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startEditing(c)}>
                              Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Not yet scored -------------------------------------------------- */}
        {ranked.noScore.length > 0 && (
          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-muted-foreground">Not yet scored ({ranked.noScore.length})</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {filtered(ranked.noScore).map(({ c }) => (
                <button
                  key={c.id}
                  onClick={() => startEditing(c)}
                  className="text-xs border border-dashed rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  {c.name || <span className="italic text-muted-foreground">Unnamed</span>}
                  <span className="text-[9px] text-muted-foreground ml-1 capitalize">· {c.stage.replace(/_/g, " ")}</span>
                </button>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground italic">
              Click a name to open its scoring row above (editable). A candidate stays in this section until they have at least one non-null score.
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
