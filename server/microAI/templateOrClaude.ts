// Render a template; fall back to Claude only for genuinely creative
// slots that the caller couldn't fill. Used by agent code paths that
// previously called Claude end-to-end — the goal is to push token
// usage toward zero by doing as much in deterministic templates as
// possible.

import { render, type RenderedTemplate } from "./templateEngine";

export interface RenderOrFallbackOpts {
  /** Slot names that are allowed to be filled by Claude when missing. */
  creativeSlots?: string[];
  /**
   * Async function that fills creative slots when needed. Receives the
   * names of missing creative slots and the slots already provided;
   * returns an object with the filled-in slot values. Implementations
   * are wired by the caller (e.g. CEO brief uses claude.ts here). If
   * not provided, missing slots stay empty.
   */
  fillCreativeSlots?: (
    missing: string[],
    slots: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

/**
 * Render `agent/slug` with `slots`. If any required slots are missing,
 * either fall back to the Claude filler or just return the partial
 * render (with empty placeholders for the missing pieces).
 */
export async function renderOrFallback(
  agent: string,
  slug: string,
  slots: Record<string, unknown>,
  opts: RenderOrFallbackOpts = {},
): Promise<RenderedTemplate> {
  const first = render(agent, slug, slots);
  if (first.missingSlots.length === 0) return first;

  const allowed = new Set(opts.creativeSlots ?? first.missingSlots);
  const fillable = first.missingSlots.filter(s => allowed.has(s));
  if (fillable.length === 0 || !opts.fillCreativeSlots) {
    // Nothing we're allowed to (or can) fix. Return the partial render.
    return first;
  }

  const filled = await opts.fillCreativeSlots(fillable, slots);
  return render(agent, slug, { ...slots, ...filled });
}
