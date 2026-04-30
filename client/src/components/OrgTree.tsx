import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { hierarchy, tree as d3tree, stratify, type HierarchyPointNode } from "d3-hierarchy";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, BookOpen, Plus, Minus } from "lucide-react";

// Public types — kept loose so the page can pass its own OrgRole shape in.
export interface OrgTreeNode {
  id: string;                    // role_key — must be unique
  name: string;                  // person name (or "" for vacant)
  title: string;                 // role title (e.g. "Chief Financial Officer")
  type: "agent" | "human";
  vacant?: boolean;
  onboarding?: boolean;
  fired?: boolean;
  primaryBossId?: string | null; // the solid-line parent (null for roots)
  matrixBossIds?: string[];      // dotted-line bosses
  knowledgeCount?: number;
  overdueCount?: number;
  highlight?: boolean;           // ring on top-tier roles
  email?: string;
}

interface OrgTreeProps {
  nodes: OrgTreeNode[];
  // Optional list of node ids that should render side-by-side with the
  // root (governance peers like President / Founder / Chairman / Board).
  // They are excluded from the main tree and drawn to the LEFT of the
  // primary root with a dotted horizontal connector.
  peerIds?: string[];
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onOpen: (id: string) => void;
  onAddKnowledge: (id: string) => void;
}

// Layout constants. CARD_W/CARD_H drive d3.tree's nodeSize plus the SVG
// connector geometry. Increase CARD_W to 260 if titles often exceed 28
// chars; 240 keeps existing visual density.
const CARD_W = 240;
const CARD_H = 88;          // grew from 72 → 88 to fit 2-line titles
const H_GAP = 28;           // min horizontal gap between siblings
const LANE_H = 148;         // CARD_H (88) + 60 connector room
const ELBOW_R = 5;          // rounded corner radius on connector elbows
const CANVAS_PAD_X = 40;    // left/right pad inside the chart area
const CANVAS_PAD_TOP = 16;
const CANVAS_PAD_BOTTOM = 24;
const PEER_GAP = 80;        // horizontal gap between peer cards and root

