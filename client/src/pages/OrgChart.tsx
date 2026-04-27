import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Network, ListTodo, Target, Sparkles, CheckCircle2, Circle, AlertTriangle, Clock, X, MessageSquare, ThumbsUp, ThumbsDown, Check, BookOpen, Plus, Archive } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// ── Types ─────────────────────────────────────────────────────────────
interface OkrItem { objective: string; key_results: string[] }
interface TaskItem {
  id: string;
  title: string;
  due_date: string;     // YYYY-MM-DD
  status: "todo" | "in_progress" | "done" | "blocked";
  linked_url?: string;
  note?: string;
}
interface OrgRole {
  id: number;
  role_key: string;
  role_name: string;
  parent_role_key: string | null;
  person_name: string | null;
  status: "active" | "onboarding" | "vacant" | "fired";
  goals: string[];
  okrs: OkrItem[];
  tasks_10d: TaskItem[];
  sort_order: number;
  updated_at: string;
}

interface KnowledgeNote {
  id: number;
  role_key: string;
  title: string | null;
  content: string;
  source: "user" | "agent" | "web";
  tags: string[];
  status: "active" | "archived" | "rejected";
  created_by_role: string | null;
  created_at: string;
}

interface AgentProposal {
  id: number;
  role_key: string;
  cycle_at: string;
  cycle_label: string | null;
  priority: "p0" | "p1" | "p2";
  category: string;
  summary: string;
  rationale: string | null;
  action_required: string | null;
  links: { label: string; url: string }[];
  status: "pending" | "accepted" | "rejected" | "actioned" | "stale";
  decided_at: string | null;
  decided_note: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────
function statusBadge(status: OrgRole["status"]) {
  switch (status) {
    case "active":     return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Active</Badge>;
    case "onboarding": return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Onboarding</Badge>;
    case "vacant":     return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Vacant</Badge>;
    case "fired":      return <Badge variant="secondary">Former</Badge>;
  }
}

function taskStatusIcon(s: TaskItem["status"]) {
  if (s === "done")        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (s === "in_progress") return <Clock className="w-4 h-4 text-blue-500" />;
  if (s === "blocked")     return <AlertTriangle className="w-4 h-4 text-red-500" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return iso; }
}

