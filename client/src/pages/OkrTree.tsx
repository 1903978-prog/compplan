import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Target, UserPlus, AlertTriangle, Bot, User, Check, X as XIcon, Clock, Plus, Trash2, Link as LinkIcon, Lightbulb, ListTodo } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Maps OkrTree role_key values → AIOS agent names (agents table)
const ROLE_KEY_TO_AIOS: Record<string, string> = {
  "ceo":              "CEO",
  "coo":              "COO",
  "cco":              "SVP Sales / BD",
  "cfo":              "CFO",
  "chro":             "CHRO",
  "hiring-manager":   "CHRO",
  "delivery-director":"Delivery Officer",
  "pricing-director": "Pricing Agent",
  "marketing-manager":"CMO",
  "cko":              "CKO",
  "ld-manager":       "L&D Manager",
};

interface AgenticAgent { id: number; name: string; }
interface AgenticIdea  { id: number; agent_id: number; title: string; description: string | null; total_score: number | null; status: string; }
interface AgenticTask  { id: number; agent_id: number; title: string; deadline: string | null; status: string; approval_level: string | null; }

// ── EBITDA Growth Driver Tree ────────────────────────────────────────────────
// Static issue tree from the EBITDA Growth Strategy doc. Each node lists the
// role(s) owning that branch by role_key (matches org_agents.role_key in DB).
// When NO existing role fits a branch, set ownersRoleKeys = [] AND populate
// hireSuggestion — the page renders a red "Hire suggested" callout the CEO
// can act on.

interface OkrNode {
  id: string;
  label: string;
  ownersRoleKeys: string[];
  hireSuggestion?: { roleName: string; rationale: string };
  children?: OkrNode[];
}

