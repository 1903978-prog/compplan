import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, X, ChevronDown, ChevronRight, Users, CheckSquare, ClipboardList, AlertTriangle, Calendar, Pencil, Play, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Meeting {
  id: number;
  meeting_date: string;
  status: string;
  agenda_notes: string;
  minutes_text: string;
  decisions_text: string;
  action_items: string;
  attendees: string;
  next_meeting_date: string;
  created_at: string;
  updated_at: string;
}
interface PredefinedTask {
  id: number;
  title: string;
  description: string;
  category: string;
  outcome_template: string;
  frequency: string;
  is_active: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft:       "border-slate-300 text-slate-600",
  confirmed:   "border-blue-300 text-blue-700",
  in_progress: "border-amber-300 text-amber-700",
  done:        "border-emerald-300 text-emerald-700",
};

const CAT_COLORS: Record<string, string> = {
  Performance: "bg-red-100 text-red-800",
  Sales:       "bg-blue-100 text-blue-800",
  Finance:     "bg-emerald-100 text-emerald-800",
  Hiring:      "bg-purple-100 text-purple-800",
  Strategy:    "bg-amber-100 text-amber-800",
  Operations:  "bg-cyan-100 text-cyan-800",
  Risk:        "bg-orange-100 text-orange-800",
  General:     "bg-slate-100 text-slate-700",
};

const STATUSES = ["draft", "confirmed", "in_progress", "done"];

