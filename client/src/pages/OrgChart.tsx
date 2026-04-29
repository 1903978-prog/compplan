import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Network, ListTodo, Target, Sparkles, CheckCircle2, Circle, AlertTriangle, Clock, X, MessageSquare, ThumbsUp, ThumbsDown, Check, BookOpen, Plus, Archive, User, Bot, Mail, UserPlus } from "lucide-react";
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
  dotted_parent_role_keys?: string[];
  person_name: string | null;
  status: "active" | "onboarding" | "vacant" | "fired";
  kind?: "agent" | "human";
  email?: string | null;
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

interface AcceptanceStat {
  role_key: string;
  category: string;
  accepted: number;
  rejected: number;
  pending: number;
  total: number;
  acceptance_rate: number | null;
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
  const [acceptanceStats, setAcceptanceStats] = useState<AcceptanceStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRole, setOpenRole] = useState<OrgRole | null>(null);
  const [addKnowledgeForRole, setAddKnowledgeForRole] = useState<OrgRole | null>(null);
  const [knowledgeDraftTitle, setKnowledgeDraftTitle] = useState("");
  const [knowledgeDraftContent, setKnowledgeDraftContent] = useState("");
  const [showFullLog, setShowFullLog] = useState(false);
  const [showAddRole, setShowAddRole] = useState(false);
  const [newRole, setNewRole] = useState({
    role_name: "",
    person_name: "",
    parent_role_key: "ceo",
    kind: "agent" as "agent" | "human",
    email: "",
  });

  const [showStartAgents, setShowStartAgents] = useState(false);

  // Copy helper for committee prompts (also used by Start Agents dialog).
  const copyToClipboard = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: label });
    } catch {
      window.prompt("Copy this text (Ctrl+C):", text);
    }
  };

  const createRole = async () => {
    if (!newRole.role_name.trim()) return;
    const r = await fetch("/api/org-chart", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role_name: newRole.role_name.trim(),
        person_name: newRole.person_name.trim() || null,
        parent_role_key: newRole.parent_role_key,
        kind: newRole.kind,
        email: newRole.email.trim() || null,
      }),
    });
    if (r.ok) {
      const role = await r.json();
      setRoles(prev => [...prev, role]);
      setShowAddRole(false);
      setNewRole({ role_name: "", person_name: "", parent_role_key: "ceo", kind: "agent", email: "" });
      toast({ title: "Role added" });
    } else {
      const body = await r.json().catch(() => ({}));
      toast({ title: "Failed to add role", description: body.message ?? "Unknown error", variant: "destructive" });
    }
  };

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
      fetch("/api/agent-proposals/acceptance-stats", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([orgs, props, kn, stats]) => {
      setRoles(orgs);
      setProposals(props);
      setKnowledge(kn);
      setAcceptanceStats(stats);
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
  // Special governance/peer roles render side-by-side with CEO, NOT in
  // the standard directReports row.
  const PEER_ROLE_RX = /^(president|founder|chairman|board)$/i;
  const isPeerRole = (key: string) => PEER_ROLE_RX.test(key);
  const childrenOf = (key: string): OrgRole[] =>
    roles
      .filter(r => r.parent_role_key === key && !isPeerRole(r.role_key))
      .sort((a, b) => a.sort_order - b.sort_order);
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

  // Save edited goals / OKRs back to the role. Used by the dialog's
  // inline-editable Goals + OKRs sections.
  const saveRoleFields = async (role: OrgRole, patch: Partial<Pick<OrgRole, "goals" | "okrs">>) => {
    const r = await fetch(`/api/org-chart/${role.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const updated = await r.json();
      setRoles(prev => prev.map(x => x.id === updated.id ? updated : x));
      if (openRole?.id === updated.id) setOpenRole(updated);
    } else {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  };

  // ── Cascade goals + OKRs from a role to its direct reports based on
  // topic keywords. Each goal / OKR objective is matched against a
  // role-keyword map (CFO=finance, Sales=pipeline, etc.) and, when
  // matched, prepended to that DR's goals (with a "[Cascaded from <CEO>]"
  // marker so the user can see provenance and remove it later if wrong).
  // No matches → goes to all DRs as a generic broadcast.
  const cascadeToReports = async (role: OrgRole) => {
    // Topic → role_key keyword map. First match wins per goal/OKR.
    // Each entry: list of keyword regexes that target this role.
    const ROUTING: Array<{ role_key: string; rx: RegExp }> = [
      { role_key: "cfo",                 rx: /\b(finance|cash|AR|EBITDA|margin|cost|invoic|DSO|runway|budget|spend|revenue|GM|gross\s*margin|P&L)\b/i },
      { role_key: "cco",                 rx: /\b(sales|pipeline|lead|deal|conversion|win[-\s]?rate|TBD|outbound|prospect|BD|close|funnel|commercial|brand|content|inbound)\b/i },
      { role_key: "marketing-manager",   rx: /\b(media|content|brand|PR|press|article|SEO|LinkedIn|Substack|Medium|thought[-\s]?leadership|inbound|EVP)\b/i },
      { role_key: "pricing-director",    rx: /\b(pricing|discount|rebate|fee|rate|proposal|win-loss|elasticit|target\s*price)\b/i },
      { role_key: "hiring-manager",      rx: /\b(hire|recruit|headcount|partner|onboarding|churn|attrition|EVP|comp|salary|CHRO)\b/i },
      { role_key: "delivery-director",   rx: /\b(deliver|quality|team|utilization|EM|engagement|NPS|weekly\s*report|on[-\s]?time)\b/i },
      { role_key: "coo",                 rx: /\b(automation|AI|skills|tool|IT|ops|process|admin|internal|compplan|dashboard)\b/i },
    ];

    const drs = roles.filter(r => r.parent_role_key === role.role_key);
    if (drs.length === 0) {
      toast({ title: "No direct reports to cascade to", variant: "destructive" });
      return;
    }

    // Build per-DR queues of goals + okrs to add.
    const queues: Record<string, { goals: string[]; okrs: { objective: string; key_results: string[] }[] }> = {};
    const ensureQ = (k: string) => (queues[k] ||= { goals: [], okrs: [] });

    const matchOrFallback = (text: string): string[] => {
      const matched: string[] = [];
      for (const rt of ROUTING) {
        if (rt.rx.test(text)) {
          // Only cascade to DRs that actually exist on this team.
          if (drs.some(d => d.role_key === rt.role_key)) matched.push(rt.role_key);
        }
      }
      return matched;
    };

    const cascadeMarker = `[Cascaded from ${role.role_name}${role.person_name ? ` · ${role.person_name}` : ""}] `;

    // Goals: route each by keyword. Unrouted ones fan out to all DRs as
    // generic context (better than dropping them).
    for (const g of role.goals) {
      const targets = matchOrFallback(g);
      if (targets.length === 0) {
        for (const d of drs) ensureQ(d.role_key).goals.push(`${cascadeMarker}${g}`);
      } else {
        for (const k of targets) ensureQ(k).goals.push(`${cascadeMarker}${g}`);
      }
    }
    // OKRs: same routing on the objective text.
    for (const o of role.okrs) {
      const targets = matchOrFallback(o.objective);
      const cascadedOkr = {
        objective: `${cascadeMarker}${o.objective}`,
        key_results: o.key_results,
      };
      if (targets.length === 0) {
        for (const d of drs) ensureQ(d.role_key).okrs.push(cascadedOkr);
      } else {
        for (const k of targets) ensureQ(k).okrs.push(cascadedOkr);
      }
    }

    // Apply: for each DR, PUT updated goals + okrs (prepending the
    // cascaded items so they're visible at the top, and skipping
    // duplicates on re-cascade by exact-string match).
    let touched = 0;
    for (const dr of drs) {
      const q = queues[dr.role_key];
      if (!q || (q.goals.length === 0 && q.okrs.length === 0)) continue;
      const existingGoalsSet = new Set(dr.goals);
      const existingObjSet   = new Set(dr.okrs.map(o => o.objective));
      const newGoals = [...q.goals.filter(g => !existingGoalsSet.has(g)), ...dr.goals];
      const newOkrs  = [...q.okrs.filter(o => !existingObjSet.has(o.objective)), ...dr.okrs];
      const r = await fetch(`/api/org-chart/${dr.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: newGoals, okrs: newOkrs }),
      });
      if (r.ok) {
        const updated = await r.json();
        setRoles(prev => prev.map(x => x.id === updated.id ? updated : x));
        touched++;
      }
    }
    toast({
      title: `Cascaded to ${touched} direct report${touched === 1 ? "" : "s"}`,
      description: "Each goal/OKR was routed by topic keyword (finance → CFO, sales → Sales Director, etc.). Items without a clear match went to all DRs.",
    });
  };

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Network className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Org Chart</h1>
            <p className="text-sm text-muted-foreground">
              <Bot className="w-3 h-3 inline" /> AI agent · <User className="w-3 h-3 inline" /> human · solid line = primary boss · dotted line = matrix.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowStartAgents(true)}>
            <Sparkles className="w-4 h-4 mr-1" /> Start agents
          </Button>
          <Button size="sm" onClick={() => setShowAddRole(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add role
          </Button>
        </div>
      </div>

      {/* ── Start Agents popup — paste-ready commands for Claude Code ── */}
      <Dialog open={showStartAgents} onOpenChange={(o) => !o && setShowStartAgents(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> Start agents
            </DialogTitle>
            <DialogDescription>
              Agents run as Claude Code skills on your machine. Paste these commands one-by-one
              in a Claude Code session to run each agent's brief now.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {(() => {
              const activeAgents = roles.filter(r => r.status === "active" && (r.kind ?? "agent") === "agent");
              if (activeAgents.length === 0) {
                return <p className="text-sm text-muted-foreground italic">No active agents to run.</p>;
              }
              return activeAgents.map(r => {
                const cmd = r.role_key === "ceo"
                  ? "/eendigo-ceo brief"
                  : `/eendigo-${r.role_key.replace(/_/g, "-")} brief`;
                return (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground">{r.role_name} · {r.person_name ?? "—"}</div>
                      <code className="text-xs font-mono bg-muted px-2 py-1 rounded block truncate">{cmd}</code>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(cmd, `Copied: ${cmd}`)}>
                      Copy
                    </Button>
                  </div>
                );
              });
            })()}
            <div className="text-[11px] text-muted-foreground italic mt-3 pt-3 border-t">
              Tip: queue them all by pasting each into a separate Claude Code session, or run a recurring
              loop with <code className="text-[11px]">/loop 1h ceo brief</code>.
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add-role popup ───────────────────────────────────────── */}
      <Dialog open={showAddRole} onOpenChange={(o) => !o && setShowAddRole(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add a new role</DialogTitle>
            <DialogDescription>Agent = AI role-skill produces briefs. Human = real person you coordinate via email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2 text-sm">
            <div>
              <label className="text-xs font-semibold">Role name *</label>
              <input type="text" value={newRole.role_name}
                onChange={e => setNewRole(r => ({ ...r, role_name: e.target.value }))}
                placeholder="e.g. Senior Recruiter, Office Manager"
                className="w-full h-8 mt-1 px-2 text-sm border rounded bg-background" />
            </div>
            <div>
              <label className="text-xs font-semibold">Person name (optional)</label>
              <input type="text" value={newRole.person_name}
                onChange={e => setNewRole(r => ({ ...r, person_name: e.target.value }))}
                placeholder="e.g. Cosmin"
                className="w-full h-8 mt-1 px-2 text-sm border rounded bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold">Kind</label>
                <select value={newRole.kind}
                  onChange={e => setNewRole(r => ({ ...r, kind: e.target.value as any }))}
                  className="w-full h-8 mt-1 px-2 text-sm border rounded bg-background">
                  <option value="agent">Agent (AI)</option>
                  <option value="human">Human</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold">Reports to *</label>
                <select value={newRole.parent_role_key}
                  onChange={e => setNewRole(r => ({ ...r, parent_role_key: e.target.value }))}
                  className="w-full h-8 mt-1 px-2 text-sm border rounded bg-background">
                  {roles.sort((a, b) => a.sort_order - b.sort_order).map(r => (
                    <option key={r.role_key} value={r.role_key}>
                      {r.role_name}{r.person_name ? ` (${r.person_name})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {newRole.kind === "human" && (
              <div>
                <label className="text-xs font-semibold">Email (for sending instructions)</label>
                <input type="email" value={newRole.email}
                  onChange={e => setNewRole(r => ({ ...r, email: e.target.value }))}
                  placeholder="cosmin@example.com"
                  className="w-full h-8 mt-1 px-2 text-sm border rounded bg-background" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowAddRole(false)}>Cancel</Button>
            <Button onClick={createRole} disabled={!newRole.role_name.trim()}>
              <Plus className="w-4 h-4 mr-1" /> Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CEO row — President (if exists) renders to the LEFT of CEO with a
          solid horizontal connector. President is identified by role_key
          ("president" / "founder" / "chairman" / "board"). It's a peer of
          CEO conceptually, not a subordinate, so we render it side-by-side
          rather than above. The connector is a solid line — no L-bend —
          to signal "horizontal authority/governance" relationship. */}
      {ceo && (() => {
        const president = roles.find(r => /^(president|founder|chairman|board)$/i.test(r.role_key));
        if (!president) {
          return (
            <div className="flex justify-center mb-3">
              <RoleCard
                role={ceo} highlight
                knowledgeCount={knowledge.filter(k => k.role_key === ceo.role_key).length}
                onClick={() => setOpenRole(ceo)}
                onAddKnowledge={() => setAddKnowledgeForRole(ceo)}
              />
            </div>
          );
        }
        return (
          <div className="flex justify-center mb-3">
            {/* President is the apex — no connecting line. CEO sits alongside
                it; the vertical line below CEO connects down to direct reports. */}
            <div className="flex items-start gap-6">
              <RoleCard
                role={president} highlight
                knowledgeCount={knowledge.filter(k => k.role_key === president.role_key).length}
                onClick={() => setOpenRole(president)}
                onAddKnowledge={() => setAddKnowledgeForRole(president)}
              />
              <RoleCard
                role={ceo} highlight
                knowledgeCount={knowledge.filter(k => k.role_key === ceo.role_key).length}
                onClick={() => setOpenRole(ceo)}
                onAddKnowledge={() => setAddKnowledgeForRole(ceo)}
              />
            </div>
          </div>
        );
      })()}

      {/* Direct reports row + connector lines — recursive so any depth renders */}
      {ceo && directReports.length > 0 && (
        <div className="overflow-x-auto pb-2">
          <div className="relative inline-flex flex-col items-center min-w-full">
            {/* Vertical line down from CEO to the busbar */}
            <div className="w-0.5 h-3 bg-foreground/60" />
            {/* Horizontal busbar — spans full width of the subtrees row */}
            <div className="relative w-full">
              <div className="absolute inset-x-0 top-0 h-0.5 bg-foreground/60" />
              <div className="flex flex-nowrap justify-center gap-6 pt-3">
                {directReports.map(r => (
                  <RoleSubtree
                    key={r.id}
                    role={r}
                    childrenOf={childrenOf}
                    knowledge={knowledge}
                    onOpen={setOpenRole}
                    onAddKnowledge={setAddKnowledgeForRole}
                  />
                ))}
              </div>
            </div>
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

      {/* ── Rejection-learning stats (last 30 days) ────────────────── */}
      {acceptanceStats.filter(s => s.acceptance_rate !== null).length > 0 && (
        <div className="mt-10 mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Learning — acceptance rate by role × category (last 30d)
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            CEO uses this on its hourly run to bias scoring: low-acceptance categories get scored DOWN; high-acceptance categories get surfaced first. Reject ideas you don't want; the next cycle will propose less of that kind.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {acceptanceStats
              .filter(s => s.acceptance_rate !== null)
              .sort((a, b) => (b.acceptance_rate ?? 0) - (a.acceptance_rate ?? 0))
              .map(s => {
                const role = roles.find(r => r.role_key === s.role_key);
                const pct = Math.round((s.acceptance_rate ?? 0) * 100);
                const tone = pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-600";
                return (
                  <Card key={`${s.role_key}-${s.category}`} className="p-2">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
                      {role?.role_name ?? s.role_key} · {s.category}
                    </div>
                    <div className={`text-lg font-bold tabular-nums ${tone}`}>{pct}%</div>
                    <div className="text-[10px] text-muted-foreground">
                      {s.accepted}/{s.accepted + s.rejected} decisions{s.pending > 0 && ` · ${s.pending} pending`}
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>
      )}

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
        onSaveFields={saveRoleFields}
        onCascade={cascadeToReports}
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
// Fixed 152 × 80 px so every tile is identical in size.
function RoleCard({ role, highlight, knowledgeCount, onClick, onAddKnowledge }: {
  role: OrgRole;
  highlight?: boolean;
  knowledgeCount: number;
  onClick: () => void;
  onAddKnowledge: () => void;
}) {
  const openTasks = role.tasks_10d.filter(t => t.status === "todo" || t.status === "in_progress").length;
  const overdue   = role.tasks_10d.filter(t => t.status !== "done" && daysFromNow(t.due_date) < 0).length;
  const isPeer    = /^(president|founder|chairman|board)$/i.test(role.role_key);

  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/40 w-[152px] h-[80px] overflow-hidden shrink-0 ${
        highlight ? "border-2 border-primary/40 ring-2 ring-primary/10" : ""
      }`}
    >
      <div className="p-2 flex flex-col h-full">
        {/* Row 1 — kind icon · role name · knowledge btn */}
        <div className="flex items-center gap-1 min-w-0">
          {role.kind === "human" ? (
            <span title="Human" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
              <User className="w-2 h-2" />
            </span>
          ) : (
            <span title="AI agent" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-violet-100 text-violet-700 shrink-0">
              <Bot className="w-2 h-2" />
            </span>
          )}
          <h3 className="font-semibold text-[10px] leading-tight truncate flex-1">{role.role_name}</h3>
          <Button
            size="sm" variant="ghost"
            className="h-4 w-4 p-0 shrink-0"
            onClick={(e) => { e.stopPropagation(); onAddKnowledge(); }}
            title={`Add knowledge for ${role.role_name}`}
          >
            <BookOpen className="w-2.5 h-2.5" />
          </Button>
        </div>

        {/* Row 2 — status badge + optional person name */}
        <div className="flex items-center gap-1 mt-0.5 min-w-0">
          {statusBadge(role.status)}
          {!isPeer && role.person_name && (
            <span className="text-[9px] text-muted-foreground truncate">{role.person_name}</span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Row 3 — stats */}
        <div className="flex items-center justify-between border-t pt-1 text-[9px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {role.goals.length > 0 && (
              <span className="flex items-center gap-0.5"><Target className="w-2 h-2" />{role.goals.length}</span>
            )}
            {role.okrs.length > 0 && (
              <span className="flex items-center gap-0.5"><Sparkles className="w-2 h-2" />{role.okrs.length}</span>
            )}
            <span className="flex items-center gap-0.5"><ListTodo className="w-2 h-2" />{openTasks}</span>
            {knowledgeCount > 0 && (
              <span className="flex items-center gap-0.5"><BookOpen className="w-2 h-2" />{knowledgeCount}</span>
            )}
          </div>
          {overdue > 0 && (
            <Badge variant="destructive" className="text-[8px] h-3.5 px-0.5">{overdue}!</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Recursive role subtree — renders a card + its children at any depth ──
// All siblings always on a SINGLE horizontal line (flex-nowrap).
// The outer page wraps in overflow-x-auto to allow scrolling.
function RoleSubtree({
  role, childrenOf, knowledge, onOpen, onAddKnowledge,
}: {
  role: OrgRole;
  childrenOf: (key: string) => OrgRole[];
  knowledge: KnowledgeNote[];
  onOpen: (r: OrgRole) => void;
  onAddKnowledge: (r: OrgRole) => void;
}) {
  const children = childrenOf(role.role_key);
  return (
    // flex-col items-center: card sits centered above its children row
    <div className="flex flex-col items-center">
      {/* Vertical drop from the busbar above this tile */}
      <div className="w-0.5 h-3 bg-foreground/60" />
      <RoleCard
        role={role}
        knowledgeCount={knowledge.filter(k => k.role_key === role.role_key).length}
        onClick={() => onOpen(role)}
        onAddKnowledge={() => onAddKnowledge(role)}
      />
      {children.length > 0 && (
        <div className="flex flex-col items-center w-full">
          {/* Vertical line from card down to horizontal bus */}
          <div className="w-0.5 h-3 bg-foreground/60" />
          {/* Horizontal bus — spans full width of this subtree */}
          <div className="relative w-full">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-foreground/60" />
            {/* Children — always on a single line, no wrapping */}
            <div className="flex flex-nowrap justify-center gap-4 pt-3">
              {children.map(c => (
                <RoleSubtree
                  key={c.id}
                  role={c}
                  childrenOf={childrenOf}
                  knowledge={knowledge}
                  onOpen={onOpen}
                  onAddKnowledge={onAddKnowledge}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail dialog with tasks ──────────────────────────────────────────
function RoleDetailDialog({
  role,
  knowledge,
  allRoles,
  onUpdateReportsTo,
  onSaveFields,
  onCascade,
  onClose,
  onAddKnowledgeFromDialog,
  onArchiveKnowledge,
  onTaskToggle,
}: {
  role: OrgRole | null;
  knowledge: KnowledgeNote[];
  allRoles: OrgRole[];
  onUpdateReportsTo: (role: OrgRole, newParent: string | null) => Promise<void>;
  onSaveFields: (role: OrgRole, patch: Partial<Pick<OrgRole, "goals" | "okrs">>) => Promise<void>;
  onCascade: (role: OrgRole) => Promise<void>;
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

        {/* + Add direct report — quick-create a role under THIS one without
            leaving the dialog. Uses the same /api/org-chart POST as the
            page-level Add Role button, with parent_role_key pre-set. */}
        <section className="mt-3">
          <Button
            size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => {
              const name = prompt(`New direct report under ${role.role_name} — role title (e.g. "VP Sales"):`)?.trim();
              if (!name) return;
              const personName = prompt("Person's name (leave blank if unfilled):")?.trim() ?? "";
              const kind = (confirm("Is this an AI agent? (Cancel = human)") ? "agent" : "human");
              fetch("/api/org-chart", {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  role_name: name,
                  person_name: personName || null,
                  parent_role_key: role.role_key,
                  kind,
                  status: "active",
                }),
              }).then(async r => {
                if (!r.ok) {
                  const e = await r.json().catch(() => ({}));
                  alert(`Failed: ${e.message ?? r.status}`);
                  return;
                }
                // The parent component owns the roles state — easiest
                // way to refresh is a hard reload of the page since we
                // don't have a setter prop here.
                window.location.reload();
              });
            }}
          >
            <UserPlus className="w-3.5 h-3.5 mr-1" /> Add direct report under {role.role_name}
          </Button>
        </section>

        {/* Knowledge / instructions — COLLAPSIBLE-BY-TITLE.
            Each note shows just the title + metadata; click the row to
            expand the body. Click again to collapse. + Add (paste) and
            📎 Upload (file → server-side text extraction) buttons. */}
        <section className="mt-4">
          <KnowledgeBlock
            knowledge={knowledge}
            roleKey={role.role_key}
            onAddKnowledgeFromDialog={onAddKnowledgeFromDialog}
            onArchiveKnowledge={onArchiveKnowledge}
          />
        </section>

        {/* Goals — editable. One textarea per goal, +Add button at the
            bottom, ✕ to remove. Saves on blur via onSaveFields. */}
        <section className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Goals
              <span className="text-xs font-normal text-muted-foreground">({role.goals.length})</span>
            </h4>
            {/* Cascade button — pushes goals + OKRs to direct reports
                routed by topic keyword (finance→CFO, sales→Sales, etc.) */}
            {allRoles.some(r => r.parent_role_key === role.role_key) && (
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => onCascade(role)}
                title="Cascade goals + OKRs to direct reports, routed by topic keyword"
              >
                <Sparkles className="w-3 h-3 mr-1" /> Cascade to DRs
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            {role.goals.map((g, i) => (
              <div key={i} className="flex gap-1 items-start">
                <span className="text-muted-foreground pt-2">•</span>
                <textarea
                  defaultValue={g}
                  rows={Math.max(1, Math.ceil(g.length / 80))}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v === g) return;
                    const next = v ? role.goals.map((x, j) => j === i ? v : x) : role.goals.filter((_, j) => j !== i);
                    void onSaveFields(role, { goals: next });
                  }}
                  className="flex-1 text-sm leading-snug resize-y border-b border-transparent focus:border-primary outline-none bg-transparent py-1"
                />
                <button
                  onClick={() => void onSaveFields(role, { goals: role.goals.filter((_, j) => j !== i) })}
                  className="text-muted-foreground hover:text-destructive p-1"
                  title="Remove goal"
                >×</button>
              </div>
            ))}
            <Button
              size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => void onSaveFields(role, { goals: [...role.goals, "New goal"] })}
            >
              <Plus className="w-3 h-3 mr-1" /> Add goal
            </Button>
          </div>
        </section>

        {/* OKRs — editable. Each objective is a textarea; KRs are one per
            line in their own textarea. ✕ removes the OKR. */}
        <section className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> OKRs
              <span className="text-xs font-normal text-muted-foreground">({role.okrs.length})</span>
            </h4>
          </div>
          <div className="space-y-3">
            {role.okrs.map((o, i) => (
              <div key={i} className="border-l-2 border-primary/30 pl-3 py-1 group">
                <div className="flex items-start gap-1">
                  <span className="text-sm font-medium pt-1 shrink-0">{i + 1}.</span>
                  <textarea
                    defaultValue={o.objective}
                    rows={Math.max(1, Math.ceil(o.objective.length / 70))}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v === o.objective) return;
                      const next = role.okrs.map((x, j) => j === i ? { ...x, objective: v } : x);
                      void onSaveFields(role, { okrs: next });
                    }}
                    className="flex-1 text-sm font-medium resize-y border-b border-transparent focus:border-primary outline-none bg-transparent"
                  />
                  <button
                    onClick={() => void onSaveFields(role, { okrs: role.okrs.filter((_, j) => j !== i) })}
                    className="text-muted-foreground hover:text-destructive p-0.5 opacity-0 group-hover:opacity-100"
                    title="Remove OKR"
                  >×</button>
                </div>
                <textarea
                  defaultValue={o.key_results.join("\n")}
                  rows={Math.max(2, o.key_results.length)}
                  onBlur={(e) => {
                    const krs = e.target.value.split("\n").map(s => s.trim()).filter(Boolean);
                    if (krs.join("\n") === o.key_results.join("\n")) return;
                    const next = role.okrs.map((x, j) => j === i ? { ...x, key_results: krs } : x);
                    void onSaveFields(role, { okrs: next });
                  }}
                  placeholder="One key result per line"
                  className="w-full text-xs text-muted-foreground space-y-0.5 mt-1 resize-y border-b border-transparent focus:border-primary outline-none bg-transparent"
                />
              </div>
            ))}
            <Button
              size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => void onSaveFields(role, {
                okrs: [...role.okrs, { objective: "New objective", key_results: ["KR 1"] }],
              })}
            >
              <Plus className="w-3 h-3 mr-1" /> Add OKR
            </Button>
          </div>
        </section>

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

// ── Knowledge block: collapsed-by-title list + add (paste) + upload (file).
// Clicking a row toggles the body. The first paste creates a new agent
// _knowledge row via POST /api/agent-knowledge; uploads go through
// /api/agent-knowledge/upload which extracts text server-side from
// .txt / .md / .pdf / .pptx / .docx and stores it in the same table.
//
// Persistence model the user asked about: documents land in this table
// → loaded on every brief / agent run as part of the role's prompt.
// LLMs don't fine-tune; "learning" = same context every time.
function KnowledgeBlock({
  knowledge,
  roleKey,
  onAddKnowledgeFromDialog,
  onArchiveKnowledge,
}: {
  knowledge: KnowledgeNote[];
  roleKey: string;
  onAddKnowledgeFromDialog: () => void;
  onArchiveKnowledge: (n: KnowledgeNote) => Promise<void>;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function toggle(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("role_key", roleKey);
      const r = await fetch("/api/agent-knowledge/upload", {
        method: "POST", credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody.message ?? `HTTP ${r.status}`);
      }
      // Hard reload so parent re-fetches knowledge list.
      window.location.reload();
    } catch (err) {
      setUploadError((err as Error).message);
      setUploading(false);
    } finally {
      e.target.value = ""; // allow re-upload of the same file
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          Knowledge / instructions
          <span className="text-xs font-normal text-muted-foreground">({knowledge.length})</span>
        </h4>
        <div className="flex items-center gap-1">
          {/* Upload — accepts text + Office docs; server extracts text. */}
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              accept=".txt,.md,.pdf,.docx,.pptx,.csv"
              onChange={handleFile}
              disabled={uploading}
            />
            <span className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded border border-input bg-background hover:bg-accent">
              {uploading ? "Uploading…" : <><Plus className="w-3 h-3" /> Upload doc</>}
            </span>
          </label>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAddKnowledgeFromDialog}>
            <Plus className="w-3 h-3 mr-1" /> Paste text
          </Button>
        </div>
      </div>

      {uploadError && (
        <p className="text-[10px] text-destructive italic mb-2">Upload failed: {uploadError}</p>
      )}

      {knowledge.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1">
          No knowledge yet. <strong>Paste text</strong> for instructions / playbooks, or <strong>Upload doc</strong> for PDFs / PPTX / DOCX / TXT — text is extracted server-side and persisted so the agent reads it on every run.
        </p>
      ) : (
        <div className="space-y-1">
          {knowledge.map(n => {
            const isOpen = expandedIds.has(n.id);
            return (
              <div key={n.id} className="border rounded bg-muted/20 text-xs overflow-hidden">
                {/* Title row — click to toggle body. */}
                <button
                  type="button"
                  onClick={() => toggle(n.id)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-muted/40 text-left"
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-muted-foreground shrink-0">{isOpen ? "▾" : "▸"}</span>
                    <span className="font-semibold truncate">{n.title || "(untitled)"}</span>
                    <Badge variant="outline" className="text-[9px] py-0 h-4 shrink-0">{n.source}</Badge>
                    <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(n.created_at)}</span>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void onArchiveKnowledge(n); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void onArchiveKnowledge(n); } }}
                    className="cursor-pointer text-muted-foreground hover:text-foreground p-1 shrink-0"
                    title="Archive (kept in log)"
                  ><Archive className="w-3 h-3" /></span>
                </button>
                {/* Body — only when expanded. */}
                {isOpen && (
                  <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed px-2 pb-2 border-t">
                    {n.content}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Persistence note — answers the user's question: how does an LLM
          agent's "learning" persist? Documents stored here are loaded on
          every brief run as context. There is NO fine-tuning — the agent
          re-reads this every time. Limit: total tokens per role × every
          brief. ~50-100 pages per role is the practical ceiling before
          context-window compression kicks in. */}
      {knowledge.length > 0 && (
        <p className="text-[10px] text-muted-foreground italic mt-2">
          Persistence: every paste / upload is stored in <code>agent_knowledge</code> and re-read by the agent on every run. No fine-tuning happens — the agent reads this same text every time it wakes.
        </p>
      )}
    </div>
  );
}