const TREE: OkrNode = {
  id: "A1", label: "Increase EBITDA",
  ownersRoleKeys: ["ceo"],
  children: [
    {
      id: "B1", label: "Increase proposals sold",
      ownersRoleKeys: ["cco"],
      children: [
        {
          id: "C1", label: "Generate more leads",
          ownersRoleKeys: ["marketing-manager", "cco"],
          children: [
            { id: "D1", label: "Reconnect past clients", ownersRoleKeys: ["cco"] },
            {
              id: "D2", label: "Increase media exposure",
              ownersRoleKeys: ["marketing-manager"],
              children: [
                { id: "E1", label: "LinkedIn",            ownersRoleKeys: ["marketing-manager"] },
                { id: "E2", label: "Website",             ownersRoleKeys: ["marketing-manager"] },
                { id: "E3", label: "Medium / Substack",   ownersRoleKeys: ["marketing-manager"] },
                { id: "E4", label: "PR / press releases", ownersRoleKeys: ["marketing-manager"] },
                { id: "E5", label: "Articles in press",   ownersRoleKeys: ["marketing-manager"] },
                { id: "E6", label: "Top-tier mentions",   ownersRoleKeys: ["marketing-manager"] },
              ],
            },
            {
              id: "D3", label: "Send more cold emails",
              ownersRoleKeys: [],
              hireSuggestion: {
                roleName: "SDR Lead (Outbound)",
                rationale: "CCO is consumed by proposal + close work. A dedicated SDR Lead owns outbound volume, ICP list-building, sequencing, and the send-cadence.",
              },
              children: [
                { id: "E7", label: "More ICP volume",    ownersRoleKeys: [], hireSuggestion: { roleName: "SDR Lead (Outbound)", rationale: "Owns ICP list growth + targeting." } },
                { id: "E8", label: "Better email hooks", ownersRoleKeys: ["marketing-manager"] },
                { id: "E9", label: "Higher conversion",  ownersRoleKeys: ["cco"] },
              ],
            },
            {
              id: "D4", label: "Add more partners",
              ownersRoleKeys: [],
              hireSuggestion: {
                roleName: "Head of Partnerships",
                rationale: "Channel partners (PE funds, complementary firms, ex-MBB Partners) compound outbound 3-5×. Today nobody owns the partnership pipeline.",
              },
            },
          ],
        },
        {
          id: "C2", label: "Generate more pitches",
          ownersRoleKeys: ["cco"],
          children: [
            {
              id: "D5", label: "Increase selling time",
              ownersRoleKeys: ["coo"],
              children: [
                { id: "E10", label: "Automate internal work", ownersRoleKeys: ["coo"] },
                { id: "E11", label: "Use AI",                  ownersRoleKeys: ["coo"] },
                { id: "E12", label: "Reduce admin effort",     ownersRoleKeys: ["coo"] },
              ],
            },
          ],
        },
        {
          id: "C3", label: "Increase conversion",
          ownersRoleKeys: ["cco"],
          children: [
            { id: "D6", label: "Better proposals", ownersRoleKeys: ["cco", "pricing-director"] },
            { id: "D7", label: "Better teams",     ownersRoleKeys: ["hiring-manager", "delivery-director"] },
            {
              id: "D8", label: "Right fees",
              ownersRoleKeys: ["pricing-director"],
              children: [
                { id: "E13", label: "Win-loss analysis", ownersRoleKeys: ["pricing-director"] },
                { id: "E14", label: "Pricing model",     ownersRoleKeys: ["pricing-director"] },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "B2", label: "Increase repeat business",
      ownersRoleKeys: ["delivery-director"],
      children: [
        {
          id: "C4", label: "Increase upsell",
          ownersRoleKeys: [],
          hireSuggestion: { roleName: "Head of Accounts", rationale: "Owns NRR, expansion bookings, and the cross-sell motion across the won-portfolio." },
        },
        {
          id: "C5", label: "Increase cross-sell",
          ownersRoleKeys: [],
          hireSuggestion: { roleName: "Head of Accounts", rationale: "Same role as upsell — bundle them under one accountable owner." },
        },
        { id: "C6", label: "Improve NPS",                ownersRoleKeys: ["delivery-director"] },
        { id: "C7", label: "Institutionalize accounts",  ownersRoleKeys: ["delivery-director", "ceo"] },
      ],
    },
    {
      id: "B3", label: "Scale delivery team",
      ownersRoleKeys: ["hiring-manager"],
      children: [
        {
          id: "C8", label: "Ensure capacity",
          ownersRoleKeys: ["hiring-manager"],
          children: [
            { id: "D9",  label: "Hiring process",     ownersRoleKeys: ["hiring-manager"] },
            { id: "D10", label: "Attractive EVP",     ownersRoleKeys: ["hiring-manager", "marketing-manager"] },
            { id: "D11", label: "Competitive salary", ownersRoleKeys: ["hiring-manager", "cfo"] },
            { id: "D12", label: "Anticipate churn",   ownersRoleKeys: ["hiring-manager"] },
          ],
        },
      ],
    },
    {
      id: "B4", label: "Maximize gross margin",
      ownersRoleKeys: ["cfo", "pricing-director", "delivery-director"],
      children: [
        { id: "C9",  label: "Pricing discipline",  ownersRoleKeys: ["pricing-director"] },
        { id: "C10", label: "Delivery efficiency", ownersRoleKeys: ["delivery-director"] },
        { id: "C11", label: "Scope control",       ownersRoleKeys: ["delivery-director", "cco"] },
      ],
    },
  ],
};

type OrgAgent = {
  id: number;
  role_key: string;
  role_name: string;
  person_name: string | null;
  status: string;
  kind: "agent" | "human";
};

// ── Tier styling per ID prefix (matches the slide's colour ramp) ────────────
//   A → dark teal (root)
//   B → cyan, bold
//   C → light cyan
//   D → outlined slate
//   E → outlined slate, smaller
function tierStyle(depth: number): string {
  switch (depth) {
    case 0: return "bg-[#0E5365] text-white border-[#0E5365] font-bold";
    case 1: return "bg-[#1A6571] text-white border-[#1A6571] font-semibold";
    case 2: return "bg-[#3FB6C5]/20 text-[#0E5365] border-[#3FB6C5] font-semibold";
    case 3: return "bg-white text-[#1A6571] border-[#3FB6C5]";
    case 4: return "bg-white text-slate-700 border-slate-300 text-[11px]";
    default: return "bg-white text-slate-700 border-slate-300 text-[11px]";
  }
}

// Approximate box width per tier — enough for the longest label at that level.
function tierWidth(depth: number): number {
  switch (depth) {
    case 0: return 110;
    case 1: return 200;
    case 2: return 200;
    case 3: return 220;
    case 4: return 200;
    default: return 200;
  }
}

// Per-node persisted data shape (matches okr_node_data table).
interface NodeData {
  node_id: string;
  objectives: { text: string; target?: string | null }[];
  kpis: { name: string; target?: string | null; current?: string | null; unit?: string | null }[];
  depending_node_ids: string[];
  owner_override_role_keys: string[] | null;
  notes: string | null;
}

// Hire-suggestion decision state — persisted in localStorage so deny/
// postpone don't need a DB round-trip. Approvals create real org_agents
// rows via /api/org-chart and disappear from the suggestion list naturally.
type SuggestionDecision = { status: "denied" | "postponed"; until?: string };
const SUGGESTION_DECISIONS_KEY = "okr_suggestion_decisions_v1";
function loadSuggestionDecisions(): Record<string, SuggestionDecision> {
  try {
    const raw = localStorage.getItem(SUGGESTION_DECISIONS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) ?? {};
  } catch { return {}; }
}
function saveSuggestionDecisions(d: Record<string, SuggestionDecision>) {
  try { localStorage.setItem(SUGGESTION_DECISIONS_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

// Walk the tree and find every node, used for the depending-branches picker
// + look-up by id when rendering the side panel.
function flattenTree(n: OkrNode, out: OkrNode[] = []): OkrNode[] {
  out.push(n);
  for (const c of n.children ?? []) flattenTree(c, out);
  return out;
}

export default function OkrTree() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<OrgAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [nodeDataByKey, setNodeDataByKey] = useState<Record<string, NodeData>>({});
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, SuggestionDecision>>(() => loadSuggestionDecisions());
  const [approveTarget, setApproveTarget] = useState<{ roleName: string; rationale: string; nodeIds: string[] } | null>(null);
  // AIOS live data for branch views
  const [agenticAgents, setAgenticAgents] = useState<AgenticAgent[]>([]);
  const [agenticIdeas,  setAgenticIdeas]  = useState<AgenticIdea[]>([]);
  const [agenticTasks,  setAgenticTasks]  = useState<AgenticTask[]>([]);

  // Initial load: org-chart + okr-nodes + agentic data in parallel.
  useEffect(() => {
    Promise.all([
      fetch("/api/org-chart",          { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/okr-nodes",          { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/agentic/agents",     { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/agentic/ideas",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/agentic/tasks",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([orgRows, nodeRows, aa, ai, at]) => {
      setAgents(Array.isArray(orgRows) ? orgRows : []);
      const map: Record<string, NodeData> = {};
      for (const row of (Array.isArray(nodeRows) ? nodeRows : []) as NodeData[]) {
        map[row.node_id] = row;
      }
      setNodeDataByKey(map);
      setAgenticAgents(Array.isArray(aa) ? aa : []);
      setAgenticIdeas(Array.isArray(ai) ? ai : []);
      setAgenticTasks(Array.isArray(at) ? at : []);
      setLoading(false);
    }).catch(() => { toast({ title: "Failed to load OKR data", variant: "destructive" }); setLoading(false); });
  }, [toast]);

  const byKey = useMemo(() => {
    const m = new Map<string, OrgAgent>();
    for (const a of agents) m.set(a.role_key, a);
    return m;
  }, [agents]);

  const allNodes = useMemo(() => flattenTree(TREE), []);
  const nodeById = useMemo(() => {
    const m = new Map<string, OkrNode>();
    for (const n of allNodes) m.set(n.id, n);
    return m;
  }, [allNodes]);

  const openNode = openNodeId ? nodeById.get(openNodeId) ?? null : null;
  const openData = openNode ? nodeDataByKey[openNode.id] ?? null : null;

  // Save NodeData (upsert) for the currently-open node.
  async function saveNodeData(nodeId: string, patch: Partial<NodeData>) {
    // Optimistic local update so the side panel feels instant.
    setNodeDataByKey(prev => ({
      ...prev,
      [nodeId]: {
        node_id: nodeId,
        objectives: prev[nodeId]?.objectives ?? [],
        kpis: prev[nodeId]?.kpis ?? [],
        depending_node_ids: prev[nodeId]?.depending_node_ids ?? [],
        owner_override_role_keys: prev[nodeId]?.owner_override_role_keys ?? null,
        notes: prev[nodeId]?.notes ?? null,
        ...patch,
      },
    }));
    try {
      const r = await fetch(`/api/okr-nodes/${encodeURIComponent(nodeId)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const saved = await r.json();
      setNodeDataByKey(prev => ({ ...prev, [nodeId]: saved }));
    } catch (e) {
      toast({ title: "Failed to save", description: (e as Error).message, variant: "destructive" });
    }
  }

  // Hire-suggestion list with decisions filtered out (denied + postponed-not-yet-due).
  const hireSuggestions = useMemo(() => {
    const seen = new Map<string, { roleName: string; rationale: string; nodeIds: string[] }>();
    function walk(n: OkrNode) {
      if (n.hireSuggestion && n.ownersRoleKeys.length === 0) {
        const k = n.hireSuggestion.roleName;
        const existing = seen.get(k);
        if (existing) existing.nodeIds.push(n.id);
        else seen.set(k, { ...n.hireSuggestion, nodeIds: [n.id] });
      }
      for (const c of n.children ?? []) walk(c);
    }
    walk(TREE);
    const today = new Date().toISOString().slice(0, 10);
    return Array.from(seen.values()).filter(h => {
      const d = decisions[h.roleName];
      if (!d) return true;
      if (d.status === "denied") return false;
      if (d.status === "postponed" && d.until && d.until > today) return false;
      return true; // postponed but past snooze date → resurface
    });
  }, [decisions]);

  // Postpone / deny actions.
  function decide(roleName: string, status: "denied" | "postponed") {
    const next: Record<string, SuggestionDecision> = { ...decisions };
    if (status === "denied") {
      next[roleName] = { status: "denied" };
    } else {
      const until = new Date();
      until.setDate(until.getDate() + 7);
      next[roleName] = { status: "postponed", until: until.toISOString().slice(0, 10) };
    }
    setDecisions(next);
    saveSuggestionDecisions(next);
    toast({ title: status === "denied" ? "Hire dismissed" : "Postponed 7 days" });
  }

  // Approve = create the role in org_agents under the chosen parent.
  async function approveHire(roleName: string, parentRoleKey: string) {
    try {
      const r = await fetch("/api/org-chart", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role_name: roleName,
          parent_role_key: parentRoleKey,
          kind: "agent",
          status: "active",
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${r.status}`);
      }
      const created = await r.json();
      setAgents(prev => [...prev, created]);
      toast({ title: `Hired: ${roleName}`, description: `Reports to ${parentRoleKey}. Add a person + email in /exec/org-chart when ready.` });
      setApproveTarget(null);
    } catch (e) {
      toast({ title: "Failed to create role", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (loading) {
    return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading OKR tree…</div>;
  }

  return (
    <div className="container mx-auto py-6 max-w-[1900px] space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Target className="w-7 h-7 text-primary mt-1" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">EBITDA GROWTH STRATEGY</p>
            <h1 className="text-2xl font-bold tracking-tight">Eendigo EBITDA Growth Driver Tree</h1>
            <p className="text-sm text-muted-foreground max-w-3xl mt-1">
              Each branch shows the agent(s) accountable for moving it. Branches with no owner are tagged <Badge variant="destructive" className="text-[9px] py-0 px-1.5 mx-0.5">Hire</Badge> with a suggested role.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.print()}>Print / PDF</Button>
      </div>

      {hireSuggestions.length > 0 && (
        <Card className="p-4 border-red-200 bg-red-50/30">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-bold text-red-900">Hires needed to fully cover the tree ({hireSuggestions.length})</h2>
            <span className="text-[10px] text-red-700/70 ml-2">Approve · Deny · Postpone — every action needs a decision.</span>
          </div>
          <div className="space-y-2">
            {hireSuggestions.map(h => (
              <div key={h.roleName} className="text-xs flex items-start gap-2 flex-wrap">
                <Badge variant="destructive" className="shrink-0">{h.roleName}</Badge>
                <span className="text-muted-foreground flex-1 min-w-[300px]">
                  {h.rationale} <span className="text-[10px] italic">Covers nodes: {h.nodeIds.join(", ")}.</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm" className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => setApproveTarget(h)}
                  >
                    <Check className="w-3 h-3 mr-1" /> Approve (hire)
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                    onClick={() => decide(h.roleName, "denied")}
                  >
                    <XIcon className="w-3 h-3 mr-1" /> Deny
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                    onClick={() => decide(h.roleName, "postponed")}
                  >
                    <Clock className="w-3 h-3 mr-1" /> Postpone 7d
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tree canvas — horizontal recursive layout with L-shaped connectors */}
      <Card className="p-6 overflow-x-auto bg-white">
        {/* Horizontal divider line under header — same teal as slide */}
        <div className="h-px bg-[#1A6571] mb-6" />
        <div className="inline-block min-w-full">
          <HorizontalNode node={TREE} depth={0} byKey={byKey} onSelectNode={setOpenNodeId} />
        </div>
      </Card>

      {/* ── Side panel: per-branch detail (objectives / KPIs / dependencies) ── */}
      {openNode && (
        <NodeSidePanel
          node={openNode}
          data={openData}
          allNodes={allNodes}
          nodeById={nodeById}
          byKey={byKey}
          agenticAgents={agenticAgents}
          agenticIdeas={agenticIdeas}
          agenticTasks={agenticTasks}
          onClose={() => setOpenNodeId(null)}
          onSave={(patch) => saveNodeData(openNode.id, patch)}
          onJumpToNode={(id) => setOpenNodeId(id)}
        />
      )}

      {/* ── Approve-hire dialog: pick which role this hire reports to ── */}
      {approveTarget && (
        <ApproveHireDialog
          target={approveTarget}
          allRoles={agents}
          nodeById={nodeById}
          onCancel={() => setApproveTarget(null)}
          onConfirm={(parentRoleKey) => approveHire(approveTarget.roleName, parentRoleKey)}
        />
      )}
    </div>
  );
}

// ── Side panel — per-node objectives + KPIs + depending branches ──────────
function NodeSidePanel({
  node, data, allNodes, nodeById, byKey,
  agenticAgents, agenticIdeas, agenticTasks,
  onClose, onSave, onJumpToNode,
}: {
  node: OkrNode;
  data: NodeData | null;
  allNodes: OkrNode[];
  nodeById: Map<string, OkrNode>;
  byKey: Map<string, OrgAgent>;
  agenticAgents: AgenticAgent[];
  agenticIdeas: AgenticIdea[];
  agenticTasks: AgenticTask[];
  onClose: () => void;
  onSave: (patch: Partial<NodeData>) => Promise<void>;
  onJumpToNode: (id: string) => void;
}) {
  const objectives = data?.objectives ?? [];
  const kpis = data?.kpis ?? [];
  const dependingIds = data?.depending_node_ids ?? [];
  const owners = node.ownersRoleKeys.map(rk => byKey.get(rk)).filter(Boolean) as OrgAgent[];

  // AIOS: resolve primary owner → agentic agent → ideas + tasks
  const primaryRoleKey = node.ownersRoleKeys[0] ?? null;
  const agenticName    = primaryRoleKey ? (ROLE_KEY_TO_AIOS[primaryRoleKey] ?? null) : null;
  const agenticAgent   = agenticName ? agenticAgents.find(a => a.name.toLowerCase() === agenticName.toLowerCase()) ?? null : null;
  const branchIdeas    = agenticAgent
    ? agenticIdeas
        .filter(i => i.agent_id === agenticAgent.id && i.status === "proposed")
        .sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0))
        .slice(0, 3)
    : [];
  const branchTasks = agenticAgent
    ? agenticTasks
        .filter(t => t.agent_id === agenticAgent.id && (t.status === "open" || t.status === "in_progress"))
        .sort((a, b) => {
          if (!a.deadline && !b.deadline) return 0;
          if (!a.deadline) return 1;
          if (!b.deadline) return -1;
          return a.deadline.localeCompare(b.deadline);
        })
        .slice(0, 3)
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />
      {/* Panel — slides in from the right */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-[480px] bg-background z-50 shadow-2xl border-l overflow-y-auto">
        <div className="sticky top-0 bg-background/95 backdrop-blur border-b px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">{node.id}</Badge>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Branch</span>
            </div>
            <h2 className="text-lg font-bold mt-1">{node.label}</h2>
            <div className="flex flex-wrap gap-1 mt-2">
              {owners.length > 0 ? owners.map((a, i) => {
                const Icon = a.kind === "human" ? User : Bot;
                return (
                  <Badge key={a.role_key} variant="outline" className={`text-[10px] flex items-center gap-1 ${i === 0 ? "border-emerald-400 bg-emerald-50 text-emerald-900" : "border-slate-300 bg-slate-50 text-slate-700"}`}>
                    <Icon className="w-2.5 h-2.5" />
                    {a.role_name}{a.person_name ? ` · ${a.person_name.split(" ")[0]}` : ""}
                  </Badge>
                );
              }) : (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                  No agent — needs hire
                </Badge>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1" title="Close">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* Objectives */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Objectives</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => void onSave({ objectives: [...objectives, { text: "New objective", target: null }] })}
              >
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
            {objectives.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">None yet.</p>
            ) : (
              <div className="space-y-2">
                {objectives.map((o, i) => (
                  <div key={i} className="border rounded p-2 bg-card space-y-1.5">
                    <div className="flex items-start gap-1">
                      <Textarea
                        defaultValue={o.text}
                        rows={Math.max(1, Math.ceil(o.text.length / 50))}
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          if (text === o.text) return;
                          const next = [...objectives];
                          next[i] = { ...o, text };
                          void onSave({ objectives: next });
                        }}
                        className="flex-1 text-sm font-medium min-h-0"
                      />
                      <button
                        onClick={() => void onSave({ objectives: objectives.filter((_, j) => j !== i) })}
                        className="text-muted-foreground hover:text-destructive p-1"
                        title="Remove"
                      ><Trash2 className="w-3 h-3" /></button>
                    </div>
                    <Input
                      defaultValue={o.target ?? ""}
                      onBlur={(e) => {
                        const target = e.target.value.trim() || null;
                        if (target === (o.target ?? null)) return;
                        const next = [...objectives];
                        next[i] = { ...o, target };
                        void onSave({ objectives: next });
                      }}
                      placeholder="Target (e.g. ≥€3M revenue 2026)"
                      className="h-7 text-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* KPIs */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">KPIs</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => void onSave({ kpis: [...kpis, { name: "New KPI", target: null, current: null, unit: null }] })}
              >
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
            {kpis.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">None yet.</p>
            ) : (
              <div className="space-y-2">
                {kpis.map((k, i) => (
                  <div key={i} className="border rounded p-2 bg-card grid grid-cols-[1fr_auto] gap-1.5">
                    <Input
                      defaultValue={k.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name === k.name) return;
                        const next = [...kpis];
                        next[i] = { ...k, name };
                        void onSave({ kpis: next });
                      }}
                      placeholder="KPI name"
                      className="h-7 text-xs font-medium"
                    />
                    <button
                      onClick={() => void onSave({ kpis: kpis.filter((_, j) => j !== i) })}
                      className="text-muted-foreground hover:text-destructive p-1"
                      title="Remove"
                    ><Trash2 className="w-3 h-3" /></button>
                    <div className="grid grid-cols-3 gap-1.5 col-span-2">
                      <Input
                        defaultValue={k.target ?? ""}
                        onBlur={(e) => {
                          const target = e.target.value.trim() || null;
                          if (target === (k.target ?? null)) return;
                          const next = [...kpis];
                          next[i] = { ...k, target };
                          void onSave({ kpis: next });
                        }}
                        placeholder="Target"
                        className="h-7 text-[11px]"
                      />
                      <Input
                        defaultValue={k.current ?? ""}
                        onBlur={(e) => {
                          const current = e.target.value.trim() || null;
                          if (current === (k.current ?? null)) return;
                          const next = [...kpis];
                          next[i] = { ...k, current };
                          void onSave({ kpis: next });
                        }}
                        placeholder="Current"
                        className="h-7 text-[11px]"
                      />
                      <Input
                        defaultValue={k.unit ?? ""}
                        onBlur={(e) => {
                          const unit = e.target.value.trim() || null;
                          if (unit === (k.unit ?? null)) return;
                          const next = [...kpis];
                          next[i] = { ...k, unit };
                          void onSave({ kpis: next });
                        }}
                        placeholder="Unit (€, %, …)"
                        className="h-7 text-[11px]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Depending branches */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <LinkIcon className="w-3 h-3" /> Depending branches
              </h3>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">
              Branches whose progress is required for this one. Click any to jump.
            </p>
            {dependingIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {dependingIds.map(id => {
                  const dn = nodeById.get(id);
                  return (
                    <Badge
                      key={id}
                      variant="outline"
                      className="text-[10px] cursor-pointer hover:bg-primary/10 flex items-center gap-1"
                      onClick={() => onJumpToNode(id)}
                    >
                      <span className="font-mono">{id}</span>
                      {dn ? `· ${dn.label}` : ""}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void onSave({ depending_node_ids: dependingIds.filter(x => x !== id) });
                        }}
                        className="text-muted-foreground hover:text-destructive ml-0.5"
                      ><XIcon className="w-2.5 h-2.5" /></button>
                    </Badge>
                  );
                })}
              </div>
            )}
            <select
              className="h-7 text-xs rounded border px-2 bg-background"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                if (dependingIds.includes(id) || id === node.id) {
                  e.target.value = "";
                  return;
                }
                void onSave({ depending_node_ids: [...dependingIds, id] });
                e.target.value = "";
              }}
            >
              <option value="">+ Add dependency…</option>
              {allNodes
                .filter(n => n.id !== node.id && !dependingIds.includes(n.id))
                .map(n => (
                  <option key={n.id} value={n.id}>{n.id} · {n.label}</option>
                ))}
            </select>
          </section>

          {/* Notes */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Notes</h3>
            <Textarea
              defaultValue={data?.notes ?? ""}
              rows={3}
              onBlur={(e) => {
                const notes = e.target.value;
                if (notes === (data?.notes ?? "")) return;
                void onSave({ notes });
              }}
              placeholder="Free-text context, links, decisions…"
              className="text-xs"
            />
          </section>

          {/* AIOS live branch data */}
          {agenticAgent && (
            <section className="border-t pt-4 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" /> AIOS · {agenticAgent.name}
              </h3>

              {/* Top 3 ideas */}
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Lightbulb className="w-3 h-3 text-amber-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Top ideas</span>
                </div>
                {branchIdeas.length === 0 ? (
                  <p className="text-[11px] italic text-muted-foreground">No proposed ideas yet.</p>
                ) : (
                  <div className="space-y-1">
                    {branchIdeas.map(idea => (
                      <div key={idea.id} className="border rounded p-2 bg-amber-50/40 space-y-0.5">
                        <div className="text-xs font-semibold leading-snug">{idea.title}</div>
                        {idea.description && (
                          <p className="text-[11px] text-muted-foreground leading-snug">{idea.description}</p>
                        )}
                        {idea.total_score != null && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">score {idea.total_score}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top 3 open tasks */}
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <ListTodo className="w-3 h-3 text-blue-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Open actions</span>
                </div>
                {branchTasks.length === 0 ? (
                  <p className="text-[11px] italic text-muted-foreground">No open tasks.</p>
                ) : (
                  <div className="space-y-1">
                    {branchTasks.map(task => (
                      <div key={task.id} className="border rounded p-2 bg-blue-50/40 flex items-start justify-between gap-2">
                        <div className="text-xs leading-snug">{task.title}</div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          {task.deadline && (
                            <span className="text-[9px] text-muted-foreground font-mono">{task.deadline}</span>
                          )}
                          {task.approval_level && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1">{task.approval_level}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Tree position */}
          <section className="pt-3 border-t text-[10px] text-muted-foreground">
            <div>Children: {(node.children ?? []).map(c => (
              <button
                key={c.id}
                className="text-primary hover:underline mr-2"
                onClick={() => onJumpToNode(c.id)}
              >{c.id}</button>
            ))}{(node.children ?? []).length === 0 && <span className="italic">none (leaf)</span>}</div>
          </section>
        </div>
      </div>
    </>
  );
}

// ── Approve-hire dialog: pick the parent role, then create org_agents row ──
function ApproveHireDialog({
  target, allRoles, nodeById, onCancel, onConfirm,
}: {
  target: { roleName: string; rationale: string; nodeIds: string[] };
  allRoles: OrgAgent[];
  nodeById: Map<string, OkrNode>;
  onCancel: () => void;
  onConfirm: (parentRoleKey: string) => void;
}) {
  // Default parent: the closest existing owner of the first covered node's
  // ancestor chain. e.g. SDR Lead covers D3 (under C1 → B1 → A1), and
  // C1's primary owner is cco — so default parent = cco.
  const guessParent = (() => {
    for (const id of target.nodeIds) {
      let cur: OkrNode | undefined = nodeById.get(id);
      // Walk up by id-prefix similarity (e.g. D3 → its parent in TREE).
      // Since we don't have parent links in the static tree, we rely on the
      // fact that the first node covered usually has a non-empty owner chain
      // somewhere up. Simpler: if any role contains "sales" / "delivery" /
      // "marketing" matching the role-name keyword, prefer it.
      const lower = target.roleName.toLowerCase();
      if (lower.includes("sdr") || lower.includes("outbound")) {
        const sd = allRoles.find(r => r.role_key === "cco");
        if (sd) return sd.role_key;
      }
      if (lower.includes("partnership")) {
        const ceo = allRoles.find(r => r.role_key === "ceo");
        if (ceo) return ceo.role_key;
      }
      if (lower.includes("account")) {
        const dd = allRoles.find(r => r.role_key === "delivery-director");
        if (dd) return dd.role_key;
      }
      void cur;
    }
    return allRoles.find(r => r.role_key === "ceo")?.role_key ?? "";
  })();

  const [parentRoleKey, setParentRoleKey] = useState<string>(guessParent);

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hire: {target.roleName}</DialogTitle>
          <DialogDescription>{target.rationale}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs">Reports to</Label>
          <select
            value={parentRoleKey}
            onChange={(e) => setParentRoleKey(e.target.value)}
            className="w-full h-9 rounded border px-2 text-sm bg-background"
          >
            {allRoles
              .sort((a, b) => a.sort_order - b.sort_order)
              .map(r => (
                <option key={r.role_key} value={r.role_key}>{r.role_name}{r.person_name ? ` · ${r.person_name}` : ""}</option>
              ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            Creating the role activates an AI agent shell (kind=agent). Add a person + email later in /exec/org-chart.
            Covers tree nodes: {target.nodeIds.join(", ")}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(parentRoleKey)} disabled={!parentRoleKey}>
            <Check className="w-4 h-4 mr-1" /> Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Recursive horizontal renderer ───────────────────────────────────────────
// Each node is a node-box on the left + (if children) a connector group +
// a vertical column of child subtrees on the right. Children are rendered
// with their own ChildArm — the collection of arms forms the L-trunk.

function HorizontalNode({
  node,
  depth,
  byKey,
  onSelectNode,
}: {
  node: OkrNode;
  depth: number;
  byKey: Map<string, OrgAgent>;
  onSelectNode: (id: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <div className="flex items-center">
      <NodeBox node={node} depth={depth} byKey={byKey} onSelectNode={onSelectNode} />
      {hasChildren && (
        <>
          {/* Stub from parent's right edge to the trunk */}
          <div className="w-5 h-px bg-[#3FB6C5] self-center" />
          <div className="flex flex-col gap-2">
            {node.children!.map((c, i, arr) => {
              const pos: ArmPosition = arr.length === 1 ? "only"
                : i === 0 ? "first"
                : i === arr.length - 1 ? "last"
                : "middle";
              return (
                <div key={c.id} className="flex items-stretch">
                  <ChildArm position={pos} />
                  <div className="self-center">
                    <HorizontalNode node={c} depth={depth + 1} byKey={byKey} onSelectNode={onSelectNode} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

type ArmPosition = "first" | "middle" | "last" | "only";

function ChildArm({ position }: { position: ArmPosition }) {
  // The arm is a fixed-width horizontal connector. The "trunk" is drawn
  // as a vertical line on the LEFT of the arm; its top/bottom extent
  // depends on whether this is the first / middle / last child.
  return (
    <div className="relative w-6 self-stretch flex items-center shrink-0">
      {/* Horizontal arm at vertical center */}
      <div className="w-full h-px bg-[#3FB6C5]" />
      {/* Vertical trunk segment */}
      {position !== "only" && (
        <div
          className="absolute left-0 w-px bg-[#3FB6C5]"
          style={{
            top: position === "first" ? "50%" : 0,
            bottom: position === "last" ? "50%" : 0,
          }}
        />
      )}
    </div>
  );
}

function NodeBox({
  node,
  depth,
  byKey,
  onSelectNode,
}: {
  node: OkrNode;
  depth: number;
  byKey: Map<string, OrgAgent>;
  onSelectNode: (id: string) => void;
}) {
  const isMissing = node.ownersRoleKeys.length === 0;
  return (
    <div
      onClick={() => onSelectNode(node.id)}
      className={`shrink-0 rounded border-2 cursor-pointer hover:shadow-md hover:ring-2 hover:ring-primary/40 transition-all ${tierStyle(depth)} flex flex-col`}
      style={{ width: `${tierWidth(depth)}px` }}
    >
      {/* Label */}
      <div className="px-2.5 py-1.5 text-sm leading-tight">
        <span className="font-mono text-[11px] opacity-70 mr-1">{node.id}</span>
        {node.label}
      </div>
      {/* Owners footer — small badges so the box stays compact */}
      <div className="px-2 pb-1.5 flex flex-wrap gap-1 border-t border-current/10 pt-1 text-[9px]">
        {isMissing ? (
          <Badge variant="destructive" className="text-[9px] py-0 px-1.5 flex items-center gap-0.5" title={node.hireSuggestion?.rationale}>
            <AlertTriangle className="w-2.5 h-2.5" />
            HIRE: {node.hireSuggestion?.roleName ?? "TBD"}
          </Badge>
        ) : (
          node.ownersRoleKeys.map((rk, i) => {
            const agent = byKey.get(rk);
            const isPrimary = i === 0;
            if (!agent) {
              return (
                <Badge key={rk} variant="outline" className="text-[9px] py-0 px-1 border-amber-400 text-amber-800 bg-amber-50">
                  {rk}
                </Badge>
              );
            }
            const Icon = agent.kind === "human" ? User : Bot;
            const cls = depth === 0 || depth === 1
              ? "border-white/40 text-white bg-white/10"
              : isPrimary
              ? "border-emerald-400 text-emerald-900 bg-emerald-50"
              : "border-slate-300 text-slate-700 bg-slate-50";
            return (
              <Badge
                key={rk}
                variant="outline"
                className={`text-[9px] py-0 px-1 flex items-center gap-0.5 ${cls}`}
                title={`${agent.role_name}${agent.person_name ? ` · ${agent.person_name}` : ""}`}
              >
                <Icon className="w-2.5 h-2.5" />
                {agent.role_name}
              </Badge>
            );
          })
        )}
      </div>
    </div>
  );
}
