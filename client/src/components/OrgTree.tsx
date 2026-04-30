import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, BookOpen, Plus, Minus } from "lucide-react";

// ─── Public types ─────────────────────────────────────────────────────
export interface OrgTreeNode {
  id: string;
  name: string;
  title: string;
  type: "agent" | "human";
  vacant?: boolean;
  onboarding?: boolean;
  fired?: boolean;
  primaryBossId?: string | null;
  matrixBossIds?: string[];
  knowledgeCount?: number;
  overdueCount?: number;
  highlight?: boolean;
  email?: string;
}

interface OrgTreeProps {
  nodes: OrgTreeNode[];
  peerIds?: string[];
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onOpen: (id: string) => void;
  onAddKnowledge: (id: string) => void;
}

// ─── Layout constants ─────────────────────────────────────────────────
// Compact cards — user wants small tiles that fit on one page.
const CARD_W    = 168;
const CARD_H    = 50;
const COL_GAP   = 38;   // horizontal gap between depth columns (connector travel)
const ROW_GAP   = 8;    // vertical gap between stacked siblings
const COL_STEP  = CARD_W + COL_GAP;
const ROW_STEP  = CARD_H + ROW_GAP;
const PAD_X     = 20;   // left/right canvas padding
const PAD_TOP   = 10;
const PAD_BOT   = 14;
const PEER_GAP  = 44;   // gap between peer card right-edge and root left-edge
const ELBOW_R   = 4;    // rounded corner radius on connector elbows

