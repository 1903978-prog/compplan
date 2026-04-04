import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { Plus, Trash2, Play, Square, Pencil, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

  // Compute daily/weekly data
  const today = new Date();
  const todayStr = dateStr(today);
  const currentWeekStart = addDays(weekStart(today), weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const weekLabel = `${dateStr(weekDays[0]).slice(5)} — ${dateStr(weekDays[6]).slice(5)}`;

  // Calculate minutes per topic per day
  const dailyData = useMemo(() => {
    const result: Record<string, Record<string, number>> = {}; // topicName -> dateStr -> minutes
    for (const entry of entries) {
      if (!entry.end_time && entry.id !== activeEntryId) continue;
      const start = new Date(entry.start_time);
      const end = entry.end_time ? new Date(entry.end_time) : new Date();
      const mins = (end.getTime() - start.getTime()) / 60000;
      if (mins <= 0) continue;
      const day = dateStr(start);
      if (!result[entry.topic_name]) result[entry.topic_name] = {};
      result[entry.topic_name][day] = (result[entry.topic_name][day] || 0) + mins;
    }
    return result;
  }, [entries, activeEntryId, elapsed]); // elapsed to trigger re-render

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
      {activeTopic && (
        <Card className="p-4 border-primary/50 bg-primary/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="font-bold text-lg">{activeTopic.name}</span>
              <span className="font-mono text-2xl font-bold text-primary">{fmtElapsed(elapsed)}</span>
            </div>
            <Button variant="destructive" size="sm" onClick={stopTimer}>
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          </div>
        </Card>
      )}

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
      </Card>

      {/* Today's Summary */}
      <Card className="p-4">
        <h3 className="font-bold text-sm mb-3">Today — {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h3>
        {todayTotal === 0 ? (
          <div className="text-sm text-muted-foreground italic">No time tracked today. Click play on a topic to start.</div>
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
    </div>
  );
}
