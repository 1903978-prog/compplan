import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Copy, ExternalLink, Check, Clock } from "lucide-react";

// ── Types (mirrors readAISeed.ts) ──────────────────────────────────────────
interface Participant {
  name: string | null;
  email: string | null;
  invited: boolean;
  attended: boolean;
}

interface Meeting {
  id: string;
  start_time_ms: number;
  end_time_ms: number;
  title: string;
  report_url: string;
  participants: Participant[];
  folders: string[];
  summary: string | null;
}

// ── Category detection ─────────────────────────────────────────────────────
type Category = "intro_call" | "case_study" | "pitch" | "other";

function categorize(m: Meeting): Category {
  const t = m.title.toLowerCase();
  if (t.includes("case study")) return "case_study";
  if (/\bintro\b/.test(t) || t.includes("intro call")) return "intro_call";
  const hasExternal = m.participants.some(
    p => p.email && !p.email.endsWith("@eendigo.com")
  );
  if (hasExternal) return "pitch";
  return "other";
}

const CATEGORIES: { key: Category; label: string; color: string; badgeClass: string }[] = [
  { key: "intro_call",  label: "Hiring — Intro Call",   color: "bg-violet-100",  badgeClass: "bg-violet-100 text-violet-700 border-violet-200" },
  { key: "case_study",  label: "Hiring — Case Study",   color: "bg-blue-100",    badgeClass: "bg-blue-100 text-blue-700 border-blue-200" },
  { key: "pitch",       label: "Pitch",                  color: "bg-emerald-100", badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { key: "other",       label: "Other",                  color: "bg-slate-100",   badgeClass: "bg-slate-100 text-slate-600 border-slate-200" },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

function fmtDuration(startMs: number, endMs: number): string {
  const mins = Math.round((endMs - startMs) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function meetingClipboard(m: Meeting): string {
  const date = fmtDate(m.start_time_ms);
  const parts = m.participants
    .filter(p => p.attended)
    .map(p => p.name || p.email || "Unknown")
    .join(", ");
  const lines = [
    `TITLE: ${m.title}`,
    `DATE: ${date}`,
    `DURATION: ${fmtDuration(m.start_time_ms, m.end_time_ms)}`,
    `PARTICIPANTS: ${parts || "—"}`,
  ];
  if (m.summary) lines.push(`\nSUMMARY:\n${m.summary}`);
  return lines.join("\n");
}

// ── Row component ──────────────────────────────────────────────────────────
function MeetingRow({ m }: { m: Meeting }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const attended = m.participants.filter(p => p.attended);
  const external = attended.filter(p => p.email && !p.email.endsWith("@eendigo.com"));

  const copy = async () => {
    await navigator.clipboard.writeText(meetingClipboard(m));
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <tr className="border-b last:border-0 hover:bg-muted/20 text-xs">
      <td className="py-2 pr-3 font-medium max-w-[220px]">
        <span title={m.title} className="block truncate">{m.title}</span>
        {m.folders.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{m.folders.join(", ")}</span>
        )}
      </td>
      <td className="py-2 pr-3 font-mono text-muted-foreground whitespace-nowrap">{fmtDate(m.start_time_ms)}</td>
      <td className="py-2 pr-3">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="w-3 h-3" />
          {fmtDuration(m.start_time_ms, m.end_time_ms)}
        </span>
      </td>
      <td className="py-2 pr-3 max-w-[260px]">
        <div className="flex flex-wrap gap-1">
          {attended.length === 0
            ? <span className="text-muted-foreground italic">—</span>
            : attended.map((p, i) => {
                const name = p.name?.split(" ").slice(-1)[0] || p.email?.split("@")[0] || "?";
                const isExt = p.email && !p.email.endsWith("@eendigo.com");
                return (
                  <span key={i} className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium border ${isExt ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-muted/40 border-muted text-foreground/70"}`} title={p.email ?? undefined}>
                    {name}
                  </span>
                );
              })
          }
          {external.length > 0 && (
            <span className="text-[9px] text-amber-600 self-center">({external.length} ext)</span>
          )}
        </div>
      </td>
      <td className="py-2 pr-3 max-w-[300px] hidden lg:table-cell">
        {m.summary
          ? <span className="text-muted-foreground line-clamp-2">{m.summary}</span>
          : <span className="text-muted-foreground italic text-[10px]">No summary</span>
        }
      </td>
      <td className="py-2 text-right shrink-0">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={copy}
            title="Copy script"
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <a
            href={m.report_url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Read.ai"
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function ReadAiScripts() {
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [source, setSource] = useState<"live" | "seed" | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Category>("intro_call");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/read-ai/meetings", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setMeetings(Array.isArray(data.meetings) ? data.meetings : []);
      setSource(data.source);
      setFetchedAt(data.fetched_at ?? null);
    } catch (e) {
      toast({ title: "Failed to load Read.ai meetings", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const byCategory = useMemo(() => {
    const map: Record<Category, Meeting[]> = { intro_call: [], case_study: [], pitch: [], other: [] };
    for (const m of meetings) {
      map[categorize(m)].push(m);
    }
    // Sort each category newest first
    for (const k of Object.keys(map) as Category[]) {
      map[k].sort((a, b) => b.start_time_ms - a.start_time_ms);
    }
    return map;
  }, [meetings]);

  const activeMeetings = byCategory[activeTab] ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Read.ai Scripts"
        description={source === "live"
          ? `Live data · ${meetings.length} meetings`
          : `Seed data · ${meetings.length} meetings · last updated ${fetchedAt?.slice(0, 10) ?? "unknown"}`
        }
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Category tabs */}
      <Card className="border-border">
        <div className="flex border-b overflow-x-auto">
          {CATEGORIES.map(cat => {
            const count = byCategory[cat.key]?.length ?? 0;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveTab(cat.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === cat.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat.label}
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cat.badgeClass}`}>
                  {count}
                </Badge>
              </button>
            );
          })}
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">Loading…</p>
          ) : activeMeetings.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">No meetings in this category.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-muted-foreground tracking-wide border-b">
                  <tr>
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Duration</th>
                    <th className="py-2 pr-3">Participants</th>
                    <th className="py-2 pr-3 hidden lg:table-cell">Summary</th>
                    <th className="py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {activeMeetings.map(m => <MeetingRow key={m.id} m={m} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {source === "seed" && (
        <p className="text-[11px] text-muted-foreground italic text-center">
          Showing cached seed data. Click Refresh to pull live data (requires READ_AI_TOKEN env var).
        </p>
      )}
    </div>
  );
}
