import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Network, ListTodo, Target, Sparkles, CheckCircle2, Circle, AlertTriangle, Clock, X, MessageSquare, ThumbsUp, ThumbsDown, Check, BookOpen, Plus, Minus, Archive, User, Bot, Mail, UserPlus, ChevronDown, ChevronRight, Briefcase, GraduationCap, Lightbulb, PackageOpen } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import OrgTree, { type OrgTreeNode } from "@/components/OrgTree";

// ── AIOS role-key ↔ agent name map ────────────────────────────────────
const AIOS_NAME_BY_ROLE_KEY: Record<string, string> = {
  "ceo": "CEO", "coo": "COO", "cfo": "CFO", "cco": "CCO",
  "hiring-manager": "CHRO", "marketing-manager": "CMO",
  "cko": "CKO", "delivery-director": "Delivery Officer",
  "pricing-director": "Pricing Agent", "proposal-agent": "Proposal Agent",
  "bd-agent": "BD Agent", "ar-agent": "AR Agent",
  "partnership-agent": "Partnership Agent", "ld-manager": "L&D Manager",
};

interface AiosAgent {
  id: number;
  name: string;
  mission: string | null;
  role_title: string | null;
  function_area: string | null;
  job_description: string | null;
  deliverables: string[] | null;
  skills: string[] | null;
  knowledge: string[] | null;
  training: string[] | null;
}

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
  const [aiosAgents, setAiosAgents] = useState<AiosAgent[]>([]);

  // Collapse state — set of role_keys whose children are hidden.
  // Seeded on data load: all depth-1 nodes (direct reports of root) are
  // collapsed so depth ≥ 2 starts hidden. User can expand subtrees with the
  // +/– toggle that appears on each connector.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const toggleCollapse = (key: string) => setCollapsedKeys(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

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
      fetch("/api/agentic/agents", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([orgs, props, kn, stats, aios]) => {
      setRoles(orgs);
      setProposals(props);
      setKnowledge(kn);
      setAcceptanceStats(stats);
      setAiosAgents(aios);

      // Seed initial collapsed state: collapse all depth-1 nodes so
      // depth ≥ 2 (grandchildren of root) starts hidden on first render.
      const _PEER_RX = /^(president|founder|chairman|board)$/i;
      const _depths = new Map<string, number>();
      const _q: { key: string; d: number }[] = (orgs as OrgRole[])
        .filter(r => !r.parent_role_key && !_PEER_RX.test(r.role_key))
        .map(r => ({ key: r.role_key, d: 0 }));
      for (let _i = 0; _i < _q.length; _i++) {
        const { key, d } = _q[_i];
        if (_depths.has(key)) continue;
        _depths.set(key, d);
        for (const child of (orgs as OrgRole[]).filter(r => r.parent_role_key === key && !_PEER_RX.test(r.role_key)))
          _q.push({ key: child.role_key, d: d + 1 });
      }
      const _initCollapsed = new Set<string>();
      _depths.forEach((depth, key) => { if (depth === 1) _initCollapsed.add(key); });
      setCollapsedKeys(_initCollapsed);

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
    <div className="container mx-auto py-6 w-full max-w-none px-6">
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

      {/* ── Org tree — d3-hierarchy tidy-tree layout with SVG elbow
          connectors. Replaces the previous nested CSS layout that produced
          row misalignment, dual-root ambiguity and overlapping cards.
          Peer roles (President / Founder / Chairman / Board) render to
          the left of CEO with a dotted governance edge. */}
      {ceo && (() => {
        const peerRx = PEER_ROLE_RX;
        const peerIds = roles.filter(r => peerRx.test(r.role_key)).map(r => r.role_key);
        const orgNodes: OrgTreeNode[] = roles.map(r => ({
          id: r.role_key,
          name: r.person_name ?? "",
          title: r.role_name,
          type: (r.kind ?? "agent") as "agent" | "human",
          vacant: r.status === "vacant",
          onboarding: r.status === "onboarding",
          fired: r.status === "fired",
          // Peer roles get null primary boss so they don't clutter the
          // tree; they're rendered separately at level 0 next to the CEO.
          primaryBossId: peerRx.test(r.role_key) ? null : (r.parent_role_key ?? null),
          matrixBossIds: r.dotted_parent_role_keys ?? [],
          knowledgeCount: knowledge.filter(k => k.role_key === r.role_key).length,
          overdueCount: r.tasks_10d.filter(t => t.status !== "done" && daysFromNow(t.due_date) < 0).length,
          highlight: r.role_key === "ceo" || peerRx.test(r.role_key),
          email: r.email ?? undefined,
        }));
        return (
          <div className="mb-3">
            <OrgTree
              nodes={orgNodes}
              peerIds={peerIds}
              collapsedIds={collapsedKeys}
              onToggleCollapse={toggleCollapse}
              onOpen={(id) => {
                const r = roles.find(x => x.role_key === id);
                if (r) setOpenRole(r);
              }}
              onAddKnowledge={(id) => {
                const r = roles.find(x => x.role_key === id);
                if (r) setAddKnowledgeForRole(r);
              }}
            />
          </div>
        );
      })()}

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
        aiosAgent={openRole ? (aiosAgents.find(a => a.name === AIOS_NAME_BY_ROLE_KEY[openRole.role_key]) ?? undefined) : undefined}
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
// 240 × 72 px tile in the SmartDraw / OrgChart-Plus style:
//   - Coloured top accent stripe (blue for top tiers, orange for leaves
//     and deeper roles), driven by the `depth` prop the parent passes.
//   - Circular avatar on the left (initials for humans, bot icon for AI).
//   - Bold coloured name on top, muted role title below.
//   - Status / overdue indicators are dots in the corners (small, quiet).
//   - Add-knowledge button is hover-revealed top-right.
//
// Goals / OKRs / open-task counts have moved to the detail dialog (which
// already shows them in full) — the tile stays clean and readable when
// the chart spans many roles. Underlying data is untouched.
function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function RoleCard({ role, highlight, knowledgeCount, depth = 0, onClick, onAddKnowledge }: {
  role: OrgRole;
  highlight?: boolean;
  knowledgeCount: number;
  depth?: number;
  onClick: () => void;
  onAddKnowledge: () => void;
}) {
  const overdue = role.tasks_10d.filter(t => t.status !== "done" && daysFromNow(t.due_date) < 0).length;

  // Depth-driven accent colour — matches the reference screenshot:
  // depth 0 (CEO/President) and depth 1 (CXOs / direct reports) = blue,
  // depth ≥ 2 (deeper layers) = orange.
  const isUpperTier = depth <= 1;
  const accent = isUpperTier
    ? { stripe: "bg-sky-500",    name: "text-sky-600",    avatarBg: "bg-sky-100",    avatarFg: "text-sky-700" }
    : { stripe: "bg-orange-500", name: "text-orange-600", avatarBg: "bg-orange-100", avatarFg: "text-orange-700" };

  // Display name: prefer the person's name if present, fall back to the
  // role title. Sub-line shows whichever the headline didn't already use.
  const headline = role.person_name?.trim() ? role.person_name : role.role_name;
  const sub      = role.person_name?.trim() ? role.role_name : (role.email || "");

  // Status pip — vacant=red, onboarding=amber, fired=slate, active=none
  const statusPipClass =
    role.status === "vacant"     ? "bg-red-500"
  : role.status === "onboarding" ? "bg-amber-500"
  : role.status === "fired"      ? "bg-slate-500"
                                 : "";

  return (
    <Card
      onClick={onClick}
      className={`group relative cursor-pointer transition-all hover:shadow-md w-[240px] h-[72px] overflow-hidden shrink-0 bg-card border-slate-200 dark:border-slate-700 rounded-md ${
        highlight ? "ring-2 ring-sky-300/60" : ""
      }`}
    >
      {/* Top accent stripe — full width, colour driven by depth. */}
      <div className={`absolute inset-x-0 top-0 h-[3px] ${accent.stripe}`} />

      <div className="flex items-center h-full pl-3 pr-3 pt-[6px] pb-1 gap-3">
        {/* Avatar — initials for humans, bot icon for AI agents. */}
        <div className="relative shrink-0">
          <div className={`w-12 h-12 rounded-full ${accent.avatarBg} ${accent.avatarFg} flex items-center justify-center font-semibold text-sm`}>
            {role.kind === "agent" ? <Bot className="w-5 h-5" /> : initialsOf(role.person_name)}
          </div>
          {/* Overdue indicator — a small red dot on the avatar's corner. */}
          {overdue > 0 && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 ring-2 ring-card"
              title={`${overdue} overdue task${overdue !== 1 ? "s" : ""}`}
            />
          )}
        </div>

        {/* Name + sub */}
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-[13px] leading-tight truncate ${accent.name}`}>{headline}</div>
          {sub && (
            <div className="text-[11px] text-muted-foreground leading-tight truncate mt-0.5">{sub}</div>
          )}
          {/* Status badge under the sub-line, only when not active. */}
          {statusPipClass && (
            <div className="flex items-center gap-1 mt-1">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusPipClass}`} />
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{role.status}</span>
            </div>
          )}
        </div>

        {/* Hover-revealed knowledge button — top-right. */}
        <Button
          size="sm" variant="ghost"
          className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onAddKnowledge(); }}
          title={`Add knowledge for ${role.role_name}`}
        >
          <BookOpen className="w-3 h-3" />
          {knowledgeCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-primary text-primary-foreground rounded-full w-3 h-3 flex items-center justify-center font-semibold">
              {knowledgeCount > 9 ? "9+" : knowledgeCount}
            </span>
          )}
        </Button>
      </div>
    </Card>
  );
}

