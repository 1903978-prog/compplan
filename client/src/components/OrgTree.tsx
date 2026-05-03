import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, BookOpen, Plus, Minus, ChevronRight } from "lucide-react";

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
  // Fired when the user clicks the chevron on a node whose subtree
  // exceeds MAX_LAYERS_BELOW_CEO. The page renders a side panel
  // listing direct reports of this node.
  onShowSubtree?: (id: string) => void;
}

// ─── Layout constants ─────────────────────────────────────────────────
// HYBRID TOP-DOWN LAYOUT — see CLAUDE.md rule 10. Two exceptions to the
// default vertical indented tree:
//   • CEO's solid-line children: horizontal spread on a single row.
//   • Dotted-only nodes: horizontal next to their dotted boss.
// Everyone else stacks vertically below their parent (indented tree).
const CARD_W   = 200;
const CARD_H   = 40;          // compact single-line tile (was 72)
const CARD_H_DEEP = 30;       // even shorter for the deepest 2 levels (N-3+ from CEO)
const DEEP_LEVEL  = 4;        // depth ≥ this uses CARD_H_DEEP — three levels below CEO
const INDENT_X = 28;          // indent per depth in the vertical indented tree
const COL_GAP  = 12;          // gap between CEO-child columns (horizontal exception)
const V_GAP    = 6;           // vertical gap between successive rows
// (No fixed Y_STEP — row Y is computed incrementally from each card's
// height since deep cards are shorter than upper-level cards.)
const PAD_X    = 20;
const PAD_TOP  = 14;
const PAD_BOT  = 28;
const PEER_GAP = 18;          // above-root vertical gap for peer cards
const ELBOW_R  = 5;
const CEO_ID   = "ceo";       // children of this node spread horizontally
// Cap on visible layers BELOW CEO. CEO row is layer 0; its children
// are layer 1; etc. Anything past MAX_LAYERS_BELOW_CEO is hidden
// behind a "show direct reports" chevron that opens the side panel.
const MAX_LAYERS_BELOW_CEO = 3;

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
  node, depth, height, onOpen, onAddKnowledge,
}: {
  node: OrgTreeNode;
  depth: number;
  height: number;
  onOpen: () => void;
  onAddKnowledge: () => void;
}) {
  const isUpper = depth <= 1;
  const isDeep  = height < CARD_H;          // deepest two levels
  const accent  = isUpper
    ? { stripe: "bg-sky-500",    name: "text-sky-600",    avatarBg: "bg-sky-100",    avatarFg: "text-sky-700" }
    : { stripe: "bg-orange-500", name: "text-orange-600", avatarBg: "bg-orange-100", avatarFg: "text-orange-700" };

  // Single-line content: role title in bold colour, FIRST name only in
  // smaller grey on the same line. Surnames intentionally dropped to keep
  // the card to one row.
  const role      = node.title?.trim() ?? "";
  const firstName = node.name?.trim().split(/\s+/)[0] ?? "";
  const headline  = role || node.name || "";   // fallback if no role

  const statusDot =
    node.vacant     ? "bg-red-500"
  : node.onboarding ? "bg-amber-400"
  : node.fired      ? "bg-slate-400"
                    : "";

  // Sizing tokens — slightly tighter for "deep" (N-3+ from CEO) cards.
  const avatarBox = isDeep ? "w-5 h-5" : "w-7 h-7";
  const botSize   = isDeep ? "w-3 h-3" : "w-4 h-4";
  const initFont  = isDeep ? "text-[9px]" : "text-[11px]";
  const roleFont  = isDeep ? "text-[11px]" : "text-[12px]";
  const subFont   = isDeep ? "text-[10px]" : "text-[11px]";
  const padX      = isDeep ? "pl-1.5 pr-4" : "pl-2 pr-5";
  const gap       = isDeep ? "gap-1" : "gap-1.5";
  const stripeH   = isDeep ? "h-[2px]" : "h-[2px]";

  return (
    <Card
      onClick={onOpen}
      title={`${role}${firstName ? " · " + firstName : ""}${node.name && node.name !== firstName ? " (" + node.name + ")" : ""}`}
      className={`group relative cursor-pointer transition-shadow hover:shadow-md overflow-hidden bg-card border-slate-200 dark:border-slate-700 rounded-md select-none ${
        node.highlight ? "ring-2 ring-sky-300/60" : ""
      }`}
      style={{ width: CARD_W, height }}
    >
      <div className={`absolute inset-x-0 top-0 ${stripeH} ${accent.stripe}`} />

      <div className={`flex items-center h-full ${padX} ${gap}`}>
        <div className="relative shrink-0">
          <div className={`${avatarBox} rounded-full ${accent.avatarBg} ${accent.avatarFg} flex items-center justify-center font-semibold ${initFont}`}>
            {node.type === "agent" ? <Bot className={botSize} /> : initialsOf(node.name)}
          </div>
          {(node.overdueCount ?? 0) > 0 && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-1 ring-card"
              title={`${node.overdueCount} overdue`}
            />
          )}
        </div>

        <div className="flex-1 min-w-0 flex items-baseline gap-1.5 truncate">
          <span className={`font-semibold ${roleFont} ${accent.name} truncate`}>{headline}</span>
          {role && firstName && (
            <span className={`${subFont} text-muted-foreground truncate`}>{firstName}</span>
          )}
        </div>

        {statusDot && (
          <span className={`shrink-0 inline-block w-1.5 h-1.5 rounded-full ${statusDot}`} />
        )}

        <Button
          size="sm" variant="ghost"
          className="absolute top-0.5 right-0.5 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
  h: number;   // card height (varies by depth)
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
): { points: LayoutPoint[]; width: number; height: number; maxDepth: number; hiddenSubtreeOwners: Set<string> } | null {
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

  // Per CLAUDE.md rule 10:
  //   • SOLID-line children → BELOW parent in the indented tree (vertical).
  //   • DOTTED-only children → SAME ROW as boss, offset to the RIGHT
  //     (the one horizontal exception, for matrix / advisor relationships).
  // A "dotted-only" node has no solid primary boss but at least one
  // dotted (matrix) boss. These are pulled out of the main tree and
  // placed alongside their dotted boss after the layout pass.
  const isDottedOnly = (n: OrgTreeNode) =>
    !n.primaryBossId && (n.matrixBossIds?.length ?? 0) > 0;
  const dottedOnly = visible.filter(isDottedOnly);
  const treeNodes  = visible.filter(n => !isDottedOnly(n));

  const tmap = new Map<string, TNode>();
  const vRoot: TNode = { id: ROOT_ID, data: null, children: [], parentId: null, _depth: 0 };
  tmap.set(ROOT_ID, vRoot);
  for (const n of treeNodes) {
    tmap.set(n.id, { id: n.id, data: n, children: [], parentId: null, _depth: 0 });
  }

  const treeIds = new Set(treeNodes.map(n => n.id));
  for (const n of treeNodes) {
    const node = tmap.get(n.id)!;
    const pid  = (n.primaryBossId && treeIds.has(n.primaryBossId)) ? n.primaryBossId : ROOT_ID;
    node.parentId = pid;
    tmap.get(pid)?.children.push(node);
  }

  // Helpers used by the layout — width & row count of a subtree, used
  // to size CEO's horizontal columns.
  const subtreeMaxIndent = (n: TNode): number => {
    let m = 0;
    const dfs = (node: TNode, d: number) => {
      if (d > m) m = d;
      for (const c of node.children) dfs(c, d + 1);
    };
    dfs(n, 0);
    return m;
  };
  const subtreeWidth = (n: TNode) => CARD_W + subtreeMaxIndent(n) * INDENT_X;

  // Card height shrinks for deeper levels (per CLAUDE.md rule 10 sizing
  // note): N-3 from CEO and below get a tighter row height so the whole
  // chart fits without resizing on expand.
  const cardH = (depth: number) => depth >= DEEP_LEVEL ? CARD_H_DEEP : CARD_H;

  // Hybrid layout:
  //   • Default: indented-tree (each child below parent, indented INDENT_X
  //     to the right).
  //   • CEO's children: spread horizontally on a single row, each child
  //     occupying its own column wide enough for that child's whole
  //     subtree (which then continues vertically).
  // collect() returns the next available Y (in pixels) after placing
  // the subtree. Working in pixel-Y instead of row-count lets us mix
  // tall and short cards on the same canvas.
  //
  // We also track `dfc` (depth from CEO) — resets to 0 when we hit the
  // CEO node, otherwise inherits parent's dfc + 1 (or stays -1 above
  // CEO). When dfc reaches MAX_LAYERS_BELOW_CEO and the node still has
  // children, those children are skipped from the chart and the node
  // is added to hiddenSubtreeOwners so the UI can render a chevron
  // pointing into the side panel.
  const points: LayoutPoint[] = [];
  let maxDepth = 0;
  const hiddenSubtreeOwners = new Set<string>();

  const collect = (n: TNode, depth: number, dfc: number, x: number, y: number): number => {
    if (n.id === ROOT_ID) {
      n._depth = -1;
      let curY = y;
      for (const c of n.children) curY = collect(c, 0, -1, x, curY);
      return curY;
    }
    n._depth = depth;
    if (depth > maxDepth) maxDepth = depth;

    // Reset depth-from-CEO when we hit the CEO node itself.
    const cd = n.data?.id === CEO_ID ? 0 : dfc;

    const h  = cardH(depth);
    const px = x;
    const py = y;

    points.push({
      id:       n.id,
      data:     n.data!,
      depth,
      x:        px,
      y:        py,
      h,
      cx:       px + CARD_W / 2,
      cy:       py + h / 2,
      parentId: n.parentId === ROOT_ID ? null : n.parentId,
    });

    // Cap once we're MAX_LAYERS_BELOW_CEO levels deep below CEO. Anything
    // deeper moves to the side panel — render a chevron instead.
    if (cd >= MAX_LAYERS_BELOW_CEO && n.children.length > 0) {
      hiddenSubtreeOwners.add(n.id);
      return py + h + V_GAP;
    }

    if (n.data?.id === CEO_ID && n.children.length > 0) {
      // Exception 2: CEO's children spread horizontally on the row below.
      const childY = py + h + V_GAP;
      let cx = x;
      let maxBottomY = childY + cardH(depth + 1);
      for (const c of n.children) {
        const w = subtreeWidth(c);
        const r = collect(c, depth + 1, cd + 1, cx, childY);
        if (r > maxBottomY) maxBottomY = r;
        cx += w + COL_GAP;
      }
      return maxBottomY;
    }

    // Default: vertical indented tree.
    let nextY = py + h + V_GAP;
    for (const c of n.children) {
      nextY = collect(c, depth + 1, cd + 1, x + INDENT_X, nextY);
    }
    return nextY;
  };
  const totalBottomY = collect(vRoot, 0, -1, PAD_X, PAD_TOP);

  if (points.length === 0) return null;

  // Place dotted-only nodes on the SAME ROW as their dotted boss,
  // offset to the right (per rule 10 exception). The existing matrix-
  // edge renderer draws the dashed connector between them.
  const SAT_GAP = 24;
  const ptByIdLayout = new Map(points.map(p => [p.id, p]));
  for (const n of dottedOnly) {
    const bossId = (n.matrixBossIds ?? []).find(id => ptByIdLayout.has(id));
    if (!bossId) continue;
    const bossPt = ptByIdLayout.get(bossId)!;
    const px = bossPt.x + CARD_W + SAT_GAP;
    const py = bossPt.y;
    points.push({
      id:       n.id,
      data:     n,
      depth:    bossPt.depth,
      x:        px,
      y:        py,
      h:        bossPt.h,
      cx:       px + CARD_W / 2,
      cy:       py + bossPt.h / 2,
      parentId: null,
    });
  }

  // Canvas size — width = rightmost card edge; height = lowest card bottom.
  let maxRight = PAD_X + CARD_W;
  let maxBottom = totalBottomY;
  for (const p of points) {
    const r = p.x + CARD_W;
    if (r > maxRight) maxRight = r;
    const b = p.y + p.h;
    if (b > maxBottom) maxBottom = b;
  }
  const width  = maxRight + PAD_X;
  const height = maxBottom + PAD_BOT;

  return { points, width, height, maxDepth, hiddenSubtreeOwners };
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

// Top-down bracket (used only for CEO → its horizontally-spread children):
// parent bottom-centre → down to mid-Y → horizontal across to child centre-X
// → down to child top-centre. Classic top-down org-chart connector.
function tBracket(pcx: number, py: number, ccx: number, cy: number): string {
  if (Math.abs(ccx - pcx) < 0.5) {
    return `M${pcx},${py} V${cy}`;
  }
  const midYV = (py + cy) / 2;
  const r     = ELBOW_R;
  const sign  = ccx > pcx ? 1 : -1;
  return [
    `M${pcx},${py}`,
    `V${midYV - r}`,
    `Q${pcx},${midYV} ${pcx + sign * r},${midYV}`,
    `H${ccx - sign * r}`,
    `Q${ccx},${midYV} ${ccx},${midYV + r}`,
    `V${cy}`,
  ].join(" ");
}

// ─── Component ────────────────────────────────────────────────────────
export default function OrgTree({
  nodes, peerIds = [], collapsedIds, onToggleCollapse, onOpen, onAddKnowledge, onShowSubtree,
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

  // Auto-fit ONCE on initial render. Subsequent layout changes (e.g.
  // user clicks + to expand) keep the existing zoom — the chart does
  // NOT resize on expand, per user spec. fitZoom is still updated so
  // the manual "Fit" button refits to current canvas if needed.
  const initialFitDone = useRef(false);
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
    if (!initialFitDone.current) {
      setZoom(fit);
      setPan({ x: 0, y: 0 });
      initialFitDone.current = true;
    }
  }, [layout?.width, layout?.height, peerIds.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!layout) {
    return <div className="text-sm text-muted-foreground italic p-4">No roles to display.</div>;
  }

  const { points, width, height, hiddenSubtreeOwners } = layout;

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
    if (!p.parentId) continue;        // dotted-only satellites have parentId=null
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

  // Anchor helpers — use each point's own height (p.h) since deeper
  // levels are shorter than upper ones.
  const brkX    = (p: LayoutPoint) => p.x + INDENT_X / 2;            // bracket vertical-line X
  const bottomY = (p: LayoutPoint) => p.y + treeOffY + p.h;          // parent bottom edge Y
  const leftCX  = (p: LayoutPoint) => p.x;                           // child left edge X
  const midY    = (p: LayoutPoint) => p.y + treeOffY + p.h / 2;      // child mid Y

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
            {/* Solid primary edges. CEO→children uses a top-down bracket
                (horizontal spread); everything else uses the indented-tree
                vertical bracket. */}
            {primaryEdges.map(({ from, to }, i) => {
              const isCeoTopDown = from.data.id === CEO_ID;
              const d = isCeoTopDown
                ? tBracket(from.cx, bottomY(from), to.cx, to.y + treeOffY)
                : vBracket(brkX(from), bottomY(from), leftCX(to), midY(to));
              return (
                <path
                  key={`p-${i}`}
                  d={d}
                  className="stroke-slate-400 dark:stroke-slate-500"
                  fill="none"
                  strokeWidth={1.5}
                />
              );
            })}

            {/* Amber dotted matrix edges. Two cases:
                • Dotted-only satellite (same row, offset right) → straight
                  horizontal line from boss right-edge to satellite left-edge.
                • Cross-tree dotted relationship (different rows) → standard
                  vertical bracket from boss bottom to target left-mid. */}
            {matrixEdges.map(({ from, to }, i) => {
              const sameRow = Math.abs(from.y - to.y) < 0.5 && to.x > from.x;
              const d = sameRow
                ? `M${from.x + CARD_W},${midY(from)} H${leftCX(to)}`
                : vBracket(brkX(from), bottomY(from), leftCX(to), midY(to));
              return (
                <path
                  key={`m-${i}`}
                  d={d}
                  className="stroke-amber-500"
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              );
            })}

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
                  height={CARD_H}
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
                height={p.h}
                onOpen={() => onOpen(p.id)}
                onAddKnowledge={() => onAddKnowledge(p.id)}
              />
            </div>
          ))}

          {/* Collapse/expand toggles intentionally NOT rendered — chart is
              always fully expanded per user spec. Removed from the DOM
              entirely. */}

          {/* "Show direct reports" chevron — placed on the right edge of
              cards whose subtree is hidden by the depth cap. Distinct
              from any +/- toggle (which is gone): this opens the side
              panel rather than expanding the chart in place. */}
          {points
            .filter(p => hiddenSubtreeOwners.has(p.id))
            .map(p => {
              const tx = p.x + CARD_W - 6;        // overlap right edge of card
              const ty = p.y + treeOffY + p.h / 2 - 9;
              return (
                <button
                  key={`sub-${p.id}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onShowSubtree?.(p.id); }}
                  title="Show direct reports"
                  className="absolute z-10 w-[18px] h-[18px] rounded-full bg-sky-500 text-white border border-white flex items-center justify-center shadow hover:bg-sky-600"
                  style={{ left: tx, top: ty }}
                >
                  <ChevronRight className="w-3 h-3" />
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
