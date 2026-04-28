import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, UserPlus, AlertTriangle, ChevronRight, ChevronDown, Bot, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── EBITDA Growth Driver Tree ────────────────────────────────────────────────
// Static issue tree from the EBITDA Growth Strategy doc. Each node lists the
// role(s) owning that branch by role_key (matches org_agents.role_key in DB).
// When NO existing role fits a branch, set ownersRoleKeys = [] AND populate
// hireSuggestion — the page renders a red "Hire suggested" callout the CEO
// can act on.
//
// Agent assignment principle: each branch points to the role whose objective
// function most directly drives that node. A node can have 1 primary owner
// + N supporting owners (we list primary first; UI badges them in colour).
//
// To rewire ownership: edit the TREE constant below + push. The org chart
// still drives goals/OKRs/tasks — this page is a structural map of WHO
// works on WHAT to grow EBITDA, not an OKR replacement.

interface OkrNode {
  id: string;
  label: string;
  ownersRoleKeys: string[];                                // [] = nobody → hire
  hireSuggestion?: { roleName: string; rationale: string };
  children?: OkrNode[];
}

const TREE: OkrNode = {
  id: "A1", label: "Increase EBITDA",
  ownersRoleKeys: ["ceo"],
  children: [
    {
      id: "B1", label: "Increase proposals sold",
      ownersRoleKeys: ["sales-director"],
      children: [
        {
          id: "C1", label: "Generate more leads",
          ownersRoleKeys: ["marketing-manager", "sales-director"],
          children: [
            { id: "D1", label: "Reconnect past clients", ownersRoleKeys: ["sales-director"] },
            {
              id: "D2", label: "Increase media exposure",
              ownersRoleKeys: ["marketing-manager"],
              children: [
                { id: "E1", label: "LinkedIn",          ownersRoleKeys: ["marketing-manager"] },
                { id: "E2", label: "Website",           ownersRoleKeys: ["marketing-manager"] },
                { id: "E3", label: "Medium / Substack", ownersRoleKeys: ["marketing-manager"] },
                { id: "E4", label: "PR / press releases", ownersRoleKeys: ["marketing-manager"] },
                { id: "E5", label: "Articles in press", ownersRoleKeys: ["marketing-manager"] },
                { id: "E6", label: "Top-tier mentions", ownersRoleKeys: ["marketing-manager"] },
              ],
            },
            {
              id: "D3", label: "Send more cold emails",
              ownersRoleKeys: [],     // no SDR / outbound lead today
              hireSuggestion: {
                roleName: "SDR Lead (Outbound)",
                rationale: "Sales Director is consumed by proposal + close work. A dedicated SDR Lead owns outbound volume, ICP list-building, sequencing, and the send-cadence — frees Sales Director to focus on conversion + close.",
              },
              children: [
                { id: "E7", label: "More ICP volume",    ownersRoleKeys: [], hireSuggestion: { roleName: "SDR Lead (Outbound)", rationale: "Owns ICP list growth + targeting." } },
                { id: "E8", label: "Better email hooks", ownersRoleKeys: ["marketing-manager"] },
                { id: "E9", label: "Higher conversion",  ownersRoleKeys: ["sales-director"] },
              ],
            },
            {
              id: "D4", label: "Add more partners",
              ownersRoleKeys: [],
              hireSuggestion: {
                roleName: "Head of Partnerships",
                rationale: "Channel partners (PE funds, complementary firms, ex-MBB Partners) compound outbound 3-5×. Today nobody owns the partnership pipeline — CEO does it ad-hoc. Hire when ≥3 active partners need management.",
              },
            },
          ],
        },
        {
          id: "C2", label: "Generate more pitches",
          ownersRoleKeys: ["sales-director"],
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
          ownersRoleKeys: ["sales-director"],
          children: [
            { id: "D6", label: "Better proposals", ownersRoleKeys: ["sales-director", "pricing-director"] },
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
          hireSuggestion: {
            roleName: "Head of Accounts",
            rationale: "Upsell on existing engagements is a Delivery Director side-hustle today — nobody owns 'expand the SOW' as a primary KPI. Head of Accounts owns NRR, expansion bookings, and the cross-sell motion across the won-portfolio.",
          },
        },
        {
          id: "C5", label: "Increase cross-sell",
          ownersRoleKeys: [],
          hireSuggestion: {
            roleName: "Head of Accounts",
            rationale: "Same role as upsell — bundle them under one accountable owner.",
          },
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
            { id: "D9",  label: "Hiring process",    ownersRoleKeys: ["hiring-manager"] },
            { id: "D10", label: "Attractive EVP",    ownersRoleKeys: ["hiring-manager", "marketing-manager"] },
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
        { id: "C11", label: "Scope control",       ownersRoleKeys: ["delivery-director", "sales-director"] },
      ],
    },
  ],
};

// ── Render ────────────────────────────────────────────────────────────────
type OrgAgent = {
  id: number;
  role_key: string;
  role_name: string;
  person_name: string | null;
  status: string;
  kind: "agent" | "human";
};

function flattenIds(n: OkrNode, acc: string[] = []): string[] {
  acc.push(n.id);
  for (const c of n.children ?? []) flattenIds(c, acc);
  return acc;
}

export default function OkrTree() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<OrgAgent[]>([]);
  const [loading, setLoading] = useState(true);
  // Default: collapse E-level (the leafiest) so the tree is scannable;
  // user can drill in by clicking any branch.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const all = new Set(flattenIds(TREE));
    // Auto-collapse E-level nodes (those whose ID starts with E)
    for (const id of Array.from(all)) if (id.startsWith("E")) all.delete(id);
    return all;
  });

  useEffect(() => {
    fetch("/api/org-chart", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: OrgAgent[]) => {
        setAgents(Array.isArray(rows) ? rows : []);
        setLoading(false);
      })
      .catch(() => { toast({ title: "Failed to load org chart", variant: "destructive" }); setLoading(false); });
  }, [toast]);

  const byKey = useMemo(() => {
    const m = new Map<string, OrgAgent>();
    for (const a of agents) m.set(a.role_key, a);
    return m;
  }, [agents]);

  // List all distinct hire suggestions in the tree (deduped by roleName)
  // for the summary card at the top.
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
    return Array.from(seen.values());
  }, []);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading OKR tree…</div>;
  }

  return (
    <div className="container mx-auto py-6 max-w-[1400px] space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Target className="w-7 h-7 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">OKR — EBITDA Growth Driver Tree</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Single root metric (Increase EBITDA) decomposed into the 4 levers, then into actionable sub-drivers down to the leaves. Each branch shows the agent(s) accountable for moving it. Branches with no owner are tagged <Badge variant="destructive" className="text-[9px] py-0 px-1.5 mx-0.5">Hire</Badge> with a suggested role.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setExpanded(new Set(flattenIds(TREE)))}>Expand all</Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded(new Set([TREE.id]))}>Collapse all</Button>
        </div>
      </div>

      {/* Hire-suggestions summary */}
      {hireSuggestions.length > 0 && (
        <Card className="p-4 border-red-200 bg-red-50/30">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-bold text-red-900">Hires needed to fully cover the tree ({hireSuggestions.length})</h2>
          </div>
          <div className="space-y-2">
            {hireSuggestions.map(h => (
              <div key={h.roleName} className="text-xs flex items-start gap-2">
                <Badge variant="destructive" className="shrink-0">{h.roleName}</Badge>
                <span className="text-muted-foreground">
                  {h.rationale} <span className="text-[10px] italic">Covers nodes: {h.nodeIds.join(", ")}.</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tree */}
      <Card className="p-4">
        <TreeNode node={TREE} depth={0} byKey={byKey} expanded={expanded} toggle={toggle} />
      </Card>
    </div>
  );
}

// ── Recursive node renderer ────────────────────────────────────────────────
// Indentation by depth + caret toggle. Each owner becomes a coloured badge;
// missing-owner branches show the Hire callout inline.

function TreeNode({
  node,
  depth,
  byKey,
  expanded,
  toggle,
}: {
  node: OkrNode;
  depth: number;
  byKey: Map<string, OrgAgent>;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);
  const isMissing = node.ownersRoleKeys.length === 0;
  return (
    <div>
      <div
        className={`flex items-start gap-2 py-1.5 ${depth === 0 ? "pl-0" : ""}`}
        style={{ paddingLeft: `${depth * 20}px` }}
      >
        {/* Toggle */}
        {hasChildren ? (
          <button
            onClick={() => toggle(node.id)}
            className="mt-0.5 text-muted-foreground hover:text-foreground"
            title={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 h-3.5 inline-block" />
        )}

        {/* Node label box — tier colour by ID prefix */}
        <div
          className={`px-2.5 py-1 rounded font-medium text-sm border ${
            depth === 0
              ? "bg-primary text-primary-foreground border-primary font-bold"
              : depth === 1
              ? "bg-cyan-100 text-cyan-900 border-cyan-300 font-semibold"
              : depth === 2
              ? "bg-cyan-50 text-cyan-900 border-cyan-200"
              : depth === 3
              ? "bg-slate-50 text-slate-800 border-slate-200 text-[13px]"
              : "bg-white text-slate-700 border-slate-200 text-xs"
          }`}
        >
          <span className="font-mono opacity-80 mr-1.5">{node.id}</span>
          {node.label}
        </div>

        {/* Owners or Hire suggestion */}
        <div className="flex flex-wrap items-center gap-1 ml-1">
          {isMissing ? (
            <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Hire: {node.hireSuggestion?.roleName ?? "TBD"}
            </Badge>
          ) : (
            node.ownersRoleKeys.map((rk, i) => {
              const agent = byKey.get(rk);
              const isPrimary = i === 0;
              if (!agent) {
                return (
                  <Badge key={rk} variant="outline" className="text-[10px] border-amber-400 text-amber-800 bg-amber-50">
                    {rk} <span className="opacity-60">· not in org</span>
                  </Badge>
                );
              }
              const Icon = agent.kind === "human" ? User : Bot;
              return (
                <Badge
                  key={rk}
                  variant="outline"
                  className={`text-[10px] flex items-center gap-1 ${
                    isPrimary
                      ? "border-emerald-400 text-emerald-800 bg-emerald-50"
                      : "border-slate-300 text-slate-700 bg-slate-50"
                  }`}
                  title={`${agent.role_name}${agent.person_name ? ` · ${agent.person_name}` : ""}`}
                >
                  <Icon className="w-2.5 h-2.5" />
                  {agent.role_name}
                  {agent.person_name && <span className="opacity-70">· {agent.person_name.split(" ")[0]}</span>}
                </Badge>
              );
            })
          )}
        </div>
      </div>

      {/* Hire rationale tooltip-style block — only at the parent level when
          a missing-owner branch is collapsed; expanded reveals the same
          content at the right depth. */}
      {isMissing && node.hireSuggestion && isOpen === false && hasChildren === false && (
        <div className="text-[10px] text-muted-foreground italic" style={{ paddingLeft: `${depth * 20 + 30}px` }}>
          {node.hireSuggestion.rationale}
        </div>
      )}

      {/* Children */}
      {hasChildren && isOpen && (
        <div>
          {node.children!.map(c => (
            <TreeNode key={c.id} node={c} depth={depth + 1} byKey={byKey} expanded={expanded} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}
