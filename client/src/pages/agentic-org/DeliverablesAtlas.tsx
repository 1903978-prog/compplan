// Deliverables Atlas — single-page view of every deliverable across all
// 14 AIOS agents, colour-coded by HOW it's produced. Lives under the
// Atlas dropdown.
//
// Design intent (Livio's spec):
//   • Stats bar at the top — total + per-method counts and percentages.
//   • Filter chips by method — click 🔴 to see only Frontier-AI items.
//   • 14 expandable agent groups — each header carries pill counts per
//     method so you can see at a glance where the token spend lives.
//
// The headline takeaway: ~78 % of deliverables don't need Anthropic
// tokens. Click 🔴 Frontier AI to see the exact set that does.

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Cpu, ChevronDown, ChevronRight, Filter, X,
} from "lucide-react";
import {
  ATLAS_DELIVERABLES,
  ATLAS_TOTAL,
  METHOD_INFO,
  METHOD_ORDER,
  countByMethod,
  countAgentByMethod,
  type DeliverableMethod,
  type AgentDeliverables,
} from "./deliverablesAtlasData";

// ─ Method chip — used inline next to each deliverable ───────────────
function MethodChip({ method, count, onClick, active, dense }: {
  method: DeliverableMethod;
  count?: number;
  onClick?: () => void;
  active?: boolean;
  dense?: boolean;
}) {
  const m = METHOD_INFO[method];
  const cls = `inline-flex items-center gap-1 rounded-full border ${m.bg} ${m.text} ${m.border} ${
    dense ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"
  } font-medium ${onClick ? "cursor-pointer hover:opacity-80" : ""} ${
    active ? "ring-2 ring-offset-1 ring-current" : ""
  }`;
  return (
    <span className={cls} onClick={onClick} title={m.desc}>
      <span>{m.emoji}</span>
      <span>{m.label}</span>
      {count !== undefined && <span className="font-semibold tabular-nums">· {count}</span>}
    </span>
  );
}

// ─ Per-agent expandable card ────────────────────────────────────────
function AgentSection({
  agent, filter, defaultOpen,
}: {
  agent: AgentDeliverables;
  filter: DeliverableMethod | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const counts = countAgentByMethod(agent);
  const visible = filter ? agent.items.filter(d => d.method === filter) : agent.items;

  // If a filter is active and this agent has nothing matching, hide.
  if (filter && visible.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
        <span className="font-semibold text-sm">{agent.agent}</span>
        <span className="text-[11px] text-muted-foreground">
          {agent.items.length} deliverables
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {METHOD_ORDER.map(m => counts[m] > 0 && (
            <MethodChip key={m} method={m} count={counts[m]} dense />
          ))}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t bg-background space-y-1.5">
          {visible.map((d, i) => {
            const m = METHOD_INFO[d.method];
            return (
              <div
                key={i}
                className={`flex items-start gap-2 px-2 py-1.5 rounded border ${m.border} ${m.bg} ${d.keyOutput ? "ring-1 ring-current/20" : ""}`}
              >
                <span className="text-[13px] mt-0.5 shrink-0" title={m.desc}>{m.emoji}</span>
                <div className={`flex-1 min-w-0 text-[12px] leading-snug ${d.keyOutput ? "underline underline-offset-2 decoration-current font-semibold" : ""}`}>
                  {d.text}
                </div>
                <span className={`shrink-0 text-[10px] font-medium ${m.text}`} title={m.desc}>
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function DeliverablesAtlas() {
  const totals = useMemo(countByMethod, []);
  const [filter, setFilter] = useState<DeliverableMethod | null>(null);

  const tokenFreeCount =
    totals.micro + totals.deterministic + totals.template + totals.external;
  const tokenFreePct = Math.round((tokenFreeCount / ATLAS_TOTAL) * 100);

  return (
    <div className="container mx-auto pt-2 pb-8 w-full max-w-5xl px-4 md:px-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-primary shrink-0" />
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-tight">Deliverables Atlas</h1>
            <p className="text-[12px] text-muted-foreground leading-snug">
              Every deliverable across all 14 AIOS agents, colour-coded by how it's produced.
              Frontier AI = paid tokens; everything else is free.
            </p>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <Card className="p-3 flex flex-wrap items-stretch gap-3">
        <div className="flex flex-col">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</div>
          <div className="text-2xl font-bold leading-none tabular-nums">{ATLAS_TOTAL}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{ATLAS_DELIVERABLES.length} agents</div>
        </div>

        <div className="hidden sm:block w-px bg-border" />

        <div className="flex-1 min-w-[280px]">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">By production method</div>
          {/* Stacked horizontal bar */}
          <div className="flex h-3 rounded overflow-hidden border border-border">
            {METHOD_ORDER.map(m => {
              const w = (totals[m] / ATLAS_TOTAL) * 100;
              if (w === 0) return null;
              return (
                <div
                  key={m}
                  className={METHOD_INFO[m].dot}
                  style={{ width: `${w}%` }}
                  title={`${METHOD_INFO[m].label}: ${totals[m]} (${Math.round(w)}%)`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px]">
            {METHOD_ORDER.map(m => {
              const pct = Math.round((totals[m] / ATLAS_TOTAL) * 100);
              return (
                <div key={m} className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${METHOD_INFO[m].dot}`} />
                  <span className="text-muted-foreground">{METHOD_INFO[m].label}</span>
                  <span className="font-semibold tabular-nums">{totals[m]}</span>
                  <span className="text-muted-foreground tabular-nums">({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="hidden sm:block w-px bg-border" />

        <div className="flex flex-col justify-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Token-free</div>
          <div className="text-2xl font-bold leading-none tabular-nums text-emerald-600">
            {tokenFreePct}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {tokenFreeCount}/{ATLAS_TOTAL} deliverables don't need Anthropic
          </div>
        </div>
      </Card>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">Filter:</span>
        {METHOD_ORDER.map(m => (
          <MethodChip
            key={m}
            method={m}
            count={totals[m]}
            active={filter === m}
            onClick={() => setFilter(prev => prev === m ? null : m)}
          />
        ))}
        {filter && (
          <Button
            size="sm" variant="ghost" className="h-6 text-[11px] px-2"
            onClick={() => setFilter(null)}
          >
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
        )}
        {filter && (
          <Badge variant="outline" className="text-[10px]">
            Showing only {METHOD_INFO[filter].label} ({totals[filter]} of {ATLAS_TOTAL})
          </Badge>
        )}
      </div>

      {/* Agent groups */}
      <div className="space-y-2">
        {ATLAS_DELIVERABLES.map(a => (
          <AgentSection
            key={a.agent}
            agent={a}
            filter={filter}
            // When a filter is active, default-open every agent so you
            // immediately see all matching items. Otherwise default-open
            // just the CEO group as a starting point.
            defaultOpen={!!filter || a.agent === "CEO"}
          />
        ))}
      </div>
    </div>
  );
}
