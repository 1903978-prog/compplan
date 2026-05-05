// Save-safety: makes silent save failures impossible to miss.
//
// Three signals are exported as React state via SaveSafetyProvider:
//   1. `status`        — "online" | "offline" | "checking" backend reachability
//   2. `pendingCount`  — number of mutating /api/* calls that haven't confirmed
//   3. `markPending` / `clearPending` — manual hooks for non-fetch persists
//
// The provider patches `window.fetch` once at mount and:
//   - Tracks every non-GET, same-origin /api/* call as a "pending save"
//   - Removes the entry on a 2xx response (server confirmed)
//   - Leaves the entry in the set on throw or non-2xx (intentional — the
//     user should see that a save attempt didn't make it; reload clears it)
//   - Flips `status` to "online" on any successful /api/* response and to
//     "offline" on any throw, so the indicator self-corrects between the
//     periodic health-check pings.
//
// A separate 20-second interval pings `/api/auth/check` to keep `status`
// fresh while the user is idle (not actively saving).
//
// A `beforeunload` listener is attached only while `pendingCount > 0`, so
// the browser asks "Leave site?" if the user refreshes or closes the tab
// with unsaved work.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConnectionStatus = "online" | "offline" | "checking";

export interface SaveSafetyState {
  status: ConnectionStatus;
  pendingCount: number;
  markPending: (id: string) => void;
  clearPending: (id: string) => void;
}

const SaveSafetyContext = createContext<SaveSafetyState | null>(null);

export function useSaveSafety(): SaveSafetyState {
  const ctx = useContext(SaveSafetyContext);
  if (!ctx) {
    // Outside the provider (e.g. login screen, or test harness): return a
    // no-op shape so consumers don't have to null-check.
    return {
      status: "checking",
      pendingCount: 0,
      markPending: () => {},
      clearPending: () => {},
    };
  }
  return ctx;
}

const HEALTH_CHECK_INTERVAL_MS = 20_000;
const HEALTH_CHECK_URL = "/api/auth/check"; // lightweight, public, always 200 when reachable
const PATCH_FLAG = "__compplanSaveSafetyPatched";

// `Window` declares `fetch` already; we add an internal flag to avoid
// double-patching across React StrictMode or hot reloads.
declare global {
  interface Window {
    [PATCH_FLAG]?: boolean;
  }
}

function isMutatingApiRequest(input: RequestInfo | URL, method: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  let raw: string;
  if (typeof input === "string") raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = (input as Request).url;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    return u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function isAnyApiRequest(input: RequestInfo | URL): boolean {
  let raw: string;
  if (typeof input === "string") raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = (input as Request).url;
  try {
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export function SaveSafetyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const pendingSet = useRef<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);

  const syncCount = useCallback(() => {
    setPendingCount(pendingSet.current.size);
  }, []);

  const markPending = useCallback((id: string) => {
    pendingSet.current.add(id);
    syncCount();
  }, [syncCount]);

  const clearPending = useCallback((id: string) => {
    pendingSet.current.delete(id);
    syncCount();
  }, [syncCount]);

  // Patch window.fetch ONCE per page load. Idempotent across StrictMode
  // double-mount and hot reloads via the PATCH_FLAG sentinel.
  useEffect(() => {
    if (window[PATCH_FLAG]) return;
    window[PATCH_FLAG] = true;

    const originalFetch = window.fetch.bind(window);
    let counter = 0;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method =
        init?.method ??
        (typeof input === "object" && "method" in input ? (input as Request).method : "GET");
      const tracksPending = isMutatingApiRequest(input, method);
      const tracksStatus = isAnyApiRequest(input);
      const id = tracksPending ? `req-${++counter}` : null;

      if (id) markPending(id);

      try {
        const res = await originalFetch(input, init);
        if (tracksStatus) setStatus("online");
        if (id && res.ok) {
          // Server confirmed — clear the pending entry.
          clearPending(id);
        }
        // Non-OK on a mutation: leave id in the set. The user will see
        // an unresolved counter; the page's own toast/UI will tell them
        // what happened.
        return res;
      } catch (err) {
        if (tracksStatus) setStatus("offline");
        // Network throw: leave id in the set. Counter stays elevated.
        throw err;
      }
    };
  }, [markPending, clearPending]);

  // Periodic health check — keeps the dot fresh while the user is idle.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(HEALTH_CHECK_URL, { credentials: "include" });
        if (!cancelled) setStatus(r.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    void tick();
    const handle = window.setInterval(() => {
      void tick();
    }, HEALTH_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  // beforeunload guard — only attached while there is unsaved work.
  useEffect(() => {
    if (pendingCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message string but require returnValue
      // to be set for the confirmation dialog to appear.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pendingCount]);

  return (
    <SaveSafetyContext.Provider value={{ status, pendingCount, markPending, clearPending }}>
      {children}
    </SaveSafetyContext.Provider>
  );
}