// ─── Card component ──────────────────────────────────────────────────
function initialsOf(name: string | undefined | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function NodeCard({
  node, depth, onOpen, onAddKnowledge,
}: {
  node: OrgTreeNode;
  depth: number;
  onOpen: () => void;
  onAddKnowledge: () => void;
}) {
  const isUpperTier = depth <= 1;
  const accent = isUpperTier
    ? { stripe: "bg-sky-500",    name: "text-sky-600",    avatarBg: "bg-sky-100",    avatarFg: "text-sky-700" }
    : { stripe: "bg-orange-500", name: "text-orange-600", avatarBg: "bg-orange-100", avatarFg: "text-orange-700" };

  const headline = node.name?.trim() ? node.name : node.title;
  const sub      = node.name?.trim() ? node.title : (node.email || "");

  const statusPip =
    node.vacant     ? "bg-red-500"
  : node.onboarding ? "bg-amber-500"
  : node.fired      ? "bg-slate-500"
                    : "";
  const statusLabel =
    node.vacant     ? "vacant"
  : node.onboarding ? "onboarding"
  : node.fired      ? "fired"
                    : "";

  return (
    <Card
      onClick={onOpen}
      title={`${headline}${sub ? " · " + sub : ""}`}
      className={`group relative cursor-pointer transition-all hover:shadow-md overflow-hidden bg-card border-slate-200 dark:border-slate-700 rounded-md ${
        node.highlight ? "ring-2 ring-sky-300/60" : ""
      }`}
      style={{ width: CARD_W, height: CARD_H }}
    >
      <div className={`absolute inset-x-0 top-0 h-[3px] ${accent.stripe}`} />
      <div className="flex items-center h-full pl-3 pr-3 pt-[6px] pb-1 gap-3">
        <div className="relative shrink-0">
          <div className={`w-12 h-12 rounded-full ${accent.avatarBg} ${accent.avatarFg} flex items-center justify-center font-semibold text-sm`}>
            {node.type === "agent" ? <Bot className="w-5 h-5" /> : initialsOf(node.name)}
          </div>
          {(node.overdueCount ?? 0) > 0 && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 ring-2 ring-card"
              title={`${node.overdueCount} overdue task${node.overdueCount === 1 ? "" : "s"}`}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`font-semibold text-[13px] leading-tight ${accent.name}`}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {headline}
          </div>
          {sub && (
            <div
              className="text-[11px] text-muted-foreground leading-tight mt-0.5"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {sub}
            </div>
          )}
          {statusPip && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusPip}`} />
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{statusLabel}</span>
            </div>
          )}
        </div>
        <Button
          size="sm" variant="ghost"
          className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onAddKnowledge(); }}
          title={`Add knowledge for ${node.title}`}
        >
          <BookOpen className="w-3 h-3" />
          {(node.knowledgeCount ?? 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-primary text-primary-foreground rounded-full w-3 h-3 flex items-center justify-center font-semibold">
              {(node.knowledgeCount ?? 0) > 9 ? "9+" : node.knowledgeCount}
            </span>
          )}
        </Button>
      </div>
    </Card>
  );
}

// ─── Layout core ─────────────────────────────────────────────────────
// Builds a synthetic super-root when multiple primary roots exist
// (defensive — current data has a single CEO root). Returns the
// computed tree with x/y in pixels relative to (0, 0) before padding.
function computeLayout(
  nodes: OrgTreeNode[],
  collapsedIds: Set<string>,
  excludeIds: Set<string>,
): { points: HierarchyPointNode<OrgTreeNode>[]; width: number; height: number } | null {
  const ROOT_ID = "__virtual_root__";
  const usable = nodes.filter(n => !excludeIds.has(n.id));
  const byId = new Map(usable.map(n => [n.id, n]));

  // Detect collapse-shadow: drop any node whose ancestor (via primary boss)
  // is collapsed. Walk up via primary boss; if any ancestor is in
  // collapsedIds, the node is hidden.
  const isHiddenByCollapse = (id: string): boolean => {
    let cursor: string | null = byId.get(id)?.primaryBossId ?? null;
    let safety = 64;
    while (cursor && safety-- > 0) {
      if (collapsedIds.has(cursor)) return true;
      cursor = byId.get(cursor)?.primaryBossId ?? null;
    }
    return false;
  };

  const visible = usable.filter(n => !isHiddenByCollapse(n.id));
  if (visible.length === 0) return null;

  // Re-parent nodes whose primary boss isn't in `visible` (because the
  // boss was excluded as a peer). Those nodes attach to the synthetic root.
  const visibleIds = new Set(visible.map(n => n.id));
  const stratData = visible.map(n => ({
    id: n.id,
    parentId:
      n.primaryBossId && visibleIds.has(n.primaryBossId)
        ? n.primaryBossId
        : ROOT_ID,
    raw: n,
  }));
  // Add the synthetic root.
  stratData.push({ id: ROOT_ID, parentId: null as unknown as string, raw: null as unknown as OrgTreeNode });

  let root;
  try {
    root = stratify<{ id: string; parentId: string; raw: OrgTreeNode }>()
      .id(d => d.id)
      .parentId(d => d.parentId)(stratData);
  } catch (e) {
    // Cyclic or malformed data — bail out gracefully.
    console.warn("[OrgTree] stratify failed", e);
    return null;
  }

  // d3.tree() with nodeSize: spacing in [horizontal-between-siblings, lane-height].
  // We use CARD_W + H_GAP for horizontal so siblings never overlap.
  const layout = d3tree<{ id: string; parentId: string; raw: OrgTreeNode }>()
    .nodeSize([CARD_W + H_GAP, LANE_H])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.15));

  const positioned = layout(root as unknown as ReturnType<typeof hierarchy>) as HierarchyPointNode<{ id: string; parentId: string; raw: OrgTreeNode }>;

  // Filter the synthetic root from output.
  const realPoints = positioned.descendants().filter(p => p.data.id !== ROOT_ID) as unknown as HierarchyPointNode<OrgTreeNode>[];
  // Attach the original OrgTreeNode under .data so consumers don't need
  // the wrapper shape.
  for (const p of realPoints) {
    // d3 stratify output stores our wrapper as data; replace with raw node.
    // But synthetic root's raw was null, already filtered.
    (p as any).data = (p as any).data.raw;
  }

  // Bounds.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of realPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Shift so origin = (0,0).
  for (const p of realPoints) {
    p.x = p.x - minX;
    p.y = p.y - minY;
  }
  const width  = (maxX - minX) + CARD_W;
  const height = (maxY - minY) + CARD_H;
  return { points: realPoints, width, height };
}

// Right-angle elbow path with rounded corner. Goes from parent-bottom
// to child-top via a horizontal segment at the row midline.
function elbowPath(px: number, py: number, cx: number, cy: number): string {
  const midY = (py + cy) / 2;
  const r = ELBOW_R;
  // If the parent and child x are aligned, draw a straight vertical line.
  if (Math.abs(cx - px) < 0.5) {
    return `M${px},${py} L${cx},${cy}`;
  }
  const goingRight = cx > px;
  const r1 = goingRight ? r : -r;
  const r2 = goingRight ? r : -r;
  return [
    `M${px},${py}`,
    `L${px},${midY - r}`,                                // down to before elbow
    `Q${px},${midY} ${px + r1},${midY}`,                  // round corner 1
    `L${cx - r2},${midY}`,                                // horizontal at midline
    `Q${cx},${midY} ${cx},${midY + r}`,                   // round corner 2
    `L${cx},${cy}`,                                       // down to child top
  ].join(" ");
}

// ─── The component ──────────────────────────────────────────────────
export default function OrgTree({
  nodes, peerIds = [], collapsedIds, onToggleCollapse, onOpen, onAddKnowledge,
}: OrgTreeProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const peerSet = useMemo(() => new Set(peerIds), [peerIds]);

  const layout = useMemo(
    () => computeLayout(nodes, collapsedIds, peerSet),
    [nodes, collapsedIds, peerSet],
  );

  // Lookup for peer cards (rendered separately at level 0).
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Identify which IDs in the visible tree have hidden subtrees so we can
  // render a +/− toggle on the connector below them.
  const hasChildren = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) if (n.primaryBossId) set.add(n.primaryBossId);
    return set;
  }, [nodes]);

  if (!layout) {
    return <div className="text-sm text-muted-foreground italic p-4">No roles to display.</div>;
  }

  const { points, width, height } = layout;

  // Find the primary root point — the topmost shallowest non-peer node.
  const rootPoint = points.find(p => p.depth === 1) ?? points[0];

  // Peer band sits at the same Y as the root. Peers are placed to the
  // left of the root, with PEER_GAP between cards. They get a dotted
  // horizontal connector to the root.
  const peerNodes = peerIds
    .map(id => nodeById.get(id))
    .filter((n): n is OrgTreeNode => !!n);

  const peerWidth = peerNodes.length === 0 ? 0 : (peerNodes.length * (CARD_W + PEER_GAP));
  // Total canvas width includes peers band on the left.
  const canvasW = width + peerWidth + CANVAS_PAD_X * 2;
  const canvasH = height + CANVAS_PAD_TOP + CANVAS_PAD_BOTTOM;

  // Translate every tree point by (peerWidth + CANVAS_PAD_X, CANVAS_PAD_TOP).
  const treeOffsetX = peerWidth + CANVAS_PAD_X;
  const treeOffsetY = CANVAS_PAD_TOP;

  // Edges (primary, solid) — every non-root visible node draws an elbow
  // from its parent's bottom edge to its own top edge.
  const primaryEdges: { from: HierarchyPointNode<OrgTreeNode>; to: HierarchyPointNode<OrgTreeNode> }[] = [];
  for (const p of points) {
    if (p.parent && p.parent.data) {
      primaryEdges.push({ from: p.parent, to: p });
    }
  }

  // Matrix edges (dotted, amber) — for any visible node with
  // matrixBossIds, draw a dotted elbow from each matrix-boss bottom to
  // this node's top, but only when the matrix boss is also visible.
  const visiblePointById = new Map(points.map(p => [p.data.id, p]));
  const matrixEdges: { from: HierarchyPointNode<OrgTreeNode>; to: HierarchyPointNode<OrgTreeNode> }[] = [];
  for (const p of points) {
    const mids = p.data.matrixBossIds ?? [];
    for (const mid of mids) {
      const matrixParent = visiblePointById.get(mid);
      if (matrixParent) matrixEdges.push({ from: matrixParent, to: p });
    }
  }

  const cardCenterX = (p: HierarchyPointNode<OrgTreeNode>) => p.x + treeOffsetX + CARD_W / 2;
  const cardTopY    = (p: HierarchyPointNode<OrgTreeNode>) => p.y + treeOffsetY;
  const cardBottomY = (p: HierarchyPointNode<OrgTreeNode>) => p.y + treeOffsetY + CARD_H;

  // Whether the primary root has any matrix edges to peers (typically
  // no — peers are governance, not matrix bosses).
  const showPeerEdge = peerNodes.length > 0;

  // Pan + zoom handlers — middle-click / space-drag to pan (or just
  // drag the empty area), wheel + ctrl/cmd to zoom.
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(z => Math.max(0.5, Math.min(1.6, z + (e.deltaY < 0 ? 0.05 : -0.05))));
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Only pan when the empty canvas (not a card) is dragged.
    if (target.closest("[data-orgcard='1']") || target.closest("button")) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !panStart.current) return;
    setPan({
      x: panStart.current.px + (e.clientX - panStart.current.x),
      y: panStart.current.py + (e.clientY - panStart.current.y),
    });
  };
  const stopPan = () => { setIsPanning(false); panStart.current = null; };

  // Reset pan when zoom changes back to 1 (UX: feels less stuck).
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <div className="relative">
      {/* Zoom controls */}
      <div className="absolute z-20 right-2 top-2 flex items-center gap-1 bg-background/80 backdrop-blur rounded border border-slate-200 dark:border-slate-700 shadow-sm p-0.5">
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} title="Zoom out">
          <Minus className="w-3 h-3" />
        </Button>
        <button onClick={resetView} className="text-[11px] px-1.5 tabular-nums text-muted-foreground hover:text-foreground" title="Reset view">
          {Math.round(zoom * 100)}%
        </button>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.min(1.6, z + 0.1))} title="Zoom in">
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      <div
        ref={containerRef}
        className="overflow-auto pb-6 border-y border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/20"
        style={{ cursor: isPanning ? "grabbing" : "default" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        <div
          style={{
            width: canvasW,
            height: canvasH,
            minWidth: "100%",
            position: "relative",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* SVG connector overlay — primary (solid slate), peer (dotted slate),
              matrix (dotted amber). Lives below the cards in z-order. */}
          <svg
            width={canvasW}
            height={canvasH}
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 1 }}
          >
            {/* Primary edges */}
            {primaryEdges.map(({ from, to }, i) => {
              const px = cardCenterX(from);
              const py = cardBottomY(from);
              const cx = cardCenterX(to);
              const cy = cardTopY(to);
              return (
                <path
                  key={`p-${i}`}
                  d={elbowPath(px, py, cx, cy)}
                  className="stroke-slate-400 dark:stroke-slate-500"
                  fill="none"
                  strokeWidth={1.5}
                />
              );
            })}
            {/* Matrix edges */}
            {matrixEdges.map(({ from, to }, i) => {
              const px = cardCenterX(from);
              const py = cardBottomY(from);
              const cx = cardCenterX(to);
              const cy = cardTopY(to);
              return (
                <path
                  key={`m-${i}`}
                  d={elbowPath(px, py, cx, cy)}
                  className="stroke-amber-500"
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              );
            })}
            {/* Peer connector — horizontal dotted line from each peer
                card's right-mid to the root card's left-mid. */}
            {showPeerEdge && peerNodes.map((peer, i) => {
              const peerCenterX = CANVAS_PAD_X + i * (CARD_W + PEER_GAP) + CARD_W; // right edge
              const peerCenterY = treeOffsetY + (rootPoint.y) + CARD_H / 2;
              const rootLeftX  = cardCenterX(rootPoint) - CARD_W / 2;
              return (
                <line
                  key={`peer-${peer.id}`}
                  x1={peerCenterX}
                  y1={peerCenterY}
                  x2={rootLeftX}
                  y2={peerCenterY}
                  className="stroke-slate-400 dark:stroke-slate-500"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              );
            })}
          </svg>

          {/* Peer cards — to the left of the primary root. */}
          {peerNodes.map((peer, i) => {
            const x = CANVAS_PAD_X + i * (CARD_W + PEER_GAP);
            const y = treeOffsetY + rootPoint.y;
            return (
              <div
                key={peer.id}
                data-orgcard="1"
                className="absolute"
                style={{ left: x, top: y, zIndex: 2 }}
              >
                <NodeCard
                  node={{ ...peer, highlight: true }}
                  depth={0}
                  onOpen={() => onOpen(peer.id)}
                  onAddKnowledge={() => onAddKnowledge(peer.id)}
                />
              </div>
            );
          })}

          {/* Tree cards */}
          {points.map(p => {
            const x = p.x + treeOffsetX;
            const y = p.y + treeOffsetY;
            const isRoot = p === rootPoint;
            return (
              <div
                key={p.data.id}
                data-orgcard="1"
                className="absolute"
                style={{ left: x, top: y, zIndex: 2 }}
              >
                <NodeCard
                  node={{ ...p.data, highlight: isRoot ? true : p.data.highlight }}
                  depth={p.depth - 1 < 0 ? 0 : p.depth - 1}
                  onOpen={() => onOpen(p.data.id)}
                  onAddKnowledge={() => onAddKnowledge(p.data.id)}
                />
              </div>
            );
          })}

          {/* Collapse / expand toggles — small ± button on the connector
              just below each card that has children (whether shown or
              hidden by collapse). */}
          {points
            .filter(p => hasChildren.has(p.data.id))
            .map(p => {
              const cx = cardCenterX(p);
              const cy = cardBottomY(p) + 10;
              const collapsed = collapsedIds.has(p.data.id);
              return (
                <button
                  key={`tg-${p.data.id}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse(p.data.id); }}
                  title={collapsed ? "Expand reports" : "Collapse reports"}
                  className="absolute z-10 w-4 h-4 rounded-full bg-card border border-slate-300 flex items-center justify-center hover:border-slate-500 hover:shadow"
                  style={{ left: cx - 8, top: cy - 8 }}
                >
                  {collapsed
                    ? <Plus className="w-2.5 h-2.5 text-slate-600" />
                    : <Minus className="w-2.5 h-2.5 text-slate-600" />}
                </button>
              );
            })}
        </div>
      </div>

      {/* Legend — describes connector semantics. Shown only when at least
          one matrix or peer relationship exists, so the legend never
          overpromises. */}
      {(matrixEdges.length > 0 || peerNodes.length > 0) && (
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-2 px-2">
          <div className="flex items-center gap-1.5">
            <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" className="stroke-slate-400" strokeWidth={1.5} /></svg>
            <span>solid = primary boss</span>
          </div>
          {matrixEdges.length > 0 && (
            <div className="flex items-center gap-1.5">
              <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" className="stroke-amber-500" strokeWidth={1.5} strokeDasharray="5 4" /></svg>
              <span>dotted amber = matrix / dotted-line</span>
            </div>
          )}
          {peerNodes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" className="stroke-slate-400" strokeWidth={1.5} strokeDasharray="5 4" /></svg>
              <span>dotted = governance peer</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