function emptyMeeting(): Partial<Meeting> {
  return {
    meeting_date: new Date().toISOString().slice(0, 10),
    status: "draft",
    agenda_notes: "",
    minutes_text: "",
    decisions_text: "",
    action_items: "",
    attendees: "Livio",
    next_meeting_date: "",
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ExcomPage() {
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks,    setTasks]    = useState<PredefinedTask[]>([]);
  const [loading,  setLoading]  = useState(true);

  // View
  const [view, setView] = useState<"meetings" | "tasks">("meetings");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // New meeting form
  const [showNew, setShowNew]   = useState(false);
  const [newDraft, setNewDraft] = useState<Partial<Meeting>>(emptyMeeting());
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);

  // Edit meeting
  const [editId,   setEditId]   = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Meeting>>({});

  // Running a meeting
  const [runningId, setRunningId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [m, t] = await Promise.all([
        fetch("/api/excom/meetings",         { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/excom/predefined-tasks",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setMeetings(Array.isArray(m) ? m : []);
      setTasks(Array.isArray(t) ? t : []);
    } catch { toast({ title: "Load failed", variant: "destructive" }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function createMeeting() {
    // Build agenda from selected predefined tasks
    const selected = tasks.filter(t => selectedTaskIds.includes(t.id));
    let agenda = newDraft.agenda_notes ?? "";
    if (selected.length > 0) {
      const taskBlock = selected.map(t => `### ${t.title}\n${t.description}\n\nOutcome: ${t.outcome_template}`).join("\n\n---\n\n");
      agenda = agenda ? `${agenda}\n\n---\n\n${taskBlock}` : taskBlock;
    }
    try {
      const r = await fetch("/api/excom/meetings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newDraft, agenda_notes: agenda }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Meeting created" });
      setShowNew(false);
      setNewDraft(emptyMeeting());
      setSelectedTaskIds([]);
      void load();
    } catch (e) { toast({ title: "Create failed", description: (e as Error).message, variant: "destructive" }); }
  }

  async function saveMeeting(id: number) {
    try {
      const r = await fetch(`/api/excom/meetings/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Saved" });
      setEditId(null);
      void load();
    } catch (e) { toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }); }
  }

  async function deleteMeeting(id: number) {
    if (!confirm("Delete this meeting?")) return;
    await fetch(`/api/excom/meetings/${id}`, { method: "DELETE", credentials: "include" });
    void load();
  }

  async function runMeeting(id: number) {
    setRunningId(id);
    setExpandedId(id);
    try {
      const r = await fetch(`/api/excom/meetings/${id}/run`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${r.status}`);
      }
      const updated: Meeting = await r.json();
      setMeetings(prev => prev.map(m => m.id === id ? updated : m));
      toast({ title: "Meeting complete", description: "Minutes, decisions and action items generated." });
    } catch (e) {
      toast({ title: "Run failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunningId(null);
    }
  }

  async function toggleTaskActive(t: PredefinedTask) {
    await fetch(`/api/excom/predefined-tasks/${t.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: t.is_active ? 0 : 1 }),
    });
    void load();
  }

  const tasksByCategory = useMemo(() => {
    const m = new Map<string, PredefinedTask[]>();
    for (const t of tasks) {
      const arr = m.get(t.category) ?? [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  const upcoming = meetings.filter(m => m.status !== "done");
  const past = meetings.filter(m => m.status === "done");

  if (loading) return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading EXCOM…</div>;

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Users className="w-7 h-7 text-primary" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">AIOS · EXCOM</p>
            <h1 className="text-2xl font-bold tracking-tight">Executive Committee</h1>
            <p className="text-sm text-muted-foreground">{upcoming.length} upcoming · {past.length} past · {tasks.length} agenda templates</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={view === "meetings" ? "default" : "outline"} onClick={() => setView("meetings")}>
            <Calendar className="w-3.5 h-3.5 mr-1" /> Meetings
          </Button>
          <Button size="sm" variant={view === "tasks" ? "default" : "outline"} onClick={() => setView("tasks")}>
            <CheckSquare className="w-3.5 h-3.5 mr-1" /> Agenda Templates
          </Button>
          {view === "meetings" && (
            <Button size="sm" onClick={() => setShowNew(v => !v)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New Meeting
            </Button>
          )}
        </div>
      </div>

      {/* ── New meeting form ────────────────────────────────────────────── */}
      {showNew && view === "meetings" && (
        <Card className="p-4 border-2 border-primary/30 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Schedule new EXCOM meeting</h2>
            <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}><X className="w-4 h-4" /></Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Date</label>
              <Input type="date" value={newDraft.meeting_date ?? ""} onChange={e => setNewDraft(d => ({ ...d, meeting_date: e.target.value }))} className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Status</label>
              <select value={newDraft.status ?? "draft"} onChange={e => setNewDraft(d => ({ ...d, status: e.target.value }))} className="h-7 text-xs w-full rounded border px-2 bg-background mt-0.5">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Attendees</label>
              <Input value={newDraft.attendees ?? ""} onChange={e => setNewDraft(d => ({ ...d, attendees: e.target.value }))} placeholder="Livio, CEO, CHRO…" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Next meeting</label>
              <Input type="date" value={newDraft.next_meeting_date ?? ""} onChange={e => setNewDraft(d => ({ ...d, next_meeting_date: e.target.value }))} className="h-7 text-xs mt-0.5" />
            </div>
          </div>

          {/* Predefined agenda items */}
          <div>
            <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5">Add agenda items from templates</p>
            <div className="grid grid-cols-2 gap-1.5">
              {tasks.filter(t => t.is_active).map(t => (
                <label key={t.id} className="flex items-start gap-2 text-xs cursor-pointer hover:bg-muted/30 px-2 py-1.5 rounded">
                  <input type="checkbox" checked={selectedTaskIds.includes(t.id)}
                    onChange={() => setSelectedTaskIds(ids => ids.includes(t.id) ? ids.filter(i => i !== t.id) : [...ids, t.id])}
                    className="mt-0.5 shrink-0"
                  />
                  <div>
                    <span className="font-medium">{t.title}</span>
                    <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded font-semibold ${CAT_COLORS[t.category] ?? CAT_COLORS.General}`}>{t.category}</span>
                    <p className="text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Additional agenda notes</label>
            <Textarea value={newDraft.agenda_notes ?? ""} onChange={e => setNewDraft(d => ({ ...d, agenda_notes: e.target.value }))} rows={3} placeholder="Any additional items to cover…" className="text-xs mt-0.5" />
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={() => void createMeeting()}>Create meeting</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* ── Meetings view ───────────────────────────────────────────────── */}
      {view === "meetings" && (
        <div className="space-y-3">
          {meetings.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground italic">No meetings yet. Create your first EXCOM.</Card>
          )}
          {[...upcoming, ...past].map(m => {
            const isOpen  = expandedId === m.id;
            const isEditing = editId === m.id;
            return (
              <Card key={m.id} className="overflow-hidden">
                {/* Meeting header row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20"
                  onClick={() => setExpandedId(v => v === m.id ? null : m.id)}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{m.meeting_date}</span>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[m.status] ?? ""}`}>{m.status}</Badge>
                      {m.attendees && <span className="text-[10px] text-muted-foreground">👥 {m.attendees}</span>}
                      {m.next_meeting_date && <span className="text-[10px] text-muted-foreground">→ next: {m.next_meeting_date}</span>}
                    </div>
                    {m.agenda_notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.agenda_notes.slice(0, 100)}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {/* Run button — available for any non-done meeting that has an agenda */}
                    {m.status !== "done" && m.agenda_notes && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs border-primary/40 text-primary hover:bg-primary/10"
                        disabled={runningId === m.id}
                        onClick={() => void runMeeting(m.id)}
                        title="Run this meeting — agents analyze each agenda item and generate minutes + decisions"
                      >
                        {runningId === m.id
                          ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running…</>
                          : <><Play className="w-3 h-3 mr-1" /> Run meeting</>}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditId(m.id); setEditData({ ...m }); setExpandedId(m.id); }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void deleteMeeting(m.id)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Expanded: view or edit */}
                {isOpen && !isEditing && (
                  <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
                    {/* How-it-works banner — shown when agenda exists but no minutes yet */}
                    {m.agenda_notes && !m.minutes_text && m.status !== "done" && (
                      <div className="rounded border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
                        <p className="font-semibold text-primary flex items-center gap-1.5">
                          <Play className="w-3.5 h-3.5" /> How this meeting works
                        </p>
                        <p className="text-muted-foreground">
                          Click <strong>▶ Run meeting</strong> to have the CEO route each agenda item to the right specialist agent.
                          Each agent analyses their domain using live company data (invoices, pipeline, headcount, active projects),
                          then the CEO synthesises the outputs into <strong>minutes</strong>, <strong>decisions</strong>, and <strong>action items</strong>.
                          The meeting is automatically marked done.
                        </p>
                        {runningId === m.id && (
                          <p className="text-primary font-medium animate-pulse">⏳ Agents are analysing — this takes ~10 seconds…</p>
                        )}
                      </div>
                    )}
                    {m.agenda_notes && <MeetingSection icon={<ClipboardList className="w-3.5 h-3.5" />} title="Agenda" text={m.agenda_notes} />}
                    {m.minutes_text && <MeetingSection icon={<CheckSquare className="w-3.5 h-3.5" />} title="Minutes" text={m.minutes_text} />}
                    {m.decisions_text && <MeetingSection icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-600" />} title="Decisions" text={m.decisions_text} />}
                    {m.action_items && <MeetingSection icon={<CheckSquare className="w-3.5 h-3.5 text-blue-600" />} title="Action items" text={m.action_items} />}
                    {!m.agenda_notes && !m.minutes_text && !m.decisions_text && !m.action_items && (
                      <p className="text-xs text-muted-foreground italic">No content yet — click the edit button to fill in the meeting details.</p>
                    )}
                  </div>
                )}

                {isOpen && isEditing && (
                  <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Date</label>
                        <Input type="date" value={editData.meeting_date ?? ""} onChange={e => setEditData(d => ({ ...d, meeting_date: e.target.value }))} className="h-7 text-xs mt-0.5" />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Status</label>
                        <select value={editData.status ?? "draft"} onChange={e => setEditData(d => ({ ...d, status: e.target.value }))} className="h-7 text-xs w-full rounded border px-2 bg-background mt-0.5">
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Attendees</label>
                        <Input value={editData.attendees ?? ""} onChange={e => setEditData(d => ({ ...d, attendees: e.target.value }))} className="h-7 text-xs mt-0.5" />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Next meeting date</label>
                        <Input type="date" value={editData.next_meeting_date ?? ""} onChange={e => setEditData(d => ({ ...d, next_meeting_date: e.target.value }))} className="h-7 text-xs mt-0.5" />
                      </div>
                    </div>
                    {[
                      { key: "agenda_notes", label: "Agenda", rows: 5, placeholder: "Agenda items…" },
                      { key: "minutes_text", label: "Minutes", rows: 5, placeholder: "What was discussed…" },
                      { key: "decisions_text", label: "Decisions", rows: 4, placeholder: "Decisions made in this meeting…" },
                      { key: "action_items", label: "Action items", rows: 4, placeholder: "Who does what by when…" },
                    ].map(({ key, label, rows, placeholder }) => (
                      <div key={key}>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">{label}</label>
                        <Textarea
                          rows={rows}
                          value={(editData as any)[key] ?? ""}
                          onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                          placeholder={placeholder}
                          className="text-xs mt-0.5"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void saveMeeting(m.id)}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Agenda Templates view ───────────────────────────────────────── */}
      {view === "tasks" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">These templates are available when creating a new meeting. Toggle them on/off or edit outcomes.</p>
          {tasksByCategory.map(([category, catTasks]) => (
            <div key={category}>
              <div className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded mb-2 ${CAT_COLORS[category] ?? CAT_COLORS.General}`}>{category}</div>
              <div className="space-y-2">
                {catTasks.map(t => (
                  <Card key={t.id} className={`p-3 ${!t.is_active ? "opacity-50" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{t.title}</span>
                          <Badge variant="outline" className="text-[9px]">{t.frequency}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{t.description}</p>
                        {t.outcome_template && (
                          <p className="text-[10px] text-primary/70 italic mt-1">→ {t.outcome_template}</p>
                        )}
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={() => void toggleTaskActive(t)}>
                        {t.is_active ? "Disable" : "Enable"}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingSection({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-muted-foreground mb-1">{icon} {title}</div>
      <pre className="text-xs whitespace-pre-wrap font-sans text-foreground bg-background/50 rounded p-2 border">{text}</pre>
    </div>
  );
}