function daysFromNow(iso: string): number {
  if (!iso) return 999;
  const d = new Date(iso); const now = new Date();
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

// ── Page ──────────────────────────────────────────────────────────────
export default function OrgChart() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRole, setOpenRole] = useState<OrgRole | null>(null);
  const [addKnowledgeForRole, setAddKnowledgeForRole] = useState<OrgRole | null>(null);
  const [knowledgeDraftTitle, setKnowledgeDraftTitle] = useState("");
  const [knowledgeDraftContent, setKnowledgeDraftContent] = useState("");
  const [showFullLog, setShowFullLog] = useState(false);

  const refreshProposals = () => {
    fetch("/api/agent-proposals?status=pending", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: AgentProposal[]) => setProposals(rows))
      .catch(() => { /* silent — section just hides */ });
  };

  const refreshKnowledge = () => {
    fetch("/api/agent-knowledge?status=active", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: KnowledgeNote[]) => setKnowledge(rows))
      .catch(() => { /* silent */ });
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/org-chart", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/agent-proposals?status=pending", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/agent-knowledge?status=active", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([orgs, props, kn]) => {
      setRoles(orgs);
      setProposals(props);
      setKnowledge(kn);
      setLoading(false);
    }).catch(() => { toast({ title: "Failed to load org chart", variant: "destructive" }); setLoading(false); });
  }, [toast]);

  const saveKnowledge = async () => {
    if (!addKnowledgeForRole || !knowledgeDraftContent.trim()) return;
    const r = await fetch("/api/agent-knowledge", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role_key: addKnowledgeForRole.role_key,
        title: knowledgeDraftTitle.trim() || null,
        content: knowledgeDraftContent.trim(),
        source: "user",
      }),
    });
    if (r.ok) {
      const note = await r.json();
      setKnowledge(prev => [note, ...prev]);
      setAddKnowledgeForRole(null);
      setKnowledgeDraftTitle("");
      setKnowledgeDraftContent("");
      toast({ title: "Knowledge added" });
    } else {
      toast({ title: "Failed to add knowledge", variant: "destructive" });
    }
  };

  const archiveKnowledge = async (note: KnowledgeNote) => {
    const r = await fetch(`/api/agent-knowledge/${note.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    if (r.ok) {
      setKnowledge(prev => prev.filter(x => x.id !== note.id));
      toast({ title: "Archived" });
    }
  };

  const decideProposal = async (p: AgentProposal, status: AgentProposal["status"], note?: string) => {
    const r = await fetch(`/api/agent-proposals/${p.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, decided_note: note }),
    });
    if (r.ok) {
      setProposals(prev => prev.filter(x => x.id !== p.id));
      toast({ title: `Marked ${status}` });
    } else {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading org chart…</div>;
  }

  const ceo = roles.find(r => r.role_key === "ceo");
  // Build a tree from parent_role_key. Direct reports of CEO render in row 2.
  // Roles that report to a non-CEO role (e.g. Pricing → CFO) render beneath
  // their parent in row 3+. Use a recursive helper.
  const childrenOf = (key: string): OrgRole[] =>
    roles.filter(r => r.parent_role_key === key).sort((a, b) => a.sort_order - b.sort_order);
  const directReports = ceo ? childrenOf(ceo.role_key) : [];

  const updateReportsTo = async (role: OrgRole, newParent: string | null) => {
    const r = await fetch(`/api/org-chart/${role.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_role_key: newParent }),
    });
    if (r.ok) {
      const updated = await r.json();
      setRoles(prev => prev.map(x => x.id === updated.id ? updated : x));
      if (openRole?.id === updated.id) setOpenRole(updated);
      toast({ title: "Reports-to updated" });
    } else {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <Network className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Org Chart</h1>
          <p className="text-sm text-muted-foreground">
            Each role's ambition, OKRs, and the tasks they plan to execute in the next 10 days. Click any card for the full task list.
          </p>
        </div>
      </div>

      {/* CEO row */}
      {ceo && (
        <div className="flex justify-center mb-3">
          <RoleCard
            role={ceo} highlight
            knowledgeCount={knowledge.filter(k => k.role_key === ceo.role_key).length}
            onClick={() => setOpenRole(ceo)}
            onAddKnowledge={() => setAddKnowledgeForRole(ceo)}
          />
        </div>
      )}

      {/* Direct reports row + connector lines */}
      {ceo && directReports.length > 0 && (
        <div className="relative">
          {/* Vertical line down from CEO */}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 w-0.5 h-3 bg-foreground/40" />
          {/* Horizontal line spanning all reports */}
          <div className="absolute left-[5%] right-[5%] top-3 h-0.5 bg-foreground/40" />
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 pt-6 relative">
            {directReports.map(r => {
              const grandchildren = childrenOf(r.role_key);
              return (
                <div key={r.id} className="flex flex-col items-stretch relative">
                  {/* Vertical drop from horizontal line into this card */}
                  <div className="absolute left-1/2 -translate-x-1/2 -top-3 w-0.5 h-3 bg-foreground/40" />
                  <RoleCard
                    role={r}
                    knowledgeCount={knowledge.filter(k => k.role_key === r.role_key).length}
                    onClick={() => setOpenRole(r)}
                    onAddKnowledge={() => setAddKnowledgeForRole(r)}
                  />
                  {grandchildren.length > 0 && (
                    <div className="relative mt-3 pt-4">
                      {/* Vertical line down from this role */}
                      <div className="absolute left-1/2 -translate-x-1/2 top-0 w-0.5 h-2 bg-foreground/40" />
                      {/* Horizontal line for grandchildren */}
                      {grandchildren.length > 1 && (
                        <div className="absolute left-[10%] right-[10%] top-2 h-0.5 bg-foreground/40" />
                      )}
                      <div className="grid grid-cols-1 gap-2 relative">
                        {grandchildren.map(g => (
                          <div key={g.id} className="relative">
                            <div className="absolute left-1/2 -translate-x-1/2 -top-2 w-0.5 h-2 bg-foreground/40" />
                            <RoleCard
                              role={g}
                              knowledgeCount={knowledge.filter(k => k.role_key === g.role_key).length}
                              onClick={() => setOpenRole(g)}
                              onAddKnowledge={() => setAddKnowledgeForRole(g)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Add-knowledge popup ────────────────────────────────────── */}
      <Dialog open={!!addKnowledgeForRole} onOpenChange={(o) => !o && setAddKnowledgeForRole(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              Add knowledge for {addKnowledgeForRole?.role_name}
            </DialogTitle>
            <DialogDescription>
              Paste an instruction, insight, playbook, or any context this role should always remember. The CEO and this role's skill will read all active knowledge before producing any brief or making any decision.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-semibold">Title (optional)</label>
              <input
                type="text"
                value={knowledgeDraftTitle}
                onChange={e => setKnowledgeDraftTitle(e.target.value)}
                placeholder="e.g. 'Negotiation playbook' or 'Q2 priorities'"
                className="w-full h-8 mt-1 px-2 text-sm border rounded bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-semibold">Knowledge / instruction</label>
              <Textarea
                value={knowledgeDraftContent}
                onChange={e => setKnowledgeDraftContent(e.target.value)}
                placeholder="Paste the instruction or insight here. Markdown supported."
                rows={10}
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setAddKnowledgeForRole(null)}>Cancel</Button>
            <Button onClick={saveKnowledge} disabled={!knowledgeDraftContent.trim()}>
              <Plus className="w-4 h-4 mr-1" /> Save knowledge
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Proposals from your team — pending decisions ───────────── */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Proposals from your team
              {proposals.length > 0 && <span className="text-sm font-normal text-muted-foreground">({proposals.length} pending)</span>}
            </h2>
            <p className="text-xs text-muted-foreground">
              Each agent runs at 9am + 2pm and writes here when something needs your decision. They optimise different goals — Pricing wants margin, Sales wants conversion, CFO wants EBITDA, Delivery wants on-time. You resolve the tension.
            </p>
          </div>
          <button
            onClick={refreshProposals}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Refresh
          </button>
        </div>
        {proposals.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground italic">
            No pending proposals. Run a brief locally (e.g. <code className="text-xs bg-muted px-1.5 py-0.5 rounded">ceo brief</code> in Claude Code) to populate.
          </Card>
        ) : (
          <div className="space-y-2">
            {proposals
              .sort((a, b) => {
                const pri = { p0: 0, p1: 1, p2: 2 };
                if (pri[a.priority] !== pri[b.priority]) return pri[a.priority] - pri[b.priority];
                return b.created_at.localeCompare(a.created_at);
              })
              .map(p => {
                const role = roles.find(r => r.role_key === p.role_key);
                const priColor = p.priority === "p0" ? "border-red-400 bg-red-50/40 dark:bg-red-950/20"
                  : p.priority === "p1" ? "border-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
                  : "border-border";
                return (
                  <Card key={p.id} className={`p-3 border-l-4 ${priColor}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{role?.role_name ?? p.role_key}</Badge>
                          <Badge className={`text-[10px] ${
                            p.priority === "p0" ? "bg-red-100 text-red-700 border-red-200"
                              : p.priority === "p1" ? "bg-amber-100 text-amber-700 border-amber-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                          }`}>{p.priority.toUpperCase()}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{p.category}</Badge>
                          <span className="text-[10px] text-muted-foreground">{p.cycle_label ?? "manual"} · {fmtDate(p.created_at)}</span>
                        </div>
                        <div className="font-semibold text-sm mt-1">{p.summary}</div>
                        {p.rationale && (
                          <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{p.rationale}</div>
                        )}
                        {p.action_required && (
                          <div className="text-xs mt-1.5">
                            <span className="font-semibold text-primary">Action needed: </span>
                            {p.action_required}
                          </div>
                        )}
                        {p.links.length > 0 && (
                          <div className="flex gap-2 mt-1.5">
                            {p.links.map((l, i) => (
                              <a key={i} href={l.url} className="text-[11px] text-primary hover:underline">→ {l.label}</a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => decideProposal(p, "accepted")}
                        ><ThumbsUp className="w-3 h-3 mr-1" /> Accept</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => decideProposal(p, "rejected", prompt("Why reject? (optional)") ?? undefined)}
                        ><ThumbsDown className="w-3 h-3 mr-1" /> Reject</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => decideProposal(p, "actioned")}
                        ><Check className="w-3 h-3 mr-1" /> Done</Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>
        )}
      </div>

      {/* Task popup */}
      <RoleDetailDialog
        role={openRole}
        knowledge={openRole ? knowledge.filter(k => k.role_key === openRole.role_key) : []}
        allRoles={roles}
        onUpdateReportsTo={updateReportsTo}
        onClose={() => setOpenRole(null)}
        onAddKnowledgeFromDialog={() => { if (openRole) setAddKnowledgeForRole(openRole); }}
        onArchiveKnowledge={archiveKnowledge}
        onTaskToggle={async (task, newStatus) => {
          if (!openRole) return;
          const nextTasks = openRole.tasks_10d.map(t => t.id === task.id ? { ...t, status: newStatus } : t);
          const r = await fetch(`/api/org-chart/${openRole.id}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks_10d: nextTasks }),
          });
          if (r.ok) {
            const updated = await r.json();
            setRoles(prev => prev.map(x => x.id === updated.id ? updated : x));
            setOpenRole(updated);
          } else {
            toast({ title: "Update failed", variant: "destructive" });
          }
        }}
      />
    </div>
  );
}

// ── Role card ─────────────────────────────────────────────────────────
function RoleCard({ role, highlight, knowledgeCount, onClick, onAddKnowledge }: {
  role: OrgRole;
  highlight?: boolean;
  knowledgeCount: number;
  onClick: () => void;
  onAddKnowledge: () => void;
}) {
  const openTasks = role.tasks_10d.filter(t => t.status === "todo" || t.status === "in_progress").length;
  const overdue = role.tasks_10d.filter(t => t.status !== "done" && daysFromNow(t.due_date) < 0).length;

  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/40 ${
        highlight ? "border-2 border-primary/40 ring-2 ring-primary/10 max-w-md w-full" : ""
      }`}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm leading-tight truncate">{role.role_name}</h3>
              {statusBadge(role.status)}
            </div>
            {role.person_name && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{role.person_name}</p>
            )}
          </div>
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2 shrink-0"
            onClick={(e) => { e.stopPropagation(); onAddKnowledge(); }}
            title={`Add knowledge for ${role.role_name}`}
          >
            <BookOpen className="w-3.5 h-3.5 mr-1" />
            <span className="text-[11px]">{knowledgeCount > 0 ? `${knowledgeCount}` : "+"}</span>
          </Button>
        </div>

        {role.goals.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              <Target className="w-3 h-3" /> Goals
            </div>
            <ul className="text-xs space-y-0.5">
              {role.goals.slice(0, highlight ? 5 : 3).map((g, i) => (
                <li key={i} className="leading-snug">• {g}</li>
              ))}
              {!highlight && role.goals.length > 3 && (
                <li className="text-[10px] text-muted-foreground italic">+{role.goals.length - 3} more</li>
              )}
            </ul>
          </div>
        )}

        {role.okrs.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              <Sparkles className="w-3 h-3" /> OKRs ({role.okrs.length})
            </div>
            <ul className="text-[11px] space-y-0.5">
              {role.okrs.slice(0, highlight ? 3 : 2).map((o, i) => (
                <li key={i} className="font-medium leading-snug">{i + 1}. {o.objective}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t text-[11px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <ListTodo className="w-3.5 h-3.5" />
            <span>{openTasks} open · {role.tasks_10d.length} total (10d)</span>
          </div>
          {overdue > 0 && (
            <Badge variant="destructive" className="text-[9px] h-4">{overdue} overdue</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Detail dialog with tasks ──────────────────────────────────────────
function RoleDetailDialog({
  role,
  knowledge,
  allRoles,
  onUpdateReportsTo,
  onClose,
  onAddKnowledgeFromDialog,
  onArchiveKnowledge,
  onTaskToggle,
}: {
  role: OrgRole | null;
  knowledge: KnowledgeNote[];
  allRoles: OrgRole[];
  onUpdateReportsTo: (role: OrgRole, newParent: string | null) => Promise<void>;
  onClose: () => void;
  onAddKnowledgeFromDialog: () => void;
  onArchiveKnowledge: (n: KnowledgeNote) => Promise<void>;
  onTaskToggle: (task: TaskItem, newStatus: TaskItem["status"]) => Promise<void>;
}) {
  if (!role) return null;
  const openTasks = role.tasks_10d.filter(t => t.status !== "done");
  const doneTasks = role.tasks_10d.filter(t => t.status === "done");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <DialogTitle className="flex items-center gap-2">
                {role.role_name}
                {statusBadge(role.status)}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {role.person_name ?? "(unfilled)"} · last updated {fmtDate(role.updated_at)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Reports to — dropdown lets co-CEO move a role under a different
            parent (e.g. Pricing under CFO). CEO has no parent. */}
        {role.role_key !== "ceo" && (
          <section className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Reports to:</span>
            <select
              className="h-7 px-2 text-xs border rounded bg-background"
              value={role.parent_role_key ?? ""}
              onChange={e => onUpdateReportsTo(role, e.target.value || null)}
            >
              {allRoles
                .filter(r => r.role_key !== role.role_key)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(r => (
                  <option key={r.role_key} value={r.role_key}>
                    {r.role_name}{r.person_name ? ` (${r.person_name})` : ""}
                  </option>
                ))}
            </select>
          </section>
        )}

        {/* Knowledge / instructions */}
        <section className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              Knowledge / instructions
              <span className="text-xs font-normal text-muted-foreground">({knowledge.length})</span>
            </h4>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAddKnowledgeFromDialog}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
          {knowledge.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">
              No knowledge yet. Click "Add" to paste instructions, playbooks, or context this role should always remember.
            </p>
          ) : (
            <div className="space-y-2">
              {knowledge.map(n => (
                <div key={n.id} className="border rounded p-2 bg-muted/20 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {n.title && <span className="font-semibold truncate">{n.title}</span>}
                      <Badge variant="outline" className="text-[9px] py-0 h-4">{n.source}</Badge>
                      <span className="text-[10px] text-muted-foreground">{fmtDate(n.created_at)}</span>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5"
                      onClick={() => onArchiveKnowledge(n)}
                      title="Archive (kept in log)"
                    ><Archive className="w-3 h-3" /></Button>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed">{n.content}</pre>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Goals */}
        {role.goals.length > 0 && (
          <section className="mt-4">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Goals
            </h4>
            <ul className="text-sm space-y-1 pl-1">
              {role.goals.map((g, i) => (
                <li key={i} className="leading-snug">• {g}</li>
              ))}
            </ul>
          </section>
        )}

        {/* OKRs */}
        {role.okrs.length > 0 && (
          <section className="mt-5">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> OKRs
            </h4>
            <div className="space-y-3">
              {role.okrs.map((o, i) => (
                <div key={i} className="border-l-2 border-primary/30 pl-3 py-1">
                  <div className="font-medium text-sm">{i + 1}. {o.objective}</div>
                  <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
                    {o.key_results.map((kr, j) => (
                      <li key={j}>– {kr}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tasks 10d */}
        <section className="mt-5">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-primary" /> Tasks · next 10 days
            <span className="text-xs text-muted-foreground font-normal ml-auto">
              {openTasks.length} open · {doneTasks.length} done
            </span>
          </h4>
          {role.tasks_10d.length === 0 ? (
            <p className="text-sm text-muted-foreground italic px-1">No tasks set yet. The role's daily cron run will populate this.</p>
          ) : (
            <ul className="space-y-1.5">
              {[...openTasks, ...doneTasks].map(t => {
                const dDays = daysFromNow(t.due_date);
                const overdue = t.status !== "done" && dDays < 0;
                return (
                  <li key={t.id} className={`flex items-start gap-2 p-2 rounded border ${overdue ? "border-red-300 bg-red-50/50 dark:bg-red-950/20" : "border-border"}`}>
                    <button
                      onClick={() => onTaskToggle(t, t.status === "done" ? "todo" : "done")}
                      className="mt-0.5 hover:opacity-70 transition-opacity"
                      title={t.status === "done" ? "Mark as todo" : "Mark as done"}
                    >
                      {taskStatusIcon(t.status)}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {t.title}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span>{fmtDate(t.due_date)}</span>
                        {overdue && <span className="text-red-600 font-semibold">overdue</span>}
                        {!overdue && dDays >= 0 && dDays <= 1 && <span className="text-amber-600 font-semibold">today/tomorrow</span>}
                        {t.linked_url && (
                          <a href={t.linked_url} className="text-primary hover:underline">open →</a>
                        )}
                      </div>
                      {t.note && (
                        <div className="text-[11px] text-muted-foreground italic mt-0.5">{t.note}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex justify-end mt-6">
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-1" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
