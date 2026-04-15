import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Database, Download, Upload, Shield, RefreshCw, CheckCircle, AlertTriangle,
  Clock, FileArchive, Github, Lock,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface BackupInfo {
  ok: boolean;
  tables_total: number;
  tables_available: number;
  rows_total: number;
  per_table: Record<string, number>;
  server_time: string;
  backup_token_configured: boolean;
}

interface ImportReport {
  ok: boolean;
  mode: "merge" | "replace";
  report: Record<string, { inserted: number; skipped: number; error?: string }>;
}

// Admin → Backup & Restore.
//
// This page is the single place where the user manages their data safety:
//   1. See how much data is currently in the database (live row counts).
//   2. Download a full JSON dump on demand.
//   3. Restore from a previously-downloaded dump (merge = safe additive,
//      replace = destructive).
//   4. Verify the nightly GitHub Actions backup is correctly wired up.
//
// Everything here was previously scattered across the top nav and GitHub
// workflow file; centralising it under Admin makes the disaster-recovery
// story obvious and reachable from one place.
export default function AdminBackup() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [lastImport, setLastImport] = useState<ImportReport | null>(null);
  const [lastDownloadAt, setLastDownloadAt] = useState<string | null>(
    () => localStorage.getItem("compplan.last_manual_backup") || null
  );

  const loadInfo = async () => {
    setLoadingInfo(true);
    try {
      const res = await fetch("/api/admin/backup-info", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BackupInfo = await res.json();
      setInfo(data);
    } catch (err: any) {
      toast({ title: "Failed to load backup info", description: err.message, variant: "destructive" });
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => { loadInfo(); }, []);

  const downloadDB = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/admin/download-backup", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `compplan-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const now = new Date().toISOString();
      setLastDownloadAt(now);
      localStorage.setItem("compplan.last_manual_backup", now);
      toast({
        title: "Backup downloaded",
        description: `Saved compplan-backup-${date}.json (${info?.rows_total ?? "?"} rows).`,
      });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const importDB = async (file: File) => {
    const label = importMode === "replace" ? "REPLACE (destructive)" : "MERGE (safe / additive)";
    const confirmed = window.confirm(
      `Import backup "${file.name}" in ${label} mode?\n\n` +
      (importMode === "replace"
        ? "⚠ REPLACE mode TRUNCATES every table first, then re-inserts rows from the file. " +
          "ANY data not in the backup will be permanently deleted. " +
          "Only use this if you are restoring a known-good full backup into an empty or corrupted DB."
        : "MERGE mode only adds missing rows (ON CONFLICT DO NOTHING). Existing rows are preserved. " +
          "Safe to run on a live database.") +
      `\n\nContinue?`
    );
    if (!confirmed) return;

    // Extra guardrail for replace mode — force a second explicit confirm.
    if (importMode === "replace") {
      const second = window.prompt(
        "This will DESTROY any row not in the backup file.\n\n" +
        "Type REPLACE in capital letters to confirm."
      );
      if (second !== "REPLACE") {
        toast({ title: "Cancelled", description: "Confirmation phrase did not match." });
        return;
      }
    }

    setImporting(true);
    setLastImport(null);
    try {
      const text = await file.text();
      let parsed: any;
      try { parsed = JSON.parse(text); }
      catch { throw new Error("File is not valid JSON"); }
      if (!parsed?.tables || typeof parsed.tables !== "object") {
        throw new Error("Backup file is missing the 'tables' key — is this a compplan backup?");
      }
      const res = await fetch(`/api/admin/import-backup?mode=${importMode}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data: ImportReport = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error((data as any).error ?? `HTTP ${res.status}`);
      }
      setLastImport(data);
      const totalInserted = Object.values(data.report).reduce((s, r) => s + (r.inserted || 0), 0);
      toast({
        title: `Import complete (${importMode})`,
        description: `${totalInserted} row${totalInserted === 1 ? "" : "s"} inserted across ${Object.keys(data.report).length} tables.`,
      });
      // Refresh counts so the user sees the new totals immediately.
      await loadInfo();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fmtRelative = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  // Sort per-table row counts descending so the user immediately sees the
  // biggest tables and can spot anything suspicious (e.g. a table at 0 rows
  // that shouldn't be).
  const perTableEntries = info
    ? Object.entries(info.per_table).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup & Restore"
        description="Download your database, restore from a backup, and verify the nightly off-site dump."
      />

      {/* ── CURRENT DATABASE STATE ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileArchive className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Current database</h3>
              {info && (
                <Badge variant="secondary" className="ml-2">
                  {info.tables_available}/{info.tables_total} tables
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadInfo}
              disabled={loadingInfo}
              data-testid="button-refresh-backup-info"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingInfo ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {loadingInfo && !info ? (
            <p className="text-sm text-muted-foreground">Loading row counts...</p>
          ) : info ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <StatCard label="Tables" value={info.tables_available.toString()} />
                <StatCard label="Total rows" value={info.rows_total.toLocaleString("it-IT")} />
                <StatCard
                  label="Last manual download"
                  value={lastDownloadAt ? fmtRelative(lastDownloadAt) : "never"}
                  muted={!lastDownloadAt}
                />
                <StatCard
                  label="Nightly backup token"
                  value={info.backup_token_configured ? "configured" : "NOT set"}
                  muted={!info.backup_token_configured}
                  warn={!info.backup_token_configured}
                />
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1 select-none">
                  Per-table row counts ({perTableEntries.length})
                </summary>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 mt-2 font-mono">
                  {perTableEntries.map(([t, n]) => (
                    <div key={t} className="flex justify-between border-b border-border/40 py-0.5">
                      <span className={n < 0 ? "text-muted-foreground italic" : ""}>{t}</span>
                      <span className={n < 0 ? "text-muted-foreground" : n === 0 ? "text-amber-600" : "text-foreground"}>
                        {n < 0 ? "—" : n.toLocaleString("it-IT")}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <p className="text-sm text-destructive">Could not load backup info.</p>
          )}
        </CardContent>
      </Card>

      {/* ── DOWNLOAD ──────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Download className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-semibold">Download full backup</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Dumps every user-data table into a single JSON file. Save this somewhere outside
            of Render (Dropbox, Google Drive, email to yourself) before any risky change. You
            can re-import it with the "Restore" card below.
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={downloadDB}
              disabled={downloading}
              data-testid="button-download-db"
              size="lg"
            >
              <Download className="w-4 h-4 mr-2" />
              {downloading ? "Preparing..." : "Download DB now"}
            </Button>
            {lastDownloadAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last manual: {fmtRelative(lastDownloadAt)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── RESTORE ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="w-5 h-5 text-amber-600" />
            <h3 className="text-lg font-semibold">Restore from backup file</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a previously-downloaded <code className="text-xs bg-muted px-1 py-0.5 rounded">compplan-backup-*.json</code> file.
            Choose MERGE to safely add missing rows, or REPLACE to wipe every table and
            re-seed from the file.
          </p>

          <div className="flex items-center gap-2 mb-4">
            <label className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer ${importMode === "merge" ? "border-emerald-500 bg-emerald-50" : "border-border hover:bg-muted/50"}`}>
              <input
                type="radio"
                name="import-mode"
                value="merge"
                checked={importMode === "merge"}
                onChange={() => setImportMode("merge")}
                className="sr-only"
              />
              <CheckCircle className={`w-4 h-4 ${importMode === "merge" ? "text-emerald-600" : "text-muted-foreground"}`} />
              <div>
                <div className="text-sm font-medium">MERGE <span className="text-xs text-muted-foreground font-normal">(safe / additive)</span></div>
                <div className="text-[11px] text-muted-foreground">Only inserts rows that don't already exist. Existing data is untouched.</div>
              </div>
            </label>
            <label className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer ${importMode === "replace" ? "border-destructive bg-destructive/5" : "border-border hover:bg-muted/50"}`}>
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={importMode === "replace"}
                onChange={() => setImportMode("replace")}
                className="sr-only"
              />
              <AlertTriangle className={`w-4 h-4 ${importMode === "replace" ? "text-destructive" : "text-muted-foreground"}`} />
              <div>
                <div className="text-sm font-medium text-destructive">REPLACE <span className="text-xs font-normal">(destructive)</span></div>
                <div className="text-[11px] text-muted-foreground">TRUNCATEs every table first. Use only for full disaster recovery.</div>
              </div>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              variant={importMode === "replace" ? "destructive" : "default"}
              size="lg"
              data-testid="button-restore-db"
            >
              <Upload className="w-4 h-4 mr-2" />
              {importing ? "Importing..." : "Choose file & restore"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) importDB(f);
              }}
            />
          </div>

          {lastImport && (
            <details className="mt-4 text-xs border rounded p-3 bg-muted/30">
              <summary className="cursor-pointer font-semibold text-foreground py-0.5">
                Last import report ({lastImport.mode} mode)
              </summary>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-0.5 font-mono">
                {Object.entries(lastImport.report).map(([t, r]) => (
                  <div key={t} className="flex justify-between border-b border-border/40 py-0.5">
                    <span className={r.error ? "text-destructive" : ""}>{t}</span>
                    <span>
                      {r.error
                        ? <span className="text-destructive">error</span>
                        : <>+{r.inserted}{r.skipped > 0 && <span className="text-muted-foreground"> · {r.skipped} skip</span>}</>}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* ── NIGHTLY OFF-SITE BACKUP (GitHub Actions) ──────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Github className="w-5 h-5 text-foreground" />
            <h3 className="text-lg font-semibold">Nightly off-site backup</h3>
            {info?.backup_token_configured ? (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 border-emerald-300">
                <CheckCircle className="w-3 h-3 mr-1" />
                Token configured
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Token NOT set
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            A GitHub Actions workflow runs every night at 01:00 UTC (~02:00 CET) and downloads
            a full DB dump via this very app. It then gzips the file, attaches it as a 90-day
            workflow artifact, and emails it to you. For this to work you need to set a few
            secrets — once — in GitHub and Render.
          </p>

          <div className="space-y-3 text-sm">
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="flex items-center gap-1.5 font-semibold mb-1.5">
                <Lock className="w-3.5 h-3.5" />
                Required secrets (GitHub repo → Settings → Secrets → Actions)
              </div>
              <ul className="space-y-1 text-xs font-mono text-muted-foreground">
                <li><code className="text-foreground">BACKUP_TOKEN</code> — any random string (e.g. 32 hex chars)</li>
                <li><code className="text-foreground">GMAIL_USERNAME</code> — gmail address that will send the backup email</li>
                <li><code className="text-foreground">GMAIL_APP_PASSWORD</code> — gmail app password (not your normal password)</li>
                <li><code className="text-foreground">BACKUP_EMAIL_TO</code> — where to email the backup</li>
              </ul>
            </div>
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="flex items-center gap-1.5 font-semibold mb-1.5">
                <Shield className="w-3.5 h-3.5" />
                Required env var (Render → service → Environment)
              </div>
              <ul className="space-y-1 text-xs font-mono text-muted-foreground">
                <li><code className="text-foreground">BACKUP_TOKEN</code> — <span className="italic">same</span> value you set on GitHub. This is how the workflow authenticates without a user session.</li>
              </ul>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://github.com/1903978-prog/compplan/actions/workflows/nightly-db-backup.yml"
                  target="_blank"
                  rel="noreferrer"
                >
                  View workflow runs
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://github.com/1903978-prog/compplan/settings/secrets/actions"
                  target="_blank"
                  rel="noreferrer"
                >
                  Set GitHub secrets
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://dashboard.render.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Render dashboard
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, muted, warn }: { label: string; value: string; muted?: boolean; warn?: boolean }) {
  return (
    <div className={`border rounded-md p-3 ${warn ? "border-amber-400 bg-amber-50" : "bg-muted/20"}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={`text-xl font-bold mt-0.5 font-mono ${muted ? "text-muted-foreground" : warn ? "text-amber-700" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
