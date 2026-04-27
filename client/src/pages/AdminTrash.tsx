import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, RefreshCw, Trash2, Undo2, Trash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Admin Trash Bin ────────────────────────────────────────────────────
// Lists every soft-deleted row across the wrapped DELETE endpoints.
// Items live for 30 days then auto-purge on the next server boot.
// Restore re-inserts the row into its original table.
//
// Backend: GET /api/trash · POST /api/trash/:id/restore · DELETE /api/trash/:id
// Storage: server/storage.ts trashAndDelete / restoreTrash / purgeTrashItem
// ───────────────────────────────────────────────────────────────────────

interface TrashItem {
  id: number;
  table_name: string;
  row_id: string;
  display_name: string | null;
  display_type: string | null;
  deleted_at: string;
  expires_at: string;
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminTrash() {
  const { toast } = useToast();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/trash", { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setItems(Array.isArray(data) ? data : []);
      } else {
        toast({ title: "Failed to load trash", variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      (i.display_name ?? "").toLowerCase().includes(q) ||
      (i.display_type ?? "").toLowerCase().includes(q) ||
      (i.table_name ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const restore = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      const r = await fetch(`/api/trash/${item.id}/restore`, {
        method: "POST", credentials: "include",
      });
      if (r.ok) {
        toast({
          title: `Restored`,
          description: `${item.display_type ?? item.table_name}: ${item.display_name ?? `#${item.row_id}`}`,
        });
        // Optimistic: remove from list immediately
        setItems(prev => prev.filter(x => x.id !== item.id));
      } else {
        const body = await r.json().catch(() => ({}));
        // 409 = PK collision (someone created a new row with this id while
        // the old was in trash). Surface a clear, actionable message.
        const isConflict = r.status === 409 || body.code === "RESTORE_CONFLICT";
        toast({
          title: isConflict ? "Cannot restore — ID already in use" : "Restore failed",
          description: body.message || "Unknown error — the original ID may already be in use.",
          variant: "destructive",
        });
      }
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (item: TrashItem) => {
    if (!confirm(`Permanently delete "${item.display_name ?? item.row_id}"? This cannot be undone.`)) return;
    setBusyId(item.id);
    try {
      const r = await fetch(`/api/trash/${item.id}`, {
        method: "DELETE", credentials: "include",
      });
      if (r.ok) {
        toast({ title: "Permanently deleted" });
        setItems(prev => prev.filter(x => x.id !== item.id));
      } else {
        toast({ title: "Purge failed", variant: "destructive" });
      }
    } finally {
      setBusyId(null);
    }
  };

  // Group counts by display_type so the user sees what's in trash at a glance.
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) {
      const k = i.display_type ?? i.table_name;
      m[k] = (m[k] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [items]);

  return (
    <div>
      <PageHeader
        title="Trash Bin"
        description="Anything deleted in the app lands here for 30 days. Click Restore to put it back. After 30 days, items are permanently purged on the next server boot."
        actions={
          <div className="flex gap-2">
            <Link href="/admin">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Admin
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reload
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        {/* Per-type count strip */}
        {counts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {counts.map(([k, n]) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-muted border">
                <Trash2 className="w-3 h-3" />
                <span className="font-semibold">{k}</span>
                <span className="text-muted-foreground">· {n}</span>
              </span>
            ))}
          </div>
        )}

        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search name or type…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 max-w-xs text-sm"
            />
            <div className="text-[11px] text-muted-foreground">
              {filtered.length} item{filtered.length === 1 ? "" : "s"}
              {search && ` (filtered from ${items.length})`}
            </div>
            <div className="text-[10px] text-muted-foreground italic ml-auto">
              30-day retention · auto-purged on next server boot after expiry
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? "No items match this search." : "Trash is empty — nothing has been deleted recently."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead className="w-[180px]">Deleted</TableHead>
                    <TableHead className="w-[120px]">Expires in</TableHead>
                    <TableHead className="w-[200px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(item => {
                    const days = daysUntil(item.expires_at);
                    return (
                      <TableRow key={item.id} className="hover:bg-muted/20">
                        <TableCell className="text-xs">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                            {item.display_type ?? item.table_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-semibold">
                          {item.display_name || <span className="italic text-muted-foreground">(no name)</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {item.row_id}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(item.deleted_at)}
                        </TableCell>
                        <TableCell className={`text-xs whitespace-nowrap ${days <= 3 ? "text-red-600 font-semibold" : days <= 7 ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                          {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => restore(item)}
                              disabled={busyId === item.id}
                              className="h-7 px-2 text-xs"
                            >
                              <Undo2 className="w-3 h-3 mr-1" />
                              {busyId === item.id ? "…" : "Restore"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => purge(item)}
                              disabled={busyId === item.id}
                              className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Permanently delete now (skip the 30-day wait)"
                            >
                              <Trash className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <div className="text-[11px] text-muted-foreground italic px-1">
          Coverage: pricing cases, past projects (win/loss), candidates, proposal decks, won projects.
          Other tables (employees, knowledge, time tracking, etc.) still hard-delete — wrap them in <code className="text-[11px]">trashAndDelete()</code> on the server to add coverage.
        </div>
      </div>
    </div>
  );
}
