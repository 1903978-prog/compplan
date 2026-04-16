// ── slideTemplateRenderer.ts ─────────────────────────────────────────────
// Deterministic HTML renderer for slide template specs.
//
// Input:
//   - spec: SlideTemplateSpec (canvas dims, optional background data URL,
//           regions array with positions + font/color/alignment)
//   - values: Record<string, string> mapping region.key → content text
//
// Output:
//   - HTML string for a 960×540 slide (the size used throughout compplan's
//     preview + Playwright export pipeline). Regions authored in 1920×1080
//     canvas units are scaled down by the canvas→960 factor.
//
// Determinism guarantee: given the same spec + values, this function returns
// byte-identical HTML every call. No randomness, no model variance.
//
// This file is importable from BOTH client and server (it's in shared/).
// The client uses it for live preview inside the template editor; the
// server will (next iteration) call it from /generate-page to produce the
// preview_html for slides that have a template assigned.

import type { SlideTemplateSpec, SlideTemplateRegion } from "./schema";

export const SLIDE_RENDER_W = 960;
export const SLIDE_RENDER_H = 540;

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Convert vertical alignment to flexbox justify-content (we render each
// region as a flex container so both horizontal + vertical alignment Just Work).
function valignToJustify(v: SlideTemplateRegion["valign"]): string {
  if (v === "top") return "flex-start";
  if (v === "bottom") return "flex-end";
  return "center";
}

function alignToJustify(a: SlideTemplateRegion["align"]): string {
  if (a === "left") return "flex-start";
  if (a === "right") return "flex-end";
  return "center";
}

// Render a single region as an absolutely-positioned flex container.
// The inner span holds the actual text so flexbox can handle both axes.
function renderRegion(
  region: SlideTemplateRegion,
  value: string,
  scale: number
): string {
  const x = Math.round(region.x * scale);
  const y = Math.round(region.y * scale);
  const w = Math.round(region.w * scale);
  const h = Math.round(region.h * scale);
  const fontSize = Math.round(region.size * scale);

  const text = value || region.default_text || region.placeholder || "";

  const boxStyle = [
    "position:absolute",
    `left:${x}px`,
    `top:${y}px`,
    `width:${w}px`,
    `height:${h}px`,
    "display:flex",
    `justify-content:${alignToJustify(region.align)}`,
    `align-items:${valignToJustify(region.valign)}`,
    "overflow:hidden",
    "box-sizing:border-box",
  ].join(";");

  const textStyle = [
    `font-family:'${escapeAttr(region.font)}',sans-serif`,
    `font-size:${fontSize}px`,
    `font-weight:${region.weight}`,
    `color:${region.color}`,
    `line-height:${region.line_height}`,
    `letter-spacing:${region.letter_spacing}px`,
    region.italic ? "font-style:italic" : "",
    `text-align:${region.align}`,
    "white-space:pre-wrap",
    "word-break:break-word",
    "margin:0",
    "padding:0",
  ].filter(Boolean).join(";");

  return `<div data-region-key="${escapeAttr(region.key)}" style="${boxStyle}"><span style="${textStyle}">${escapeHtml(text)}</span></div>`;
}

export interface RenderOptions {
  // If true, wraps in a full <html><body> document. If false (default),
  // returns just the outer slide div — matches what compplan's preview pane
  // and generate-page currently store in preview_html.
  fullDocument?: boolean;
}

export function renderSlideFromSpec(
  spec: SlideTemplateSpec,
  values: Record<string, string>,
  opts: RenderOptions = {}
): string {
  const canvasW = spec.canvas?.width || 1920;
  const scale = SLIDE_RENDER_W / canvasW;

  const outerStyleParts = [
    "position:relative",
    `width:${SLIDE_RENDER_W}px`,
    `height:${SLIDE_RENDER_H}px`,
    "overflow:hidden",
    "background-color:#ffffff",
    "box-sizing:border-box",
  ];

  if (spec.background) {
    const safeUrl = spec.background.replace(/'/g, "\\'");
    outerStyleParts.push(
      `background-image:url('${safeUrl}')`,
      `background-size:${SLIDE_RENDER_W}px ${SLIDE_RENDER_H}px`,
      "background-repeat:no-repeat",
      "background-position:0 0",
    );
  }

  const regionsHtml = (spec.regions || [])
    .map(r => renderRegion(r, values[r.key] ?? "", scale))
    .join("");

  const slideDiv = `<div class="slide" style="${outerStyleParts.join(";")}">${regionsHtml}</div>`;

  if (!opts.fullDocument) return slideDiv;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  html,body{margin:0;padding:0;background:#fff;}
  body{font-family:Inter,system-ui,sans-serif;}
</style>
</head>
<body>
${slideDiv}
</body>
</html>`;
}
