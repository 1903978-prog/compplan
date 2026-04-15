// ── slideImageExporter.ts ────────────────────────────────────────────────
// Pixel-perfect PPTX export using Playwright.
//
// The problem this solves: the old /generate-deck route assembles a PPTX
// by translating `slide_briefs` into pptxgenjs calls (addText, addShape,
// addImage). That gives clean editable text in PowerPoint but means the
// exported deck looks *nothing* like the HTML preview the user just
// refined to 90+/100. Action titles wrap differently, colors drift, layouts
// collapse — because pptxgenjs isn't re-running the same layout engine.
//
// This module takes the other approach: it launches a headless Chromium
// via Playwright, sets the viewport to the native slide size (960×540),
// injects each slide's `preview_html` as a full document, screenshots it
// at 2× for retina, and drops those PNGs into a PPTX as full-bleed images.
// One slide per image, zero layout drift, WYSIWYG with the live preview.
//
// Trade-offs:
//   • PPTX slides are raster (images) — you can't edit the text in PowerPoint.
//     That's the explicit cost of "looks identical to the preview".
//   • Playwright + Chromium adds ~300MB to the server install.
//   • Each export spins up a browser. We reuse one browser instance for the
//     whole deck (launch once, screenshot N slides, close) — much faster
//     than launching per slide.
//
// Usage:
//   import { exportDeckAsImagePptx } from "./slideImageExporter";
//   const buf = await exportDeckAsImagePptx(proposal);
//   res.send(buf);
//
// The proposal must have `slide_selection[]` with per-slide `preview_html`
// fields populated (set by the client preview generator / refiner).

import type { Browser } from "playwright";

interface SlideEntry {
  slide_id: string;
  title?: string;
  is_selected?: boolean;
  preview_html?: string;
}

interface ProposalLike {
  company_name?: string | null;
  slide_selection?: SlideEntry[] | null;
}

const SLIDE_W_PX = 960;
const SLIDE_H_PX = 540;

// PPTX uses inches. LAYOUT_WIDE = 13.333 × 7.5 in (16:9). We fill the entire
// slide with the rendered image, edge-to-edge, no margins — the HTML already
// owns its own padding so any outer border would double it up.
const PPTX_W_IN = 13.333;
const PPTX_H_IN = 7.5;

/** Wraps a bare HTML fragment in a full document with Arial + reset CSS. */
function wrapHtml(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: ${SLIDE_W_PX}px;
    height: ${SLIDE_H_PX}px;
    font-family: Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    background: white;
    overflow: hidden;
  }
  * { box-sizing: border-box; }
</style>
</head>
<body>${innerHtml}</body>
</html>`;
}

/**
 * Render every selected slide with a populated `preview_html` to PNG and
 * assemble a PPTX. Returns a Node Buffer ready for res.send().
 *
 * Skips slides where `is_selected === false` and slides without
 * `preview_html` (those haven't been generated yet — we don't silently
 * invent content for them).
 */
export async function exportDeckAsImagePptx(proposal: ProposalLike): Promise<Buffer> {
  const all: SlideEntry[] = Array.isArray(proposal.slide_selection) ? proposal.slide_selection : [];
  const renderable = all.filter(s => s.is_selected !== false && typeof s.preview_html === "string" && s.preview_html.trim().length > 0);

  if (renderable.length === 0) {
    throw new Error("No slides with preview HTML to export. Generate previews first.");
  }

  // Lazy-import so importing this module doesn't eagerly pull in Playwright
  // for server code paths that will never call it.
  const { chromium } = await import("playwright");
  const PptxGenJS = (await import("pptxgenjs")).default;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      // --disable-dev-shm-usage is essential on Render's small containers —
      // the default /dev/shm is tiny and Chromium will crash without it.
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    // One context, one page — we reuse them for every slide. Each
    // setContent() call fully replaces the DOM, so there's no bleed
    // between slides.
    const context = await browser.newContext({
      viewport: { width: SLIDE_W_PX, height: SLIDE_H_PX },
      deviceScaleFactor: 2, // retina — exported images are 1920×1080
    });
    const page = await context.newPage();

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.company = "eendigo";

    for (const slide of renderable) {
      const html = wrapHtml(slide.preview_html!);
      await page.setContent(html, { waitUntil: "networkidle", timeout: 15_000 });

      // Screenshot the full page. `fullPage: false` + a clip at the
      // exact slide box guarantees we get 960×540 at 2× = 1920×1080 PNG,
      // even if the HTML accidentally overflows.
      const png = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: SLIDE_W_PX, height: SLIDE_H_PX },
        omitBackground: false,
      });

      const pSlide = pptx.addSlide();
      pSlide.addImage({
        data: `data:image/png;base64,${png.toString("base64")}`,
        x: 0,
        y: 0,
        w: PPTX_W_IN,
        h: PPTX_H_IN,
      });
    }

    const arrayBuf = await pptx.write({ outputType: "arraybuffer" });
    return Buffer.from(arrayBuf as ArrayBuffer);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
