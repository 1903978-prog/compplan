// Top-right header indicator: shows backend reachability + count of saves
// the server has not yet confirmed. Sits next to the existing API-activity
// dot — it reports a different signal (data persistence, not LLM cost).

import { useSaveSafety } from "@/lib/saveSafety";

export function SaveSafetyIndicator() {
  const { status, pendingCount } = useSaveSafety();

  const dotClass =
    status === "online"
      ? "bg-green-500"
      : status === "offline"
      ? "bg-destructive"
      : "bg-muted-foreground animate-pulse";

  const pillClass =
    status === "online"
      ? "bg-green-50 text-green-700 border-green-200"
      : status === "offline"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-muted text-muted-foreground border-border";

  const label =
    status === "online" ? "Online" : status === "offline" ? "Offline" : "Checking";

  const tooltip =
    status === "online"
      ? "Backend reachable — saves are persisting"
      : status === "offline"
      ? "Backend unreachable — recent saves may not have persisted"
      : "Checking backend reachability…";

  return (
    <div className="flex items-center gap-1.5" data-privacy="show">
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] ${pillClass}`}
        title={tooltip}
        data-testid="connection-status"
      >
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className="font-medium">{label}</span>
      </div>
      {pendingCount > 0 && (
        <div
          className="flex items-center gap-1 px-2 py-1 rounded-full border border-orange-200 bg-orange-50 text-orange-700 text-[11px] font-semibold"
          title={`${pendingCount} save${pendingCount === 1 ? "" : "s"} not yet confirmed by the server. Refresh after saving safely (Online + 0 unsaved).`}
          data-testid="pending-saves"
        >
          {pendingCount} unsaved
        </div>
      )}
    </div>
  );
}