// ─── Helpers ──────────────────────────────────────────────────────────
function initialsOf(name: string | undefined | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ─── Card component (compact) ─────────────────────────────────────────
function NodeCard({
  node, depth, onOpen, onAddKnowledge,
}: {
  node: OrgTreeNode;
  depth: number;
  onOpen: () => void;
  onAddKnowledge: () => void;
}) {
  const isUpper = depth <= 1;
  const accent = isUpper
    ? { stripe: "bg-sky-500",    name: "text-sky-600",    avatarBg: "bg-sky-100",    avatarFg: "text-sky-700" }
    : { stripe: "bg-orange-500", name: "text-orange-600", avatarBg: "bg-orange-100", avatarFg: "text-orange-700" };

  const headline = node.name?.trim() ? node.name : node.title;
  const sub      = node.name?.trim() ? node.title : "";

  const statusDot =
    node.vacant     ? "bg-red-500"
  : node.onboarding ? "bg-amber-400"
  : node.fired      ? "bg-slate-400"
                    : "";

  return (
    <Card
      onClick={onOpen}
      title={`${headline}${sub ? " · " + sub : ""}`}
      className={`group relative cursor-pointer transition-shadow hover:shadow-md overflow-hidden bg-card border-slate-200 dark:border-slate-700 rounded-md select-none ${
        node.highlight ? "ring-2 ring-sky-300/60" : ""
      }`}
      style={{ width: CARD_W, height: CARD_H }}
    >
      {/* Color stripe */}
      <div className={`absolute inset-x-0 top-0 h-[2px] ${accent.stripe}`} />

      <div className="flex items-center h-full pl-2 pr-6 gap-2 pt-[3px]">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className={`w-7 h-7 rounded-full ${accent.avatarBg} ${accent.avatarFg} flex items-center justify-center font-semibold text-[10px]`}>
            {node.type === "agent" ? <Bot className="w-3.5 h-3.5" /> : initialsOf(node.name)}
          </div>
          {(node.overdueCount ?? 0) > 0 && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-1 ring-card"
              title={`${node.overdueCount} overdue`}
            />
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div
            className={`font-semibold text-[11px] leading-tight ${accent.name}`}
            style={{ display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {headline}
          </div>
          {sub && (
            <div
              className="text-[10px] text-muted-foreground leading-tight mt-px"
              style={{ display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {sub}
            </div>
          )}
          {statusDot && (
            <span className={`inline-block w-1.5 h-1.5 rounded-full mt-0.5 ${statusDot}`} />
          )}
        </div>

        {/* Knowledge button — hover-reveal */}
        <Button
          size="sm" variant="ghost"
          className="absolute top-0.5 right-0.5 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onAddKnowledge(); }}
          title="Add knowledge"
        >
          <BookOpen className="w-2.5 h-2.5" />
          {(node.knowledgeCount ?? 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 text-[7px] bg-primary text-primary-foreground rounded-full w-2.5 h-2.5 flex items-center justify-center font-semibold leading-none">
              {(node.knowledgeCount ?? 0) > 9 ? "9+" : node.knowledgeCount}
            </span>
          )}
        </Button>
      </div>
    </Card>
  );
}

// ─── Layout algorithm ─────────────────────────────────────────────────
// Horizontal dendrogram: X = depth column, Y = vertical stacking.
// Children are one below the other (vertical), parent is horizontally
// centered (vertically centered on its children cluster).
interface LayoutPoint {
  id: string;
  data: OrgTreeNode;
  depth: number;
  x: number;   // left edge of card in canvas coords (before peer offset)
  y: number;   // top edge of card
  parentId: string | null;
}

function computeLayout(
  nodes: OrgTreeNode[],
  collapsedIds: Set<string>,
  excludeIds: Set<string>,
): { points: LayoutPoint[]; width: number; height: number } | null {
  const ROOT_ID = "__virtual_root__";
  const usable  = nodes.filter(n => !excludeIds.has(n.id));
  const byId    = new Map(usable.map(n => [n.id, n]));

  // Walk primary-boss chain; return true if any ancestor is collapsed.
  const isHidden = (id: string): boolean => {
    let cursor: string | null = byId.get(id)?.primaryBossId ?? null;
    let safety = 64;
    while (cursor && safety-- > 0) {
      if (collapsedIds.has(cursor)) return true;
      cursor = byId.get(cursor)?.primaryBossId ?? null;
    }
    return false;
  };

  const visible    = usable.filter(n => !isHidden(n.id));
  if (visible.length === 0) return null;
  const visibleIds = new Set(visible.map(n => n.id));

  // Build tree (manual — no d3.tree needed for this layout).
  interface TNode { id: string; data: OrgTreeNode | null; children: TNode[]; parentId: string | null }
  const tmap = new Map<string, TNode>();
  const vRoot: TNode = { id: ROOT_ID, data: null, children: [], parentId: null };
  tmap.set(ROOT_ID, vRoot);
  for (const n of visible) tmap.set(n.id, { id: n.id, data: n, children: [], parentId: null });

  for (const n of visible) {
    const node = tmap.get(n.id)!;
    const pid  = (n.primaryBossId && visibleIds.has(n.primaryBossId)) ? n.primaryBossId : ROOT_ID;
    node.parentId = pid;
    tmap.get(pid)?.children.push(node);
  }

  // Assign row slots: post-order — leaves get sequential integer slots,
  // non-leaves get the average slot of their first and last child.
  let slotCounter = 0;
  const assignSlots = (node: TNode): number => {
    if (node.children.length === 0) {
      const s = slotCounter++;
      (node as any)._slot = s;
      return s;
    }
    const childSlots = node.children.map(c => assignSlots(c));
    const center = (childSlots[0]! + childSlots[childSlots.length - 1]!) / 2;
    (node as any)._slot = center;
    return center;
  };
  assignSlots(vRoot);

  // Collect layout points (depth-first, skip virtual root).
  const points: LayoutPoint[] = [];
  const collect = (node: TNode, depth: number) => {
    if (node.id === ROOT_ID) {
      for (const c of node.children) collect(c, 0);
      return;
    }
    const slot = (node as any)._slot as number;
    points.push({
      id:       node.id,
      data:     node.data!,
      depth,
      x:        depth * COL_STEP + PAD_X,
      y:        slot  * ROW_STEP + PAD_TOP,
      parentId: node.parentId === ROOT_ID ? null : node.parentId,
    });
    for (const c of node.children) collect(c, depth + 1);
  };
  collect(vRoot, 0);

  if (points.length === 0) return null;

  const maxDepth = Math.max(...points.map(p => p.depth));
  const maxSlot  = Math.max(...points.map(p => (p.y - PAD_TOP) / ROW_STEP));

  const width  = maxDepth * COL_STEP + CARD_W + PAD_X * 2;
  const height = Math.ceil(maxSlot + 1) * ROW_STEP - ROW_GAP + PAD_TOP + PAD_BOT;
  return { points, width, height };
}

// Horizontal elbow: right-center of parent → left-center of child.
// Goes: right → horizontal to midX → curve → vertical → curve → right to child.
function hElbow(px: number, py: number, cx: number, cy: number): string {
  if (Math.abs(cy - py) < 0.5) return `M${px},${py} L${cx},${cy}`;
  const midX = (px + cx) / 2;
  const r    = ELBOW_R;
  const sign = cy > py ? 1 : -1;
  return [
    `M${px},${py}`,
    `L${midX - r},${py}`,
    `Q${midX},${py} ${midX},${py + sign * r}`,
    `L${midX},${cy - sign * r}`,
    `Q${midX},${cy} ${midX + r},${cy}`,
    `L${cx},${cy}`,
  ].join(" ");
}

// ─── Component ────────────────────────────────────────────────────────
export default function OrgTree({
  nodes, peerIds = [], collapsedIds, onToggleCollapse, onOpen, onAddKnowledge,
}: OrgTreeProps) {
  const [zoom, setZoom]       = useState(1);
  const [fitZoom, setFitZoom] = useState(1);   // last auto-fit value; "Fit" button restores this
  const [pan, setPan]         = useState({ x: 0, y: 0 });
  const [isPanning, setIsPan] = useState(false);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const containerRef          = useRef<HTMLDivElement>(null);

  const peerSet  = useMemo(() => new Set(peerIds), [peerIds]);
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const layout = useMemo(
    () => computeLayout(nodes, collapsedIds, peerSet),
    [nodes, collapsedIds, peerSet],
  );

  const hasChildren = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) if (n.primaryBossId) s.add(n.primaryBossId);
    return s;
  }, [nodes]);

  // Auto-fit: scale so the whole chart is visible on first render.
  // Re-runs whenever canvas dimensions change (collapse / expand).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !layout) return;
    // Safari/preview may report 0; fall back to window dimensions.
    const cw = el.clientWidth  || window.innerWidth  || 1200;
    const ch = el.clientHeight || window.innerHeight || 700;

    const peerNodes = peerIds.map(id => nodeById.get(id)).filter(Boolean);
    const peerBand  = peerNodes.length > 0 ? peerNodes.length * (CARD_W + PEER_GAP) : 0;
    const totalW    = layout.width + peerBand;

    const scaleX = cw / totalW;
    const scaleY = ch / layout.height;
    const fit    = Math.max(0.25, Math.min(scaleX, scaleY, 1) * 0.93);
    setFitZoom(fit);
    setZoom(fit);
    setPan({ x: 0, y: 0 });
  }, [layout?.width, layout?.height, peerIds.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!layout) {
    return <div className="text-sm text-muted-foreground italic p-4">No roles to display.</div>;
  }

  const { points, width, height } = layout;

  const peerNodes = peerIds.map(id => nodeById.get(id)).filter((n): n is OrgTreeNode => !!n);
  const peerBand  = peerNodes.length > 0 ? peerNodes.length * (CARD_W + PEER_GAP) : 0;

  // Shallowest node = primary root (CEO). Peers align to its Y.
  const rootPoint = points.reduce((a, b) => a.depth < b.depth ? a : b);

  // All tree cards are offset right by peerBand so peer cards can live on the left.
  const treeOffX = peerBand;

  const canvasW = width  + peerBand;
  const canvasH = height;

  // Point lookup
  const ptById = new Map(points.map(p => [p.id, p]));

  // Edges
  interface Edge { from: LayoutPoint; to: LayoutPoint }
  const primaryEdges: Edge[] = [];
  for (const p of points) {
    if (!p.parentId) continue;
    const parent = ptById.get(p.parentId);
    if (parent) primaryEdges.push({ from: parent, to: p });
  }

  const matrixEdges: Edge[] = [];
  for (const p of points) {
    for (const mid of (p.data.matrixBossIds ?? [])) {
      const mp = ptById.get(mid);
      if (mp) matrixEdges.push({ from: mp, to: p });
    }
  }

  // Anchor helpers — right/left centers of a card
  const rightCX = (p: LayoutPoint) => p.x + treeOffX + CARD_W;
  const leftCX  = (p: LayoutPoint) => p.x + treeOffX;
  const midCY   = (p: LayoutPoint) => p.y + CARD_H / 2;

  // Pan + zoom
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(z => Math.max(0.25, Math.min(2, z + (e.deltaY < 0 ? 0.05 : -0.05))));
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-orgcard='1']") || (e.target as HTMLElement).closest("button")) return;
    setIsPan(true);
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !panStart.current) return;
    setPan({ x: panStart.current.px + (e.clientX - panStart.current.x), y: panStart.current.py + (e.clientY - panStart.current.y) });
  };
  const stopPan = () => { setIsPan(false); panStart.current = null; };
  const resetView = () => { setZoom(fitZoom); setPan({ x: 0, y: 0 }); };

  return (
    <div className="relative">
      {/* Zoom controls */}
      <div className="absolute z-20 right-2 top-2 flex items-center gap-1 bg-background/80 backdrop-blur rounded border border-slate-200 dark:border-slate-700 shadow-sm p-0.5">
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.max(0.25, z - 0.1))} title="Zoom out">
          <Minus className="w-3 h-3" />
        </Button>
        <button
          onClick={resetView}
          className="text-[11px] px-1.5 tabular-nums text-muted-foreground hover:text-foreground"
          title="Reset to fit"
        >
          {zoom === fitZoom ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.min(2, z + 0.1))} title="Zoom in">
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      {/* Canvas container — fixed height so the chart fills the viewport */}
      <div
        ref={containerRef}
        className="overflow-hidden border-y border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/20"
        style={{ height: "calc(100vh - 220px)", cursor: isPanning ? "grabbing" : "grab" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        <div
          style={{
            width:           canvasW,
            height:          canvasH,
            position:        "relative",
            transform:       `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          {/* SVG connector overlay */}
          <svg
            width={canvasW}
            height={canvasH}
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 1 }}
          >
            {/* Solid primary edges */}
            {primaryEdges.map(({ from, to }, i) => (
              <path
                key={`p-${i}`}
                d={hElbow(rightCX(from), midCY(from), leftCX(to), midCY(to))}
                className="stroke-slate-400 dark:stroke-slate-500"
                fill="none"
                strokeWidth={1.5}
              />
            ))}

            {/* Amber dotted matrix edges */}
            {matrixEdges.map(({ from, to }, i) => (
              <path
                key={`m-${i}`}
                d={hElbow(rightCX(from), midCY(from), leftCX(to), midCY(to))}
                className="stroke-amber-500"
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
            ))}

            {/* Dotted horizontal line from each peer's right edge to root's left */}
            {peerNodes.map((peer, i) => {
              const peerRightX = PAD_X + i * (CARD_W + PEER_GAP) + CARD_W;
              const lineY      = rootPoint.y + CARD_H / 2;
              const rootLeftX  = rootPoint.x + treeOffX;
              return (
                <line
                  key={`peer-${peer.id}`}
                  x1={peerRightX} y1={lineY}
                  x2={rootLeftX}  y2={lineY}
                  className="stroke-slate-400 dark:stroke-slate-500"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              );
            })}
          </svg>

          {/* Peer cards — to the left of the root */}
          {peerNodes.map((peer, i) => {
            const x = PAD_X + i * (CARD_W + PEER_GAP);
            const y = rootPoint.y;
            return (
              <div key={peer.id} data-orgcard="1" className="absolute" style={{ left: x, top: y, zIndex: 2 }}>
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
          {points.map(p => (
            <div
              key={p.id}
              data-orgcard="1"
              className="absolute"
              style={{ left: p.x + treeOffX, top: p.y, zIndex: 2 }}
            >
              <NodeCard
                node={{ ...p.data, highlight: p === rootPoint ? true : p.data.highlight }}
                depth={p.depth}
                onOpen={() => onOpen(p.id)}
                onAddKnowledge={() => onAddKnowledge(p.id)}
              />
            </div>
          ))}

          {/* Collapse / expand toggles — sits on the connector to the right
              of each card that has children. */}
          {points
            .filter(p => hasChildren.has(p.id))
            .map(p => {
              const bx = rightCX(p) + 8;  // just past the right edge
              const by = midCY(p);
              const collapsed = collapsedIds.has(p.id);
              return (
                <button
                  key={`tg-${p.id}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse(p.id); }}
                  title={collapsed ? "Expand" : "Collapse"}
                  className="absolute z-10 w-4 h-4 rounded-full bg-card border border-slate-300 flex items-center justify-center hover:border-slate-500 hover:shadow"
                  style={{ left: bx - 8, top: by - 8 }}
                >
                  {collapsed
                    ? <Plus  className="w-2.5 h-2.5 text-slate-600" />
                    : <Minus className="w-2.5 h-2.5 text-slate-600" />}
                </button>
              );
            })}
        </div>
      </div>

      {/* Legend — only shown when there are matrix / peer edges */}
      {(matrixEdges.length > 0 || peerNodes.length > 0) && (
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-1 px-2">
          <div className="flex items-center gap-1.5">
            <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" className="stroke-slate-400" strokeWidth={1.5} /></svg>
            <span>primary boss</span>
          </div>
          {matrixEdges.length > 0 && (
            <div className="flex items-center gap-1.5">
              <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" className="stroke-amber-500" strokeWidth={1.5} strokeDasharray="5 4" /></svg>
              <span>dotted amber = matrix</span>
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
