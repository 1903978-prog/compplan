// ── useActiveAIModel ─────────────────────────────────────────────────────
// Lightweight cross-component hook that reads the user's selected AI model
// from localStorage and keeps every consumer in sync via a window event
// bus. Used by:
//   • AdminAIModels page — writes the selection on Save.
//   • The top-bar badge in App.tsx — reads it to show the current abbrev.
//
// The persistence shape is { id } so we can extend later (temp settings,
// per-job overrides) without invalidating the key.

import { useCallback, useEffect, useState } from "react";
import { MODEL_SELECTION_KEY, DEFAULT_MODEL_ID, findModel, type AIModel } from "@/lib/aiModels";

const EVENT_NAME = "ai-model-selection-updated";

function readStored(): string {
  try {
    const raw = localStorage.getItem(MODEL_SELECTION_KEY);
    if (!raw) return DEFAULT_MODEL_ID;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string") return parsed.id;
  } catch { /* ignore */ }
  return DEFAULT_MODEL_ID;
}

export function useActiveAIModel(): {
  modelId: string;
  model: AIModel | undefined;
  setModelId: (id: string) => void;
} {
  const [modelId, setState] = useState<string>(() => readStored());

  useEffect(() => {
    const handler = () => setState(readStored());
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", (e) => {
      if (e.key === MODEL_SELECTION_KEY) handler();
    });
    return () => { window.removeEventListener(EVENT_NAME, handler); };
  }, []);

  const setModelId = useCallback((id: string) => {
    try {
      localStorage.setItem(MODEL_SELECTION_KEY, JSON.stringify({ id }));
    } catch { /* quota */ }
    setState(id);
    window.dispatchEvent(new Event(EVENT_NAME));
  }, []);

  return { modelId, model: findModel(modelId), setModelId };
}
