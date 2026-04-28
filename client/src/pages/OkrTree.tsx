import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, UserPlus, AlertTriangle, Bot, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
                rationale: "Sales Director is consumed by proposal + close work. A dedicated SDR Lead owns outbound volume, ICP list-building, sequencing, and the send-cadence.",
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
                rationale: "Channel partners (PE funds, complementary firms, ex-MBB Partners) compound outbound 3-5×. Today nobody owns the partnership pipeline.",
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
        { id: "C11", label: "Scope control",       ownersRoleKeys: ["delivery-director", "sales-director"] },
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

export default function OkrTree() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<OrgAgent[]>([]);
  const [loading, setLoading] = useState(true);

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

      {/* Tree canvas — horizontal recursive layout with L-shaped connectors */}
      <Card className="p-6 overflow-x-auto bg-white">
        {/* Horizontal divider line under header — same teal as slide */}
        <div className="h-px bg-[#1A6571] mb-6" />
        <div className="inline-block min-w-full">
          <HorizontalNode node={TREE} depth={0} byKey={byKey} />
        </div>
      </Card>
    </div>
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
}: {
  node: OkrNode;
  depth: number;
  byKey: Map<string, OrgAgent>;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <div className="flex items-center">
      <NodeBox node={node} depth={depth} byKey={byKey} />
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
                    <HorizontalNode node={c} depth={depth + 1} byKey={byKey} />
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
}: {
  node: OkrNode;
  depth: number;
  byKey: Map<string, OrgAgent>;
}) {
  const isMissing = node.ownersRoleKeys.length === 0;
  return (
    <div
      className={`shrink-0 rounded border-2 ${tierStyle(depth)} flex flex-col`}
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
