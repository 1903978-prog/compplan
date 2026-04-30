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
// Vertical top-down dendrogram: X = sibling slot, Y = depth.
const CARD_W    = 168;
const CARD_H    = 50;
const COL_GAP   = 16;    // horizontal gap between sibling cards
const ROW_GAP   = 52;    // vertical gap between depth levels (connector travel)
const COL_STEP  = CARD_W + COL_GAP;   // horizontal step per sibling slot
const ROW_STEP  = CARD_H + ROW_GAP;   // vertical step per depth level
const PAD_X     = 20;
const PAD_TOP   = 10;
const PAD_BOT   = 14;
const PEER_GAP  = 20;    // vertical gap between peer card and root top
const ELBOW_R   = 4;

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
// Vertical top-down dendrogram: X = sibling slot (horizontal spread),
// Y = depth (increases downward). Parent is horizontally centered over
// its children cluster. Same slot-assignment logic as before — leaves get
// sequential integer slots, parents get the average of first/last child.
interface LayoutPoint {
  id: string;
  data: OrgTreeNode;
  depth: number;
  x: number;   // left edge of card
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

  // Post-order slot assignment: leaves → sequential int, parents → midpoint of children.
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
      x:        slot  * COL_STEP + PAD_X,   // slot → horizontal
      y:        depth * ROW_STEP + PAD_TOP,  // depth → vertical
      parentId: node.parentId === ROOT_ID ? null : node.parentId,
    });
    for (const c of node.children) collect(c, depth + 1);
  };
  collect(vRoot, 0);

  if (points.length === 0) return null;

  const maxDepth = Math.max(...points.map(p => p.depth));
  const maxSlot  = Math.max(...points.map(p => (p.x - PAD_X) / COL_STEP));

  const width  = maxSlot * COL_STEP + CARD_W + PAD_X * 2;
  const height = maxDepth * ROW_STEP + CARD_H + PAD_TOP + PAD_BOT;
  return { points, width, height };
}

// Vertical elbow: bottom-center of parent → top-center of child.
// Goes: down → horizontal midY → elbows → down to child top.
function vElbow(px: number, py: number, cx: number, cy: number): string {
  if (Math.abs(cx - px) < 0.5) return `M${px},${py} L${cx},${cy}`;
  const midY = (py + cy) / 2;
  const r    = ELBOW_R;
  const sign = cx > px ? 1 : -1;
  return [
    `M${px},${py}`,
    `L${px},${midY - r}`,
    `Q${px},${midY} ${px + sign * r},${midY}`,
    `L${cx - sign * r},${midY}`,
    `Q${cx},${midY} ${cx},${midY + r}`,
    `L${cx},${cy}`,
  ].join(" ");
}

// ─── Component ────────────────────────────────────────────────────────
export default function OrgTree({
  nodes, peerIds = [], collapsedIds, onToggleCollapse, onOpen, onAddKnowledge,
}: OrgTreeProps) {
  const [zoom, setZoom]       = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [pan, setPan]         = useState({ x: 0, y: 0 });
  const [isPanning, setIsPan] = useState(false);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const containerRef           = useRef<HTMLDivElement>(null);

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

  // Auto-fit on first render and whenever canvas changes.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !layout) return;
    const cw = el.clientWidth  || window.innerWidth  || 1200;
    const ch = el.clientHeight || window.innerHeight || 700;

    const peerNodes = peerIds.map(id => nodeById.get(id)).filter(Boolean);
    // Peers stack vertically above root; total height adds their band.
    const peerBand = peerNodes.length > 0 ? peerNodes.length * (CARD_H + PEER_GAP) : 0;
    const totalH   = layout.height + peerBand;

    const scaleX = cw / layout.width;
    const scaleY = ch / totalH;
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
  // Peers sit ABOVE the tree — add their height to the top.
  const peerBand  = peerNodes.length > 0 ? peerNodes.length * (CARD_H + PEER_GAP) : 0;

  // Shallowest node = primary root (CEO).
  const rootPoint = points.reduce((a, b) => a.depth < b.depth ? a : b);

  // All tree cards are offset DOWN by peerBand so peer cards live above them.
  const treeOffY = peerBand;

  const canvasW = width;
  const canvasH = height + peerBand;

  const ptById = new Map(points.map(p => [p.id, p]));

  // Anchor helpers — bottom/top centers, adjusted for treeOffY.
  const midCX = (p: LayoutPoint) => p.x + CARD_W / 2;
  const topCY = (p: LayoutPoint) => p.y + treeOffY;
  const botCY = (p: LayoutPoint) => p.y + treeOffY + CARD_H;

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

      {/* Canvas container */}
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
            {/* Solid primary edges — vertical elbow connectors */}
            {primaryEdges.map(({ from, to }, i) => (
              <path
                key={`p-${i}`}
                d={vElbow(midCX(from), botCY(from), midCX(to), topCY(to))}
                className="stroke-slate-400 dark:stroke-slate-500"
                fill="none"
                strokeWidth={1.5}
              />
            ))}

            {/* Amber dotted matrix edges */}
            {matrixEdges.map(({ from, to }, i) => (
              <path
                key={`m-${i}`}
                d={vElbow(midCX(from), botCY(from), midCX(to), topCY(to))}
                className="stroke-amber-500"
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
            ))}

            {/* Dashed vertical line from each peer's bottom-center to root's top-center */}
            {peerNodes.map((peer, i) => {
              const peerCenterX = rootPoint.x + CARD_W / 2;
              const peerBottomY = PAD_TOP + i * (CARD_H + PEER_GAP) + CARD_H;
              const rootTopY    = rootPoint.y + treeOffY;
              return (
                <line
                  key={`peer-${peer.id}`}
                  x1={peerCenterX} y1={peerBottomY}
                  x2={peerCenterX} y2={rootTopY}
                  className="stroke-slate-400 dark:stroke-slate-500"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              );
            })}
          </svg>

          {/* Peer cards — stacked ABOVE the root, horizontally aligned with root */}
          {peerNodes.map((peer, i) => {
            const x = rootPoint.x;
            const y = PAD_TOP + i * (CARD_H + PEER_GAP);
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

          {/* Tree cards — shifted down by treeOffY */}
          {points.map(p => (
            <div
              key={p.id}
              data-orgcard="1"
              className="absolute"
              style={{ left: p.x, top: p.y + treeOffY, zIndex: 2 }}
            >
              <NodeCard
                node={{ ...p.data, highlight: p === rootPoint ? true : p.data.highlight }}
                depth={p.depth}
                onOpen={() => onOpen(p.id)}
                onAddKnowledge={() => onAddKnowledge(p.id)}
              />
            </div>
          ))}

          {/* Collapse / expand toggles — centered below each card that has children */}
          {points
            .filter(p => hasChildren.has(p.id))
            .map(p => {
              const bx = midCX(p) - 8;   // center the 16px circle at card's horizontal center
              const by = botCY(p) + 2;   // just below bottom edge of card
              const collapsed = collapsedIds.has(p.id);
              return (
                <button
                  key={`tg-${p.id}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse(p.id); }}
                  title={collapsed ? "Expand" : "Collapse"}
                  className="absolute z-10 w-4 h-4 rounded-full bg-card border border-slate-300 flex items-center justify-center hover:border-slate-500 hover:shadow"
                  style={{ left: bx, top: by }}
                >
                  {collapsed
                    ? <Plus  className="w-2.5 h-2.5 text-slate-600" />
                    : <Minus className="w-2.5 h-2.5 text-slate-600" />}
                </button>
              );
            })}
        </div>
      </div>

      {/* Legend */}
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