// ── Recursive role subtree — adaptive layout ─────────────────────────
// Layout rule (matches modern org-chart tools — Pingboard, Sift, Lucidchart):
//   - 0-2 direct reports → render them HORIZONTALLY below the parent
//     (classic top-down org chart). Compact when few reports, easy to read.
//   - 3+ direct reports → render them VERTICALLY to the RIGHT of the
//     parent with a bracket connector. Saves enormous horizontal space
//     so the whole org fits on one page even at depth.
// Cards stay 240×72 in both modes — the user explicitly asked for tiles
// not to grow. The ± toggle stays clickable in both layouts.
function RoleSubtree({
  role, childrenOf, knowledge, onOpen, onAddKnowledge,
  depth = 1, collapsedKeys, onToggleCollapse,
}: {
  role: OrgRole;
  childrenOf: (key: string) => OrgRole[];
  knowledge: KnowledgeNote[];
  onOpen: (r: OrgRole) => void;
  onAddKnowledge: (r: OrgRole) => void;
  depth?: number;
  collapsedKeys: Set<string>;
  onToggleCollapse: (key: string) => void;
}) {
  const children = childrenOf(role.role_key);
  const collapsed = collapsedKeys.has(role.role_key);
  const hasChildren = children.length > 0;
  // Right-stack for ≥3 reports. Threshold matches Livio's brief — three
  // is the point at which a horizontal row starts wasting page width.
  const useVerticalStack = children.length >= 3;

  // Card height = 72px. Card center (when there's a 16px drop above) = 16+36 = 52px.
  // For the right-stack mode the parent column has NO drop above it (drops belong
  // to the rendering caller), so the parent card center is at y=36 from the row top.
  // We keep things aligned by putting `pt-4` (16px) on the right side to match a
  // 16px drop above the parent card — see how this component is invoked.

  // Card-on-top rendering used by both layouts.
  const card = (
    <RoleCard
      role={role}
      depth={depth}
      knowledgeCount={knowledge.filter(k => k.role_key === role.role_key).length}
      onClick={() => onOpen(role)}
      onAddKnowledge={() => onAddKnowledge(role)}
    />
  );

  // Toggle button shared by both layouts (same look, different position).
  const toggleBtn = (
    <button
      type="button"
      onClick={() => onToggleCollapse(role.role_key)}
      className="w-4 h-4 rounded-full bg-card border border-slate-300 flex items-center justify-center hover:border-slate-500 hover:shadow transition-colors shrink-0"
      title={collapsed ? `Expand ${role.role_name}'s reports` : `Collapse ${role.role_name}'s reports`}
    >
      {collapsed
        ? <Plus className="w-2.5 h-2.5 text-slate-600" />
        : <Minus className="w-2.5 h-2.5 text-slate-600" />}
    </button>
  );

  // ── VERTICAL right-stack layout (≥3 reports) ───────────────────────
  if (useVerticalStack) {
    return (
      <div className="flex flex-col items-start">
        {/* Drop line from busbar above — centered above the parent card. */}
        <div className="w-px h-4 bg-slate-300 self-start ml-[120px]" />
        <div className="flex items-start">
          {/* Parent card */}
          {card}
          {/* Bracket area — toggle, then (when expanded) children stack on the right.
              `pt-[28px]` aligns the horizontal stub with the parent card's vertical
              centre (card is 72px tall so centre = 36px; the stub element has height
              ~16px so we offset by 36-8 = 28px). */}
          <div className="flex items-start pt-[28px]">
            {/* Horizontal stub from parent's right edge to the toggle */}
            <div className="w-3 h-px bg-slate-300 mt-2" />
            {toggleBtn}
            {!collapsed && (
              <>
                <div className="w-3 h-px bg-slate-300 mt-2" />
                {/* Bracket: children column with vertical bus on the left */}
                <div className="relative flex flex-col gap-3 -mt-[28px]">
                  {/* Vertical bus from the centre of the first child to centre of the last.
                      Each child is at least 72px tall (cards) and uses gap-3 (12px). The
                      first child's vertical centre lands at y=52 from the top of this column
                      (16 drop + 36 half-card). The last child's centre lands at
                      y=(total - 36 - 16). Easier expressed with inset-y-[52px] which works
                      because every child uses the same 16/72 pattern. */}
                  <div className="absolute left-0 top-[52px] bottom-[52px] w-px bg-slate-300" />
                  {children.map(c => (
                    <div key={c.id} className="relative pl-3">
                      {/* Horizontal stub into this child, at child's vertical centre. */}
                      <div className="absolute left-0 top-[52px] w-3 h-px bg-slate-300" />
                      <RoleSubtree
                        role={c}
                        depth={depth + 1}
                        childrenOf={childrenOf}
                        knowledge={knowledge}
                        onOpen={onOpen}
                        onAddKnowledge={onAddKnowledge}
                        collapsedKeys={collapsedKeys}
                        onToggleCollapse={onToggleCollapse}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── HORIZONTAL below-parent layout (0-2 reports — original behaviour) ──
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-4 bg-slate-300" />
      {card}
      {hasChildren && (
        <div className="flex flex-col items-center w-full">
          <div className="relative w-px h-5 bg-slate-300">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              {toggleBtn}
            </div>
          </div>
          {!collapsed && (
            <div className="relative w-full">
              <div className="absolute inset-x-0 top-0 h-px bg-slate-300" />
              <div className="flex flex-nowrap justify-center gap-4 pt-0">
                {children.map(c => (
                  <RoleSubtree
                    key={c.id}
                    role={c}
                    depth={depth + 1}
                    childrenOf={childrenOf}
                    knowledge={knowledge}
                    onOpen={onOpen}
                    onAddKnowledge={onAddKnowledge}
                    collapsedKeys={collapsedKeys}
                    onToggleCollapse={onToggleCollapse}
                  />
                ))}
              </div>
            </div>
          )}
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
  aiosAgent,
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
  aiosAgent?: AiosAgent;
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

        {/* ── Ordered sections — all collapsed by default ── */}
        {(() => {
          const PRIORITY_SET = new Set(["Must", "Should", "Nice"]);
          const isSource = (n: KnowledgeNote) => Array.isArray(n.tags) && n.tags.some(t => PRIORITY_SET.has(t));
          const brain   = knowledge.filter(n => !isSource(n));
          const sources = knowledge.filter(isSource);
          const hasDRs  = allRoles.some(r => r.parent_role_key === role.role_key);

          return (
            <div className="mt-4 space-y-1.5">

              {/* 1 · Goals */}
              <SectionBlock
                icon={<Target className="w-3.5 h-3.5 text-primary" />}
                label="Goals"
                count={role.goals.length}
                extra={hasDRs && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 ml-auto"
                    onClick={e => { e.stopPropagation(); void onCascade(role); }}>
                    <Sparkles className="w-3 h-3 mr-1" /> Cascade
                  </Button>
                )}
              >
                <div className="space-y-1.5 py-1">
                  {role.goals.length === 0
                    ? <p className="text-xs text-muted-foreground italic">No goals yet.</p>
                    : role.goals.map((g, i) => (
                      <div key={i} className="flex gap-1 items-start">
                        <span className="text-muted-foreground pt-1.5 shrink-0">•</span>
                        <textarea defaultValue={g} rows={Math.max(1, Math.ceil(g.length / 80))}
                          onBlur={e => {
                            const v = e.target.value.trim(); if (v === g) return;
                            const next = v ? role.goals.map((x, j) => j === i ? v : x) : role.goals.filter((_, j) => j !== i);
                            void onSaveFields(role, { goals: next });
                          }}
                          className="flex-1 text-sm leading-snug resize-y border-b border-transparent focus:border-primary outline-none bg-transparent py-1" />
                        <button onClick={() => void onSaveFields(role, { goals: role.goals.filter((_, j) => j !== i) })}
                          className="text-muted-foreground hover:text-destructive p-1 shrink-0">×</button>
                      </div>
                    ))}
                  <Button size="sm" variant="ghost" className="h-7 text-xs mt-1"
                    onClick={() => void onSaveFields(role, { goals: [...role.goals, "New goal"] })}>
                    <Plus className="w-3 h-3 mr-1" /> Add goal
                  </Button>
                </div>
              </SectionBlock>

              {/* 2 · OKRs */}
              <SectionBlock
                icon={<Sparkles className="w-3.5 h-3.5 text-primary" />}
                label="OKRs"
                count={role.okrs.length}
              >
                <div className="space-y-3 py-1">
                  {role.okrs.length === 0
                    ? <p className="text-xs text-muted-foreground italic">No OKRs yet.</p>
                    : role.okrs.map((o, i) => (
                      <div key={i} className="border-l-2 border-primary/30 pl-3 py-1 group">
                        <div className="flex items-start gap-1">
                          <span className="text-sm font-medium pt-1 shrink-0">{i + 1}.</span>
                          <textarea defaultValue={o.objective} rows={Math.max(1, Math.ceil(o.objective.length / 70))}
                            onBlur={e => {
                              const v = e.target.value.trim(); if (v === o.objective) return;
                              void onSaveFields(role, { okrs: role.okrs.map((x, j) => j === i ? { ...x, objective: v } : x) });
                            }}
                            className="flex-1 text-sm font-medium resize-y border-b border-transparent focus:border-primary outline-none bg-transparent" />
                          <button onClick={() => void onSaveFields(role, { okrs: role.okrs.filter((_, j) => j !== i) })}
                            className="text-muted-foreground hover:text-destructive p-0.5 opacity-0 group-hover:opacity-100">×</button>
                        </div>
                        <textarea defaultValue={o.key_results.join("\n")} rows={Math.max(2, o.key_results.length)}
                          onBlur={e => {
                            const krs = e.target.value.split("\n").map(s => s.trim()).filter(Boolean);
                            if (krs.join("\n") === o.key_results.join("\n")) return;
                            void onSaveFields(role, { okrs: role.okrs.map((x, j) => j === i ? { ...x, key_results: krs } : x) });
                          }}
                          placeholder="One key result per line"
                          className="w-full text-xs text-muted-foreground mt-1 resize-y border-b border-transparent focus:border-primary outline-none bg-transparent" />
                      </div>
                    ))}
                  <Button size="sm" variant="ghost" className="h-7 text-xs mt-1"
                    onClick={() => void onSaveFields(role, { okrs: [...role.okrs, { objective: "New objective", key_results: ["KR 1"] }] })}>
                    <Plus className="w-3 h-3 mr-1" /> Add OKR
                  </Button>
                </div>
              </SectionBlock>

              {/* 3 · Actions (Tasks 10d) */}
              <SectionBlock
                icon={<ListTodo className="w-3.5 h-3.5 text-primary" />}
                label="Actions"
                count={role.tasks_10d.length}
                badge={openTasks.filter(t => daysFromNow(t.due_date) < 0).length > 0
                  ? <span className="text-[9px] bg-red-500 text-white rounded-full px-1.5 py-0.5 ml-1">
                      {openTasks.filter(t => daysFromNow(t.due_date) < 0).length} overdue
                    </span> : undefined}
              >
                <div className="py-1">
                  {role.tasks_10d.length === 0
                    ? <p className="text-xs text-muted-foreground italic">No tasks yet. Daily agent run will populate this.</p>
                    : (
                      <ul className="space-y-1.5">
                        {[...openTasks, ...doneTasks].map(t => {
                          const dDays = daysFromNow(t.due_date);
                          const overdue = t.status !== "done" && dDays < 0;
                          return (
                            <li key={t.id} className={`flex items-start gap-2 p-2 rounded border ${overdue ? "border-red-300 bg-red-50/50" : "border-border"}`}>
                              <button onClick={() => onTaskToggle(t, t.status === "done" ? "todo" : "done")} className="mt-0.5">
                                {taskStatusIcon(t.status)}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className={`text-sm leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                  <span>{fmtDate(t.due_date)}</span>
                                  {overdue && <span className="text-red-600 font-semibold">overdue</span>}
                                  {!overdue && dDays >= 0 && dDays <= 1 && <span className="text-amber-600 font-semibold">due soon</span>}
                                  {t.linked_url && <a href={t.linked_url} className="text-primary hover:underline">open →</a>}
                                </div>
                                {t.note && <div className="text-[11px] text-muted-foreground italic mt-0.5">{t.note}</div>}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                </div>
              </SectionBlock>

              {/* 4 · Brain (pasted notes / uploaded docs) */}
              <SectionBlock
                icon={<BookOpen className="w-3.5 h-3.5 text-primary" />}
                label="Brain"
                count={brain.length}
                extra={
                  <div className="flex items-center gap-1 ml-auto" onClick={e => e.stopPropagation()}>
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" accept=".txt,.md,.pdf,.docx,.pptx,.csv"
                        onChange={async e => {
                          const file = e.target.files?.[0]; if (!file) return;
                          const fd = new FormData(); fd.append("file", file); fd.append("role_key", role.role_key);
                          await fetch("/api/agent-knowledge/upload", { method: "POST", credentials: "include", body: fd });
                          window.location.reload();
                        }} />
                      <span className="inline-flex items-center gap-1 h-6 px-2 text-[10px] rounded border border-input bg-background hover:bg-accent cursor-pointer">
                        <Plus className="w-3 h-3" /> Upload
                      </span>
                    </label>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={onAddKnowledgeFromDialog}>
                      <Plus className="w-3 h-3 mr-0.5" /> Paste
                    </Button>
                  </div>
                }
              >
                <NoteList notes={brain} onArchive={onArchiveKnowledge} />
              </SectionBlock>

              {/* 5 · Sources (Excel reputable sources, tagged Must/Should/Nice) */}
              <SectionBlock
                icon={<PackageOpen className="w-3.5 h-3.5 text-primary" />}
                label="Sources"
                count={sources.length}
              >
                <NoteList notes={sources} onArchive={onArchiveKnowledge} showTags />
              </SectionBlock>

              {/* 6 · Skills (AIOS spec: deliverables, skills, training, domain knowledge) */}
              {aiosAgent && (
                <SectionBlock
                  icon={<Lightbulb className="w-3.5 h-3.5 text-primary" />}
                  label="Skills & Profile"
                  count={(aiosAgent.deliverables?.length ?? 0) + (aiosAgent.skills?.length ?? 0) + (aiosAgent.training?.length ?? 0)}
                >
                  <div className="space-y-1 py-1">
                    {aiosAgent.function_area && (
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary" className="text-[10px]">{aiosAgent.function_area}</Badge>
                        {aiosAgent.role_title && <span className="text-[11px] text-muted-foreground">{aiosAgent.role_title}</span>}
                      </div>
                    )}
                    {aiosAgent.job_description && (
                      <SpecGroup icon={<Briefcase className="w-3 h-3 text-slate-500 shrink-0" />} label="Job Description" items={[aiosAgent.job_description]} />
                    )}
                    <SpecGroup icon={<PackageOpen className="w-3 h-3 text-blue-500 shrink-0" />} label="Deliverables" items={aiosAgent.deliverables ?? []} defaultOpen />
                    <SpecGroup icon={<Lightbulb className="w-3 h-3 text-amber-500 shrink-0" />} label="Skills" items={aiosAgent.skills ?? []} />
                    <SpecGroup icon={<BookOpen className="w-3 h-3 text-emerald-500 shrink-0" />} label="Domain Knowledge" items={aiosAgent.knowledge ?? []} />
                    <SpecGroup icon={<GraduationCap className="w-3 h-3 text-purple-500 shrink-0" />} label="Training" items={aiosAgent.training ?? []} />
                  </div>
                </SectionBlock>
              )}

            </div>
          );
        })()}

        <div className="flex justify-end mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="w-4 h-4 mr-1" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── SectionBlock — uniform collapsible section header ─────────────────
function SectionBlock({
  icon, label, count, badge, extra, children, defaultOpen = false,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/10 hover:bg-muted/30 text-left transition-colors"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
        {icon}
        <span className="text-sm font-semibold">{label}</span>
        {count !== undefined && (
          <span className="text-[11px] text-muted-foreground font-normal">({count})</span>
        )}
        {badge}
        {extra}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t bg-background">
          {children}
        </div>
      )}
    </div>
  );
}

// ── NoteList — compact accordion list of knowledge/source notes ────────
function NoteList({
  notes, onArchive, showTags = false,
}: {
  notes: KnowledgeNote[];
  onArchive: (n: KnowledgeNote) => Promise<void>;
  showTags?: boolean;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpandedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  if (notes.length === 0) return <p className="text-xs text-muted-foreground italic py-2">None yet.</p>;
  return (
    <div className="space-y-0.5 py-1">
      {notes.map(n => {
        const isOpen = expandedIds.has(n.id);
        return (
          <div key={n.id} className="border rounded text-xs overflow-hidden">
            <button type="button" onClick={() => toggle(n.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/30 text-left">
              {isOpen
                ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
              <span className="font-medium truncate flex-1">{n.title || "(untitled)"}</span>
              {showTags && n.tags.length > 0 && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                  n.tags[1] === "Must"  ? "bg-red-100 text-red-700"
                  : n.tags[1] === "Should" ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-600"
                }`}>{n.tags[1]}</span>
              )}
              {!showTags && <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(n.created_at)}</span>}
              <span role="button" tabIndex={0}
                onClick={e => { e.stopPropagation(); void onArchive(n); }}
                onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); void onArchive(n); } }}
                className="cursor-pointer text-muted-foreground hover:text-foreground p-1 shrink-0" title="Archive">
                <Archive className="w-3 h-3" />
              </span>
            </button>
            {isOpen && (
              <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed px-2 pb-2 border-t text-muted-foreground">
                {n.content}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Agent Spec Section ────────────────────────────────────────────────
// Renders the structured AIOS spec for the role: function area, job
// description, deliverables, skills, training. Each sub-section is
// independently collapsible so the dialog doesn't feel overwhelming.
function SpecGroup({
  icon, label, items, defaultOpen = false,
}: { icon: React.ReactNode; label: string; items: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items || items.length === 0) return null;
  return (
    <div className="border rounded bg-muted/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/30 text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
        {icon}
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{items.length} items</span>
      </button>
      {open && (
        <ul className="px-3 pb-2 pt-0.5 space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5">
              <span className="text-muted-foreground/50 mt-0.5 shrink-0">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// AgentSpecSection removed — spec data now rendered inline inside
// SectionBlock("Skills & Profile") within RoleDetailDialog.
