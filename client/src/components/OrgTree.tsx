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
// TOP-DOWN INDENTED TREE (file-explorer style) — IMMUTABLE.
// Per CLAUDE.md rule 10: each child must be BELOW its parent. Direct-
// reports groups stack vertically as a column, never horizontally.
//   • X = depth * INDENT_X + PAD_X        (deeper = small right indent)
//   • Y = rowCounter * Y_STEP + PAD_TOP   (DFS pre-order assigns rows)
// Every visible node occupies one row; siblings appear in successive
// rows below the parent, indented by a fixed step. Vertical bracket
// connector emerges from each parent's bottom and turns right into
// each child's left edge — the classic file-explorer tree.
const CARD_W   = 200;
const CARD_H   = 72;
const INDENT_X = 32;          // horizontal indent per depth level
const V_GAP    = 12;          // vertical gap between successive rows
const Y_STEP   = CARD_H + V_GAP;  // 84 px per row
const PAD_X    = 20;
const PAD_TOP  = 14;
const PAD_BOT  = 28;
const PEER_GAP = 18;          // above-root vertical gap for peer cards
const ELBOW_R  = 5;

// ─── Helpers ──────────────────────────────────────────────────────────
function initialsOf(name: string | undefined | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ─── Card component ───────────────────────────────────────────────────
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

  // Role title is the headline (CFO, COO, etc.); person name is the
  // smaller grey sub-line below. Falls back to person-name as headline
  // for nodes that have no role title.
  const headline = node.title?.trim() ? node.title : (node.name ?? "");
  const sub      = node.title?.trim() && node.name?.trim() ? node.name : "";

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
      {/* Top accent stripe */}
      <div className={`absolute inset-x-0 top-0 h-[3px] ${accent.stripe}`} />

      <div className="flex items-center h-full pl-3 pr-8 gap-2.5 pt-[5px]">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className={`w-10 h-10 rounded-full ${accent.avatarBg} ${accent.avatarFg} flex items-center justify-center font-semibold text-[12px]`}>
            {node.type === "agent" ? <Bot className="w-5 h-5" /> : initialsOf(node.name)}
          </div>
          {(node.overdueCount ?? 0) > 0 && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-card"
              title={`${node.overdueCount} overdue`}
            />
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div
            className={`font-semibold text-[13px] leading-snug ${accent.name}`}
            style={{ display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {headline}
          </div>
          {sub && (
            <div
              className="text-[11px] text-muted-foreground leading-tight mt-0.5"
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
          className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onAddKnowledge(); }}
          title="Add knowledge"
        >
          <BookOpen className="w-3 h-3" />
          {(node.knowledgeCount ?? 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 text-[7px] bg-primary text-primary-foreground rounded-full w-3 h-3 flex items-center justify-center font-semibold leading-none">
              {(node.knowledgeCount ?? 0) > 9 ? "9+" : node.knowledgeCount}
            </span>
          )}
        </Button>
      </div>
    </Card>
  );
}

// ─── Layout algorithm ─────────────────────────────────────────────────
// TOP-DOWN INDENTED TREE — DFS pre-order assigns each node its own row.
//   • X = depth * INDENT_X + PAD_X
//   • Y = rowCounter * Y_STEP + PAD_TOP
// Children always appear BELOW their parent (greater Y) and indented
// to the right (greater X). Siblings stack vertically as a column.
interface LayoutPoint {
  id: string;
  data: OrgTreeNode;
  depth: number;
  x: number;   // left edge of card
  y: number;   // top edge of card
  cx: number;  // centre-x of card
  cy: number;  // centre-y of card
  parentId: string | null;
}

interface TNode {
  id: string;
  data: OrgTreeNode | null;
  children: TNode[];
  parentId: string | null;
  _depth: number;
}

function computeLayout(
  nodes: OrgTreeNode[],
  collapsedIds: Set<string>,
  excludeIds: Set<string>,
): { points: LayoutPoint[]; width: number; height: number; maxDepth: number } | null {
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

  // Per CLAUDE.md rule 10: every child sits BELOW its parent, vertically.
  // Even nodes whose only relationship is dotted (matrixBossIds, no
  // primaryBossId) are positioned as a child of their dotted boss in the
  // tree — they just render with a dashed bracket connector instead of
  // a solid one. NEVER place a node to the right of its boss.
  const tmap = new Map<string, TNode>();
  const vRoot: TNode = { id: ROOT_ID, data: null, children: [], parentId: null, _depth: 0 };
  tmap.set(ROOT_ID, vRoot);
  for (const n of visible) {
    tmap.set(n.id, { id: n.id, data: n, children: [], parentId: null, _depth: 0 });
  }

  for (const n of visible) {
    const node = tmap.get(n.id)!;
    let pid: string = ROOT_ID;
    if (n.primaryBossId && visibleIds.has(n.primaryBossId)) {
      pid = n.primaryBossId;
    } else if (!n.primaryBossId && (n.matrixBossIds?.length ?? 0) > 0) {
      // Dotted-only — fall back to first matrix boss for positioning.
      const db = n.matrixBossIds!.find(id => visibleIds.has(id));
      if (db) pid = db;
    }
    node.parentId = pid;
    tmap.get(pid)?.children.push(node);
  }

  // DFS pre-order: each node gets its own row, in the order it's visited.
  // Parent visited before children → parent.y < first-child.y.
  // Sibling subtrees stack: child[i+1].y is below child[i]'s entire subtree.
  const points: LayoutPoint[] = [];
  let rowCounter = 0;
  let maxDepth   = 0;

  const collect = (n: TNode, depth: number) => {
    if (n.id === ROOT_ID) {
      n._depth = -1;
      for (const c of n.children) collect(c, 0);
      return;
    }
    n._depth = depth;
    if (depth > maxDepth) maxDepth = depth;

    const px = depth * INDENT_X + PAD_X;
    const py = rowCounter * Y_STEP + PAD_TOP;
    rowCounter++;

    points.push({
      id:       n.id,
      data:     n.data!,
      depth,
      x:        px,
      y:        py,
      cx:       px + CARD_W / 2,
      cy:       py + CARD_H / 2,
      parentId: n.parentId === ROOT_ID ? null : n.parentId,
    });
    for (const c of n.children) collect(c, depth + 1);
  };
  collect(vRoot, 0);

  if (points.length === 0) return null;

  // Canvas size — width = deepest column + card width; height = total
  // visible row count.
  let maxRight = maxDepth * INDENT_X + CARD_W + PAD_X;
  for (const p of points) {
    const r = p.x + CARD_W;
    if (r > maxRight) maxRight = r;
  }
  const width  = maxRight + PAD_X;
  const height = rowCounter * Y_STEP - V_GAP + PAD_TOP + PAD_BOT;

  return { points, width, height, maxDepth };
}

// Indented-tree bracket: from parent's bottom (at the bracket-X column)
// straight DOWN, then turn RIGHT at child's mid-Y into the child's left
// edge. The vertical line gets re-drawn for each child but they overlap
// to look like a single bracket — classic file-explorer connector.
function vBracket(brkX: number, py: number, clx: number, cy: number): string {
  const r = ELBOW_R;
  if (Math.abs(clx - brkX) < r) {
    return `M${brkX},${py} V${cy}`;
  }
  return [
    `M${brkX},${py}`,
    `V${cy - r}`,
    `Q${brkX},${cy} ${brkX + r},${cy}`,
    `H${clx}`,
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

  // Auto-fit on first render and whenever the canvas changes.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !layout) return;
    const cw = el.clientWidth  || 1200;
    const ch = el.clientHeight || 700;

    const peerNodes = peerIds.map(id => nodeById.get(id)).filter(Boolean);
    const peerBand  = peerNodes.length > 0 ? peerNodes.length * (CARD_H + PEER_GAP) : 0;
    const totalH    = layout.height + peerBand;

    const scaleX = cw / layout.width;
    const scaleY = ch / totalH;
    const fit    = Math.max(0.18, Math.min(scaleX, scaleY, 1) * 0.92);
    setFitZoom(fit);
    setZoom(fit);
    setPan({ x: 0, y: 0 });
  }, [layout?.width, layout?.height, peerIds.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!layout) {
    return <div className="text-sm text-muted-foreground italic p-4">No roles to display.</div>;
  }

  const { points, width, height } = layout;

  const peerNodes = peerIds.map(id => nodeById.get(id)).filter((n): n is OrgTreeNode => !!n);
  const peerBand  = peerNodes.length > 0 ? peerNodes.length * (CARD_H + PEER_GAP) : 0;

  // All tree cards shift down by peerBand so peer cards live above them.
  const treeOffY = peerBand;

  const canvasW = width;
  const canvasH = height + peerBand;

  const ptById = new Map(points.map(p => [p.id, p]));

  // Shallowest point = root (depth 0)
  const rootPoint = points.reduce((a, b) => a.depth < b.depth ? a : b);

  // ─ Edges ──────────────────────────────────────────────────────────
  interface Edge { from: LayoutPoint; to: LayoutPoint }
  const primaryEdges: Edge[] = [];
  for (const p of points) {
    if (!p.parentId) continue;
    // Dotted-only nodes (no solid boss) get a DASHED matrix edge instead
    // of a solid bracket — skip the solid edge for them. The matrix-edge
    // loop below draws the dashed connector from their dotted boss.
    if (!p.data.primaryBossId) continue;
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

  // Anchor helpers for indented-tree bracket connectors:
  // parent's bracket-X (offset INDENT_X/2 from left edge) at parent's bottom Y
  //   → child's left-edge X at child's mid-Y.
  const brkX    = (p: LayoutPoint) => p.x + INDENT_X / 2;            // bracket vertical-line X
  const bottomY = (p: LayoutPoint) => p.y + treeOffY + CARD_H;       // parent bottom edge Y
  const leftCX  = (p: LayoutPoint) => p.x;                           // child left edge X
  const midY    = (p: LayoutPoint) => p.y + treeOffY + CARD_H / 2;   // child mid Y

  // ─ Pan + zoom ─────────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(z => Math.max(0.18, Math.min(2.5, z + (e.deltaY < 0 ? 0.05 : -0.05))));
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
  const stopPan  = () => { setIsPan(false); panStart.current = null; };
  const resetView = () => { setZoom(fitZoom); setPan({ x: 0, y: 0 }); };

  return (
    <div className="relative">
      {/* Zoom controls */}
      <div className="absolute z-20 right-2 top-2 flex items-center gap-1 bg-background/80 backdrop-blur rounded border border-slate-200 dark:border-slate-700 shadow-sm p-0.5">
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.max(0.18, z - 0.08))} title="Zoom out">
          <Minus className="w-3 h-3" />
        </Button>
        <button
          onClick={resetView}
          className="text-[11px] px-1.5 tabular-nums text-muted-foreground hover:text-foreground"
          title="Reset to fit"
        >
          {zoom === fitZoom ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.min(2.5, z + 0.08))} title="Zoom in">
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      {/* Canvas container — fills the viewport minus header */}
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
            {/* Solid primary edges — indented-tree bracket connectors */}
            {primaryEdges.map(({ from, to }, i) => (
              <path
                key={`p-${i}`}
                d={vBracket(brkX(from), bottomY(from), leftCX(to), midY(to))}
                className="stroke-slate-400 dark:stroke-slate-500"
                fill="none"
                strokeWidth={1.5}
              />
            ))}

            {/* Amber dotted matrix edges */}
            {matrixEdges.map(({ from, to }, i) => (
              <path
                key={`m-${i}`}
                d={vBracket(brkX(from), bottomY(from), leftCX(to), midY(to))}
                className="stroke-amber-500"
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
            ))}

            {/* Dashed connector from each peer card's bottom to root's top */}
            {peerNodes.map((peer, i) => {
              const peerCX   = rootPoint.cx;
              const peerBotY = PAD_TOP + i * (CARD_H + PEER_GAP) + CARD_H;
              const rootTopY = rootPoint.y + treeOffY;
              return (
                <line
                  key={`peer-${peer.id}`}
                  x1={peerCX} y1={peerBotY}
                  x2={peerCX} y2={rootTopY}
                  className="stroke-slate-400 dark:stroke-slate-500"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              );
            })}
          </svg>

          {/* Peer cards — above the root, aligned to its centre-x */}
          {peerNodes.map((peer, i) => {
            const x = rootPoint.cx - CARD_W / 2;
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

          {/* Tree cards */}
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

          {/* Collapse/expand toggles — sit on the bracket line just below
              each parent card that has children. */}
          {points
            .filter(p => hasChildren.has(p.id))
            .map(p => {
              const tx = p.x + INDENT_X / 2 - 8;                  // on the bracket vertical line
              const ty = p.y + treeOffY + CARD_H + 2;             // just below parent bottom
              const collapsed = collapsedIds.has(p.id);
              return (
                <button
                  key={`tg-${p.id}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse(p.id); }}
                  title={collapsed ? "Expand" : "Collapse"}
                  className="absolute z-10 w-4 h-4 rounded-full bg-card border border-slate-300 flex items-center justify-center hover:border-slate-500 hover:shadow"
                  style={{ left: tx, top: ty }}
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
