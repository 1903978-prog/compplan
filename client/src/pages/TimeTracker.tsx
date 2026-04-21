import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { Plus, Trash2, Play, Square, Pencil, Check, X, ChevronLeft, ChevronRight, Clock, CalendarPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Convert an ISO UTC timestamp (what the DB stores) into the "YYYY-MM-DDTHH:mm"
// string that <input type="datetime-local"> expects — always in the user's
// local time zone. The input refuses to show a value with a trailing "Z" or
// a timezone offset, so we strip both and round to minutes.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Reverse: the datetime-local value is a local wall-clock string with no TZ.
// `new Date("YYYY-MM-DDTHH:mm")` interprets it as local time, so `.toISOString()`
// correctly produces the equivalent UTC timestamp we send back to the server.
function localInputToIso(val: string): string | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

interface Topic { id: number; name: string; sort_order: number }
interface Entry { id: number; topic_id: number; topic_name: string; start_time: string; end_time: string | null }

function fmtHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekStart(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TimeTracker() {
  const { toast } = useToast();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [newTopicName, setNewTopicName] = useState("");
  const [editingTopicId, setEditingTopicId] = useState<number | null>(null);
  const [editTopicName, setEditTopicName] = useState("");
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null);
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = last week

  // ── Manual time editing ───────────────────────────────────────────────────
  // The user often forgets to click Start at the right moment — e.g. they
  // start a meeting at 14:00 but only remember to click Start at 14:20, or
  // they finish a task without clicking Stop and come back an hour later.
  // These three pieces of state back three flows:
  //
  //  1. Adjusting the start_time of the currently-running timer (backdate it
  //     to when the work actually began).
  //  2. Adding a manual past entry with both start and end times (useful for
  //     work done offline / across sessions).
  //  3. Editing an existing (already-stopped) entry's start/end/topic.
  //
  // All three PUT/POST against the same endpoints — the server already
  // accepts arbitrary start_time/end_time in the body.
  const [adjustingStartFor, setAdjustingStartFor] = useState<number | null>(null);
  const [adjustStartDraft, setAdjustStartDraft] = useState("");

  const [showAddManual, setShowAddManual] = useState(false);
  const [manualTopicId, setManualTopicId] = useState<string>("");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");

  // Quick-log: one-click "I spent 30m / 1h / 1h30 on topic X" without having
  // to pick start/end times. The entry is synthesized with end_time = now
  // and start_time = now - duration, so it always lands in "today".
  const [quickLogTopicId, setQuickLogTopicId] = useState<string>("");

  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editEntryTopicId, setEditEntryTopicId] = useState<string>("");
  const [editEntryStart, setEditEntryStart] = useState("");
  const [editEntryEnd, setEditEntryEnd] = useState("");
  const [showAllEntries, setShowAllEntries] = useState(false);

  // Load data
  useEffect(() => {
    fetch("/api/time-tracking/topics", { credentials: "include" })
      .then(r => r.json()).then(setTopics).catch(() => {});
    fetch("/api/time-tracking/entries", { credentials: "include" })
      .then(r => r.json()).then((data: Entry[]) => {
        setEntries(data);
        // Find active entry (no end_time)
        const active = data.find(e => !e.end_time);
        if (active) {
          setActiveEntryId(active.id);
          setActiveTopic({ id: active.topic_id, name: active.topic_name, sort_order: 0 });
        }
      }).catch(() => {});
  }, []);

  // Tick timer
  useEffect(() => {
    if (!activeEntryId) { setElapsed(0); return; }
    const active = entries.find(e => e.id === activeEntryId);
    if (!active) return;
    const tick = () => {
      const start = new Date(active.start_time).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [activeEntryId, entries]);

  // Topics CRUD
  const addTopic = async () => {
    if (!newTopicName.trim()) return;
    const res = await fetch("/api/time-tracking/topics", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTopicName.trim(), sort_order: topics.length }),
    });
    const t = await res.json();
    setTopics(prev => [...prev, t]);
    setNewTopicName("");
  };

  const saveEditTopic = async () => {
    if (!editingTopicId || !editTopicName.trim()) return;
    const res = await fetch(`/api/time-tracking/topics/${editingTopicId}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editTopicName.trim() }),
    });
    const updated = await res.json();
    setTopics(prev => prev.map(t => t.id === updated.id ? updated : t));
    setEditingTopicId(null);
  };

  const deleteTopic = async (id: number) => {
    await fetch(`/api/time-tracking/topics/${id}`, { method: "DELETE", credentials: "include" });
    setTopics(prev => prev.filter(t => t.id !== id));
  };

  // Start/Stop
  const startTimer = async (topic: Topic) => {
    // Stop any running timer first
    if (activeEntryId) await stopTimer();
    const now = new Date().toISOString();
    const res = await fetch("/api/time-tracking/entries", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic_id: topic.id, topic_name: topic.name, start_time: now, end_time: null }),
    });
    const entry = await res.json();
    setEntries(prev => [...prev, entry]);
    setActiveEntryId(entry.id);
    setActiveTopic(topic);
  };

  const stopTimer = async () => {
    if (!activeEntryId) return;
    const now = new Date().toISOString();
    const res = await fetch(`/api/time-tracking/entries/${activeEntryId}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ end_time: now }),
    });
    const updated = await res.json();
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
    setActiveEntryId(null);
    setActiveTopic(null);
    setElapsed(0);
  };

  const deleteEntry = async (id: number) => {
    await fetch(`/api/time-tracking/entries/${id}`, { method: "DELETE", credentials: "include" });
    setEntries(prev => prev.filter(e => e.id !== id));
    if (activeEntryId === id) {
      setActiveEntryId(null);
      setActiveTopic(null);
    }
  };

  // ── Manual time editing handlers ──────────────────────────────────────────

  // Backdate the running timer: change only start_time (end_time stays null).
  // Refuses a future time — backdating forward would make elapsed go negative.
  const saveAdjustStart = async () => {
    if (!adjustingStartFor || !adjustStartDraft) return;
    const iso = localInputToIso(adjustStartDraft);
    if (!iso) { toast({ title: "Invalid time", variant: "destructive" }); return; }
    if (new Date(iso).getTime() > Date.now()) {
      toast({ title: "Can't set start in the future", variant: "destructive" });
      return;
    }
    const res = await fetch(`/api/time-tracking/entries/${adjustingStartFor}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_time: iso }),
    });
    if (res.ok) {
      const updated = await res.json();
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
      toast({ title: "Start time adjusted" });
    } else {
      toast({ title: "Failed to adjust start", variant: "destructive" });
    }
    setAdjustingStartFor(null);
    setAdjustStartDraft("");
  };

  // Quick-log duration: "I worked N minutes on topic X". Creates an entry
  // ending now and starting (now - duration). Fast path for the common case
  // of remembering a 30-minute task after the fact without wanting to pick
  // exact start/end times.
  const quickLog = async (minutes: number) => {
    if (!quickLogTopicId) {
      toast({ title: "Pick a topic first", variant: "destructive" });
      return;
    }
    const topic = topics.find(t => t.id === Number(quickLogTopicId));
    if (!topic) return;
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);
    const res = await fetch("/api/time-tracking/entries", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic_id: topic.id, topic_name: topic.name,
        start_time: start.toISOString(), end_time: end.toISOString(),
      }),
    });
    if (res.ok) {
      const entry = await res.json();
      setEntries(prev => [...prev, entry]);
      const label = minutes >= 60
        ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
        : `${minutes}m`;
      toast({ title: `Logged ${label} on ${topic.name}` });
    } else {
      toast({ title: "Failed to log time", variant: "destructive" });
    }
  };

  // Create a past entry with both start and end populated. Intended for work
  // done before you opened the tracker or on another device.
  const saveManualEntry = async () => {
    if (!manualTopicId || !manualStart || !manualEnd) {
      toast({ title: "Topic, start and end are required", variant: "destructive" });
      return;
    }
    const topic = topics.find(t => t.id === Number(manualTopicId));
    if (!topic) return;
    const startIso = localInputToIso(manualStart);
    const endIso = localInputToIso(manualEnd);
    if (!startIso || !endIso) { toast({ title: "Invalid time", variant: "destructive" }); return; }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      toast({ title: "End must be after start", variant: "destructive" });
      return;
    }
    const res = await fetch("/api/time-tracking/entries", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic_id: topic.id, topic_name: topic.name,
        start_time: startIso, end_time: endIso,
      }),
    });
    if (res.ok) {
      const entry = await res.json();
      setEntries(prev => [...prev, entry]);
      toast({ title: "Entry added" });
      setShowAddManual(false);
      setManualTopicId(""); setManualStart(""); setManualEnd("");
    } else {
      toast({ title: "Failed to add entry", variant: "destructive" });
    }
  };

  // Open inline editor for an existing entry; pre-fill from current values.
  const openEditEntry = (entry: Entry) => {
    setEditingEntryId(entry.id);
    setEditEntryTopicId(String(entry.topic_id));
    setEditEntryStart(isoToLocalInput(entry.start_time));
    setEditEntryEnd(isoToLocalInput(entry.end_time));
  };

  // Save edits to an existing entry. Allows changing topic, start, end, or
  // any subset. An empty end becomes null (re-opens the entry as running —
  // only useful if no other timer is active).
  const saveEditEntry = async () => {
    if (!editingEntryId) return;
    const startIso = localInputToIso(editEntryStart);
    if (!startIso) { toast({ title: "Start time required", variant: "destructive" }); return; }
    const endIso = editEntryEnd ? localInputToIso(editEntryEnd) : null;
    if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      toast({ title: "End must be after start", variant: "destructive" });
      return;
    }
    const topic = editEntryTopicId ? topics.find(t => t.id === Number(editEntryTopicId)) : null;
    const patch: any = { start_time: startIso, end_time: endIso };
    if (topic) { patch.topic_id = topic.id; patch.topic_name = topic.name; }
    const res = await fetch(`/api/time-tracking/entries/${editingEntryId}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
      toast({ title: "Entry updated" });
      setEditingEntryId(null);
    } else {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  // Compute daily/weekly data
  const today = new Date();
  const todayStr = dateStr(today);
  const currentWeekStart = addDays(weekStart(today), weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const weekLabel = `${dateStr(weekDays[0]).slice(5)} — ${dateStr(weekDays[6]).slice(5)}`;

  // Orphan detection — entries with end_time=null that are NOT the currently
  // active timer. These are the "I started a timer but never clicked Stop"
  // cases. Previously we silently dropped them from the daily aggregate,
  // which made the whole day appear to be "0 time tracked" even after real
  // work. We now count them (implicit end = now, capped at 12h to avoid
  // a single forgotten entry inflating totals to days) AND surface them in
  // a warning banner so the user can fix the end times explicitly.
  const MAX_ORPHAN_HOURS = 12;
  const orphanEntries = useMemo(
    () => entries.filter(e => !e.end_time && e.id !== activeEntryId),
    [entries, activeEntryId],
  );

  // Calculate minutes per topic per day.
  // Filter rule: include every entry that has a start_time. For entries
  // without an end_time, treat the effective end as "now" (capped at
  // MAX_ORPHAN_HOURS after start for non-active orphans). This keeps
  // forgotten-Stop work visible instead of invisibly evaporating it.
  const dailyData = useMemo(() => {
    const result: Record<string, Record<string, number>> = {}; // topicName -> dateStr -> minutes
    const nowMs = Date.now();
    for (const entry of entries) {
      const startMs = new Date(entry.start_time).getTime();
      if (isNaN(startMs)) continue;
      let endMs: number;
      if (entry.end_time) {
        endMs = new Date(entry.end_time).getTime();
        if (isNaN(endMs) || endMs <= startMs) continue;
      } else if (entry.id === activeEntryId) {
        endMs = nowMs; // live-running timer
      } else {
        // Orphan — cap the implicit end to avoid runaway totals.
        endMs = Math.min(nowMs, startMs + MAX_ORPHAN_HOURS * 3600 * 1000);
        if (endMs <= startMs) continue;
      }
      const mins = (endMs - startMs) / 60000;
      if (mins <= 0) continue;
      const day = dateStr(new Date(startMs));
      if (!result[entry.topic_name]) result[entry.topic_name] = {};
      result[entry.topic_name][day] = (result[entry.topic_name][day] || 0) + mins;
    }
    return result;
  }, [entries, activeEntryId, elapsed]); // elapsed to trigger re-render

  // One-click fixer: close every orphan entry right now (end_time = now).
  // Useful when the user realises they left 3 timers running yesterday —
  // one click and the daily totals instantly reflect "up to this moment".
  const closeAllOrphans = async () => {
    const nowIso = new Date().toISOString();
    const updates: Entry[] = [];
    for (const o of orphanEntries) {
      try {
        const res = await fetch(`/api/time-tracking/entries/${o.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ end_time: nowIso }),
        });
        if (res.ok) updates.push(await res.json());
      } catch { /* best-effort */ }
    }
    if (updates.length > 0) {
      setEntries(prev => prev.map(e => updates.find(u => u.id === e.id) ?? e));
      toast({ title: `Closed ${updates.length} open entr${updates.length === 1 ? "y" : "ies"}` });
    }
  };

  // Today's data
  const todayByTopic = useMemo(() => {
    const rows: { name: string; mins: number }[] = [];
    for (const topic of topics) {
      const mins = dailyData[topic.name]?.[todayStr] || 0;
      rows.push({ name: topic.name, mins });
    }
    // Add topics from entries not in current topic list
    const topicNames = new Set(topics.map(t => t.name));
    for (const [name, days] of Object.entries(dailyData)) {
      if (!topicNames.has(name) && days[todayStr]) {
        rows.push({ name, mins: days[todayStr] });
      }
    }
    return rows;
  }, [topics, dailyData, todayStr]);

  const todayTotal = todayByTopic.reduce((s, r) => s + r.mins, 0);

  // Weekly data
  const weeklyByTopic = useMemo(() => {
    const weekDateStrs = weekDays.map(d => dateStr(d));
    const allTopicNames = new Set([...topics.map(t => t.name), ...Object.keys(dailyData)]);
    const rows: { name: string; daily: number[]; total: number }[] = [];
    for (const name of allTopicNames) {
      const daily = weekDateStrs.map(d => dailyData[name]?.[d] || 0);
      const total = daily.reduce((s, v) => s + v, 0);
      if (total > 0 || topics.some(t => t.name === name)) {
        rows.push({ name, daily, total });
      }
    }
    return rows;
  }, [topics, dailyData, weekDays]);

  const weeklyTotalsPerDay = useMemo(() => {
    const totals = Array(7).fill(0);
    for (const row of weeklyByTopic) {
      row.daily.forEach((v, i) => { totals[i] += v; });
    }
    return totals;
  }, [weeklyByTopic]);

  const weekGrandTotal = weeklyTotalsPerDay.reduce((s, v) => s + v, 0);

  const fmtElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h > 0 ? h + "h " : ""}${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Time Tracker" description="Track time spent on different activities." />

      {/* Active timer banner */}
      {activeTopic && (() => {
        const activeEntry = entries.find(e => e.id === activeEntryId);
        const startStr = activeEntry
          ? new Date(activeEntry.start_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
          : "";
        const isAdjusting = adjustingStartFor === activeEntryId;
        return (
          <Card className="p-4 border-primary/50 bg-primary/5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-bold text-lg">{activeTopic.name}</span>
                <span className="font-mono text-2xl font-bold text-primary">{fmtElapsed(elapsed)}</span>
                {activeEntry && !isAdjusting && (
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustingStartFor(activeEntryId);
                      setAdjustStartDraft(isoToLocalInput(activeEntry.start_time));
                    }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-primary/10"
                    title="Click to backdate the start time if you forgot to click Start earlier"
                  >
                    <Clock className="w-3 h-3" />
                    Started at {startStr}
                    <Pencil className="w-3 h-3 opacity-60" />
                  </button>
                )}
              </div>
              <Button variant="destructive" size="sm" onClick={stopTimer}>
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            </div>
            {isAdjusting && (
              <div className="mt-3 p-3 rounded border border-primary/30 bg-background flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Backdate start to:</span>
                <Input
                  type="datetime-local"
                  value={adjustStartDraft}
                  onChange={e => setAdjustStartDraft(e.target.value)}
                  className="h-8 text-sm w-auto"
                  max={isoToLocalInput(new Date().toISOString())}
                  autoFocus
                />
                <Button size="sm" variant="default" className="h-8" onClick={saveAdjustStart}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Save
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAdjustingStartFor(null); setAdjustStartDraft(""); }}>
                  <X className="w-3.5 h-3.5 mr-1" /> Cancel
                </Button>
                <span className="text-[10px] text-muted-foreground italic ml-auto">
                  Use this when you forgot to click Start at the actual beginning of the task
                </span>
              </div>
            )}
          </Card>
        );
      })()}

      {/* Topics + Start buttons */}
      <Card className="p-4">
        <h3 className="font-bold text-sm mb-3">Topics</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {topics.map(topic => {
            const isActive = activeTopic?.id === topic.id;
            const isEditing = editingTopicId === topic.id;
            return (
              <div key={topic.id} className="flex items-center gap-1">
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <Input className="h-8 w-28 text-sm" value={editTopicName}
                      onChange={e => setEditTopicName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveEditTopic(); if (e.key === "Escape") setEditingTopicId(null); }}
                      autoFocus />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-emerald-600" onClick={saveEditTopic}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setEditingTopicId(null)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className={`flex items-center rounded-lg border px-3 py-1.5 gap-2 transition-colors ${isActive ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}>
                    <button
                      className="font-medium text-sm"
                      onClick={() => { setEditingTopicId(topic.id); setEditTopicName(topic.name); }}
                    >
                      {topic.name}
                    </button>
                    {isActive ? (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={stopTimer}>
                        <Square className="w-3.5 h-3.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600" onClick={() => startTimer(topic)}>
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteTopic(topic.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-1">
            <Input className="h-9 w-32 text-sm" placeholder="New topic..."
              value={newTopicName} onChange={e => setNewTopicName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addTopic(); }} />
            <Button size="sm" variant="outline" onClick={addTopic} disabled={!newTopicName.trim()}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Manual past-entry form — for when you forgot to click Start. */}
        <div className="border-t pt-3">
          {!showAddManual ? (
            <Button
              size="sm" variant="outline"
              onClick={() => {
                // Pre-fill with "last hour" window — most common case is "I just
                // finished a call that started an hour ago and forgot to track it."
                const now = new Date();
                const hourAgo = new Date(now.getTime() - 3600 * 1000);
                setManualStart(isoToLocalInput(hourAgo.toISOString()));
                setManualEnd(isoToLocalInput(now.toISOString()));
                setManualTopicId(topics[0] ? String(topics[0].id) : "");
                setShowAddManual(true);
              }}
              className="text-xs"
            >
              <CalendarPlus className="w-3.5 h-3.5 mr-1.5" />
              Add past entry (manual start/end)
            </Button>
          ) : (
            <div className="space-y-2 p-3 rounded border border-dashed bg-muted/20">
              <div className="text-xs font-semibold text-muted-foreground">
                Add entry with manual start and end times
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-muted-foreground block">Topic</label>
                  <Select value={manualTopicId} onValueChange={setManualTopicId}>
                    <SelectTrigger className="h-8 text-sm w-48"><SelectValue placeholder="Choose topic" /></SelectTrigger>
                    <SelectContent>
                      {topics.map(t => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-muted-foreground block">Start</label>
                  <Input type="datetime-local" value={manualStart}
                    onChange={e => setManualStart(e.target.value)}
                    className="h-8 text-sm w-auto" />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-muted-foreground block">End</label>
                  <Input type="datetime-local" value={manualEnd}
                    onChange={e => setManualEnd(e.target.value)}
                    className="h-8 text-sm w-auto" />
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={saveManualEntry} className="h-8">
                    <Check className="w-3.5 h-3.5 mr-1" /> Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddManual(false)} className="h-8">
                    <X className="w-3.5 h-3.5 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
              {manualStart && manualEnd && (() => {
                const diff = new Date(manualEnd).getTime() - new Date(manualStart).getTime();
                if (isNaN(diff) || diff <= 0) return null;
                return (
                  <div className="text-[10px] text-muted-foreground">
                    Duration: <span className="font-mono font-semibold">{fmtHM(diff / 60000)}</span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </Card>

      {/* Orphan-entries warning — unstopped timers the user forgot about.
          They're being counted at "now" already, but they keep ticking
          until the user closes them. One-click fixer puts an end_time on
          all of them at once. */}
      {orphanEntries.length > 0 && (
        <Card className="p-3 border-amber-300 bg-amber-50/60">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm">
              <span className="font-bold text-amber-900">
                {orphanEntries.length} open entr{orphanEntries.length === 1 ? "y" : "ies"} with no end time
              </span>
              <span className="text-amber-800/80 ml-2 text-xs">
                (counted up to now, capped at 12 h — close them to freeze the duration)
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowAllEntries(true)} className="h-8 text-xs">
                Show & fix individually
              </Button>
              <Button size="sm" onClick={closeAllOrphans} className="h-8 text-xs bg-amber-600 hover:bg-amber-700">
                <Check className="w-3.5 h-3.5 mr-1" /> Close all now
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Quick log — one-click "I spent N minutes on X" without picking
          start/end times. Creates an entry ending now and starting
          (now - duration), so the work lands in today's totals instantly.
          Increments are 30-min up to 4h, matching the user's spec. */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="font-bold text-sm">Quick log — no start/end needed</h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Topic:</label>
            <Select value={quickLogTopicId} onValueChange={setQuickLogTopicId}>
              <SelectTrigger className="h-8 text-sm w-48">
                <SelectValue placeholder="Choose topic" />
              </SelectTrigger>
              <SelectContent>
                {topics.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[30, 60, 90, 120, 150, 180, 210, 240].map(mins => {
            const label = mins >= 60
              ? `${Math.floor(mins / 60)}h${mins % 60 ? "30" : ""}`
              : `${mins}m`;
            return (
              <Button
                key={mins} size="sm" variant="outline"
                disabled={!quickLogTopicId}
                onClick={() => quickLog(mins)}
                className="h-8 text-xs font-mono"
                title={`Log ${label} on the selected topic ending now`}
              >
                +{label}
              </Button>
            );
          })}
        </div>
        <div className="text-[10px] text-muted-foreground italic mt-2">
          Clicks create a past entry ending now. The duration shows up in today's totals immediately.
        </div>
      </Card>

      {/* Today's Summary */}
      <Card className="p-4">
        <h3 className="font-bold text-sm mb-3">Today — {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h3>
        {todayTotal === 0 ? (
          <div className="text-sm text-muted-foreground italic">No time tracked today. Click play on a topic, use Quick log above, or Add past entry.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayByTopic.filter(r => r.mins > 0).sort((a, b) => b.mins - a.mins).map(row => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right font-mono">{fmtHM(row.mins)}</TableCell>
                  <TableCell className="text-right font-mono">{todayTotal > 0 ? ((row.mins / todayTotal) * 100).toFixed(0) : 0}%</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/30 font-bold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono">{fmtHM(todayTotal)}</TableCell>
                <TableCell className="text-right font-mono">100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Weekly Summary */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">Weekly Summary</h3>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setWeekOffset(w => w - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-mono min-w-[120px] text-center">{weekLabel}</span>
            <Button size="sm" variant="ghost" onClick={() => setWeekOffset(w => Math.min(0, w + 1))} disabled={weekOffset >= 0}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            {weekOffset !== 0 && (
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setWeekOffset(0)}>This week</Button>
            )}
          </div>
        </div>

        {weekGrandTotal === 0 ? (
          <div className="text-sm text-muted-foreground italic">No time tracked this week.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[100px]">Topic</TableHead>
                  {weekDays.map((d, i) => {
                    const isToday = dateStr(d) === todayStr;
                    return (
                      <TableHead key={i} className={`text-center min-w-[70px] ${isToday ? "bg-primary/10 font-bold" : ""}`}>
                        {DAY_NAMES[i]}
                        <div className="text-[10px] font-normal text-muted-foreground">{String(d.getDate()).padStart(2, "0")}/{String(d.getMonth() + 1).padStart(2, "0")}</div>
                      </TableHead>
                    );
                  })}
                  <TableHead className="text-right min-w-[70px]">Total</TableHead>
                  <TableHead className="text-right min-w-[50px]">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeklyByTopic.filter(r => r.total > 0).sort((a, b) => b.total - a.total).map(row => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    {row.daily.map((mins, i) => {
                      const isToday = dateStr(weekDays[i]) === todayStr;
                      return (
                        <TableCell key={i} className={`text-center font-mono text-xs ${isToday ? "bg-primary/5" : ""} ${mins > 0 ? "" : "text-muted-foreground/40"}`}>
                          {mins > 0 ? fmtHM(mins) : "-"}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-mono font-semibold">{fmtHM(row.total)}</TableCell>
                    <TableCell className="text-right font-mono">{weekGrandTotal > 0 ? ((row.total / weekGrandTotal) * 100).toFixed(0) : 0}%</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-bold">
                  <TableCell>Total</TableCell>
                  {weeklyTotalsPerDay.map((mins, i) => {
                    const isToday = dateStr(weekDays[i]) === todayStr;
                    return (
                      <TableCell key={i} className={`text-center font-mono text-xs ${isToday ? "bg-primary/5" : ""}`}>
                        {mins > 0 ? fmtHM(mins) : "-"}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right font-mono">{fmtHM(weekGrandTotal)}</TableCell>
                  <TableCell className="text-right font-mono">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Editable entries list — lets the user fix start/end times on any
          previously-recorded entry. Collapsed by default because most users
          don't need this; it's the escape hatch for "I realize yesterday's
          Design Review entry is wrong — let me fix the end time." */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">Entries — edit start / end / topic</h3>
          <Button size="sm" variant="ghost" onClick={() => setShowAllEntries(v => !v)} className="text-xs">
            {showAllEntries ? "Hide" : `Show (${entries.length})`}
          </Button>
        </div>
        {showAllEntries && (
          entries.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No entries yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...entries]
                    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
                    .slice(0, 50)
                    .map(entry => {
                      const isEditing = editingEntryId === entry.id;
                      const start = new Date(entry.start_time);
                      const end = entry.end_time ? new Date(entry.end_time) : null;
                      const mins = end ? (end.getTime() - start.getTime()) / 60000 : 0;
                      const isActive = entry.id === activeEntryId;
                      const fmtDateTime = (d: Date) =>
                        d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
                      if (isEditing) {
                        return (
                          <TableRow key={entry.id} className="bg-primary/5">
                            <TableCell>
                              <Select value={editEntryTopicId} onValueChange={setEditEntryTopicId}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {topics.map(t => (
                                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input type="datetime-local" value={editEntryStart}
                                onChange={e => setEditEntryStart(e.target.value)}
                                className="h-8 text-sm w-auto" />
                            </TableCell>
                            <TableCell>
                              <Input type="datetime-local" value={editEntryEnd}
                                onChange={e => setEditEntryEnd(e.target.value)}
                                className="h-8 text-sm w-auto"
                                placeholder="(still running)" />
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {editEntryStart && editEntryEnd ? (() => {
                                const d = new Date(editEntryEnd).getTime() - new Date(editEntryStart).getTime();
                                return d > 0 ? fmtHM(d / 60000) : "—";
                              })() : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-0.5 justify-end">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600"
                                  onClick={saveEditEntry}>
                                  <Check className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                                  onClick={() => setEditingEntryId(null)}>
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      return (
                        <TableRow key={entry.id} className={isActive ? "bg-red-50/40" : ""}>
                          <TableCell className="font-medium text-sm">
                            {entry.topic_name}
                            {isActive && <span className="ml-2 text-[10px] text-red-600 font-bold uppercase">● running</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{fmtDateTime(start)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {end ? fmtDateTime(end) : <span className="text-muted-foreground italic">(running)</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {end ? fmtHM(mins) : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-0.5 justify-end">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                                onClick={() => openEditEntry(entry)} title="Edit times">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteEntry(entry.id)} title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
              {entries.length > 50 && (
                <div className="text-[10px] text-muted-foreground italic mt-2">
                  Showing the 50 most recent entries.
                </div>
              )}
            </div>
          )
        )}
      </Card>
    </div>
  );
}
