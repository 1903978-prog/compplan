import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Shield, CheckCircle, AlertTriangle, XCircle, ChevronDown, ExternalLink, RefreshCw, Search, FileWarning, X } from "lucide-react";

// ── Control definitions ────────────────────────────────────────────────────────
type Status = "green" | "yellow" | "red" | "unknown";
type Platform = "github" | "neon" | "render" | "app" | "local";

interface SecurityControl {
  id: string;
  platform: Platform;
  name: string;
  description: string;
  howToFix: string;
  actionUrl?: string;
  autoCheckId?: string; // matches server auto-check ID
  severity: "critical" | "high" | "medium";
}

const CONTROLS: SecurityControl[] = [
  // ── GitHub ──────────────────────────────────────────
  { id: "gh_mfa", platform: "github", severity: "critical", name: "MFA enforced for all org members",
    description: "Multi-factor authentication prevents account takeover even if passwords are compromised.",
    howToFix: "GitHub > Org Settings > Authentication security > Require two-factor authentication.",
    actionUrl: "https://github.com/organizations/1903978-prog/settings/security" },
  { id: "gh_branch_protection", platform: "github", severity: "critical", name: "Branch protection on master",
    description: "Require pull requests with at least 1 review before merging. Prevents unauthorized code changes.",
    howToFix: "GitHub > Repo Settings > Branches > Add rule for 'master': require PR reviews, require status checks.",
    actionUrl: "https://github.com/1903978-prog/compplan/settings/branches" },
  { id: "gh_secret_scanning", platform: "github", severity: "high", name: "Secret scanning enabled",
    description: "GitHub scans all commits for accidentally committed API keys, tokens, and passwords.",
    howToFix: "GitHub > Repo Settings > Code security > Enable secret scanning.",
    actionUrl: "https://github.com/1903978-prog/compplan/settings/security_analysis" },
  { id: "gh_dependabot", platform: "github", severity: "high", name: "Dependabot alerts enabled",
    description: "Automated alerts when dependencies have known vulnerabilities.",
    howToFix: "GitHub > Repo Settings > Code security > Enable Dependabot alerts.",
    actionUrl: "https://github.com/1903978-prog/compplan/settings/security_analysis" },
  { id: "gh_no_secrets_in_code", platform: "github", severity: "critical", name: "No hardcoded secrets in code",
    description: "API keys, tokens, and passwords must never be committed to the repository. Use the Secrets Scanner above to detect any leaks.",
    howToFix: "Use the Secrets Scanner at the top of this page to scan all code. Remove any findings and move values to environment variables. Then rotate the compromised credentials immediately.",
    autoCheckId: "app_secrets_scan" },
  { id: "gh_signed_commits", platform: "github", severity: "medium", name: "Signed commits required",
    description: "Cryptographically signed commits verify that code comes from a trusted author.",
    howToFix: "GitHub > Repo Settings > Branches > Edit protection rule > Require signed commits." },
  { id: "gh_dormant_users", platform: "github", severity: "medium", name: "Dormant users/tokens removed",
    description: "Old collaborators, deploy keys, and personal access tokens should be revoked when no longer needed.",
    howToFix: "GitHub > Org Settings > People: review members. Repo Settings > Deploy keys and Tokens: review and remove unused." },
  { id: "gh_gitignore", platform: "github", severity: "high", name: ".gitignore covers .env and credentials",
    description: "Ensure .env, .pem, credentials.json, and similar files are excluded from version control.",
    howToFix: "Add .env*, *.pem, credentials.json to .gitignore if missing.",
    autoCheckId: "app_gitignore" },

  // ── Neon ────────────────────────────────────────────
  { id: "neon_ip_allowlist", platform: "neon", severity: "high", name: "IP allowlist enabled",
    description: "By default Neon accepts connections from any IP (0.0.0.0). Restrict to only your Render service IPs.",
    howToFix: "Neon Console > Project > Settings > IP Allow: add Render outbound IPs only.",
    actionUrl: "https://console.neon.tech" },
  { id: "neon_least_privilege", platform: "neon", severity: "high", name: "Least-privilege DB roles",
    description: "The app should connect with a role that has only the permissions it needs, not a superuser.",
    howToFix: "Neon Console > Roles: create a dedicated app role with limited permissions. Update DATABASE_URL." },
  { id: "neon_password_rotated", platform: "neon", severity: "medium", name: "Database password rotated (<90 days)",
    description: "Regularly rotating the database password limits exposure if credentials leak.",
    howToFix: "Neon Console > Roles > Reset password. Then update DATABASE_URL in Render env vars." },
  { id: "neon_no_prod_in_dev", platform: "neon", severity: "medium", name: "Dev/preview not hitting production DB",
    description: "Local development and preview environments should use a separate Neon branch, not the production database.",
    howToFix: "Create a dev branch in Neon. Use its connection string for local .env and Render preview environments." },

  // ── Render ──────────────────────────────────────────
  { id: "render_members", platform: "render", severity: "high", name: "Workspace members reviewed",
    description: "Only necessary people should have access. Remove ex-team members promptly.",
    howToFix: "Render Dashboard > Team: review all members and their roles. Remove anyone who shouldn't have access.",
    actionUrl: "https://dashboard.render.com/settings" },
  { id: "render_env_vars", platform: "render", severity: "high", name: "Environment variables reviewed",
    description: "Check that no stale, unused, or overly-broad secrets exist. Ensure prod secrets aren't in preview.",
    howToFix: "Render Dashboard > Service > Environment: audit every variable. Remove unused ones." },
  { id: "render_env_separation", platform: "render", severity: "medium", name: "Prod/staging/preview separated",
    description: "Production, staging, and preview environments should have separate secret sets.",
    howToFix: "Use Render's Projects feature to separate environments. Don't share prod DATABASE_URL with preview." },
  { id: "render_api_keys", platform: "render", severity: "medium", name: "Render API keys rotated",
    description: "If you use Render API keys, they should be rotated periodically and scoped minimally.",
    howToFix: "Render Dashboard > Account Settings > API Keys: rotate any keys older than 90 days." },
  { id: "render_deploy_branch", platform: "render", severity: "high", name: "Auto-deploy from protected branch only",
    description: "Render should deploy only from the protected master branch, not from arbitrary branches.",
    howToFix: "Render Dashboard > Service > Settings: verify deploy branch is 'master' and auto-deploy is from GitHub." },

  // ── Application Code ────────────────────────────────
  { id: "app_password_hashing", platform: "app", severity: "critical", name: "Password hashing (not plaintext)",
    description: "APP_PASSWORD should be compared using bcrypt, not plaintext string comparison.",
    howToFix: "Install bcrypt. In server/auth.ts, hash the password on login comparison instead of direct === check.",
    autoCheckId: "app_password_hashing" },
  { id: "app_rate_limit", platform: "app", severity: "high", name: "Rate limiting on login endpoint",
    description: "Without rate limiting, attackers can try unlimited password guesses.",
    howToFix: "npm install express-rate-limit. Add limiter middleware to POST /api/auth/login (max 5 attempts/min).",
    autoCheckId: "app_rate_limit" },
  { id: "app_helmet", platform: "app", severity: "high", name: "Security headers (Helmet.js)",
    description: "Helmet sets HTTP headers like X-Frame-Options, X-Content-Type-Options, HSTS to prevent common attacks.",
    howToFix: "npm install helmet. Add app.use(helmet()) in server/index.ts before routes.",
    autoCheckId: "app_helmet" },
  { id: "app_validation", platform: "app", severity: "high", name: "Server-side input validation (Zod)",
    description: "All POST/PUT endpoints should validate request bodies with Zod schemas. Client-side validation is not enough.",
    howToFix: "Add Zod schemas for each endpoint's request body in server/routes.ts. Use z.parse() before processing." },
  { id: "app_session_duration", platform: "app", severity: "medium", name: "Session cookie duration ≤ 7 days",
    description: "Long session durations (currently 30 days) increase risk if a cookie is stolen.",
    howToFix: "In server/auth.ts, change MAX_AGE from 30*24*60*60*1000 to 7*24*60*60*1000.",
    autoCheckId: "app_session_duration" },

  // ── Local/Developer ─────────────────────────────────
  { id: "local_disk_encryption", platform: "local", severity: "medium", name: "Full disk encryption enabled",
    description: "If your laptop is stolen, disk encryption prevents data access. Use BitLocker (Windows) or FileVault (Mac).",
    howToFix: "Windows: Settings > Privacy & Security > Device encryption. Mac: System Preferences > FileVault." },
  { id: "local_no_prod_creds_in_ai", platform: "local", severity: "high", name: "No production credentials shared in AI chats",
    description: "Never paste API keys, tokens, or passwords into AI assistants. They may be logged or cached.",
    howToFix: "Rotate any credentials that were shared in AI chat sessions. Use environment variables exclusively." },
];

const PLATFORM_LABELS: Record<Platform, string> = {
  github: "GitHub", neon: "Neon (Database)", render: "Render (Hosting)",
  app: "Application Code", local: "Local / Developer",
};

const PLATFORM_ORDER: Platform[] = ["github", "neon", "render", "app", "local"];

const STATUS_ICON = { green: CheckCircle, yellow: AlertTriangle, red: XCircle, unknown: AlertTriangle };
const STATUS_COLOR = {
  green: "text-emerald-600", yellow: "text-amber-500", red: "text-red-500", unknown: "text-muted-foreground",
};
const STATUS_BG = {
  green: "bg-emerald-50 border-emerald-200", yellow: "bg-amber-50 border-amber-200",
  red: "bg-red-50 border-red-200", unknown: "bg-muted/30 border-border",
};

const STORAGE_KEY = "cybersec_control_states";

interface ControlState {
  status: Status;
  checkedAt: string | null;
  notes: string;
}

function loadStates(): Record<string, ControlState> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
}
function saveStates(states: Record<string, ControlState>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AppAdmin() {
  const { toast } = useToast();
  const [states, setStates] = useState<Record<string, ControlState>>(loadStates);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoChecks, setAutoChecks] = useState<Record<string, { status: Status; detail: string }>>({});
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<{ file: string; line: number; pattern: string; snippet: string }[] | null>(null);
  const [scanTime, setScanTime] = useState<string | null>(null);

  // Load auto-checks from server
  const runAutoChecks = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/security/app-checks", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, { status: Status; detail: string }> = {};
        for (const c of data.checks ?? []) {
          map[c.id] = { status: c.status, detail: c.detail };
        }
        setAutoChecks(map);
      }
    } catch { /* silent */ }
    setChecking(false);
  };

  const scanSecrets = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/security/scan-secrets", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setScanResults(data.findings ?? []);
        setScanTime(data.scanned_at);
        if (data.finding_count > 0) {
          toast({ title: `Found ${data.finding_count} potential secret(s)`, description: "Review findings below and remove from code", variant: "destructive" });
        } else {
          toast({ title: "No secrets found", description: "Codebase is clean" });
        }
      }
    } catch { toast({ title: "Scan failed", variant: "destructive" }); }
    setScanning(false);
  };

  useEffect(() => { runAutoChecks(); }, []);

  const getStatus = (control: SecurityControl): Status => {
    // Auto-check overrides manual state for applicable controls
    if (control.autoCheckId && autoChecks[control.autoCheckId]) {
      return autoChecks[control.autoCheckId].status;
    }
    return states[control.id]?.status ?? "unknown";
  };

  const getDetail = (control: SecurityControl): string | null => {
    if (control.autoCheckId && autoChecks[control.autoCheckId]) {
      return autoChecks[control.autoCheckId].detail;
    }
    const s = states[control.id];
    if (s?.checkedAt) return `Verified ${new Date(s.checkedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
    return null;
  };

  const markAs = (controlId: string, status: Status) => {
    const next = {
      ...states,
      [controlId]: { status, checkedAt: new Date().toISOString(), notes: states[controlId]?.notes ?? "" },
    };
    setStates(next);
    saveStates(next);
  };

  // Summary
  const total = CONTROLS.length;
  const greenCount = CONTROLS.filter(c => getStatus(c) === "green").length;
  const redCount = CONTROLS.filter(c => getStatus(c) === "red").length;
  const yellowCount = CONTROLS.filter(c => getStatus(c) === "yellow").length;
  const unknownCount = total - greenCount - redCount - yellowCount;

  const overallScore = total > 0 ? Math.round((greenCount / total) * 100) : 0;
  const overallColor = overallScore >= 80 ? "text-emerald-600" : overallScore >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-6">
      <PageHeader
        title="App Admin"
        description="Application administration and security controls"
        actions={
          <Button variant="outline" size="sm" onClick={runAutoChecks} disabled={checking}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`} />
            Re-scan
          </Button>
        }
      />

      {/* Score summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Overall</div>
            <div className={`text-2xl font-bold ${overallColor}`}>{overallScore}%</div>
            <div className="text-[10px] text-muted-foreground">{greenCount}/{total} compliant</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Compliant</div>
            <div className="text-2xl font-bold text-emerald-600">{greenCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Needs Attention</div>
            <div className="text-2xl font-bold text-amber-500">{yellowCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Non-Compliant</div>
            <div className="text-2xl font-bold text-red-500">{redCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Not Checked</div>
            <div className="text-2xl font-bold text-muted-foreground">{unknownCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Secrets Scanner */}
      <Card className={scanResults && scanResults.length > 0 ? "border-red-300 bg-red-50/30" : ""}>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold uppercase tracking-wide">Secrets Scanner</span>
              {scanResults !== null && (
                <Badge variant={scanResults.length === 0 ? "default" : "destructive"} className="text-[10px]">
                  {scanResults.length === 0 ? "Clean" : `${scanResults.length} found`}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {scanTime && <span className="text-[10px] text-muted-foreground">Last scan: {new Date(scanTime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
              <Button size="sm" variant="outline" onClick={scanSecrets} disabled={scanning}>
                <Search className={`w-3.5 h-3.5 mr-1.5 ${scanning ? "animate-pulse" : ""}`} />
                {scanning ? "Scanning..." : "Scan Codebase"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Scans all .ts, .tsx, .js, .json, .env files for hardcoded API keys, tokens, passwords, connection strings, and other secrets.
          </p>
          {scanResults === null && (
            <div className="text-xs text-muted-foreground italic">Click "Scan Codebase" to run the first scan</div>
          )}
          {scanResults !== null && scanResults.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-600">
              <CheckCircle className="w-4 h-4" /> No hardcoded secrets detected in codebase
            </div>
          )}
          {scanResults !== null && scanResults.length > 0 && (
            <div className="space-y-1.5 mt-2">
              <div className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Action required: remove these secrets from code and move to environment variables. Then rotate the compromised credentials.
              </div>
              <div className="rounded border border-red-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-red-100/50 text-red-800">
                      <th className="text-left px-2 py-1.5 font-semibold">File</th>
                      <th className="text-left px-2 py-1.5 font-semibold w-16">Line</th>
                      <th className="text-left px-2 py-1.5 font-semibold">Type</th>
                      <th className="text-left px-2 py-1.5 font-semibold">Code Snippet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanResults.map((f, i) => (
                      <tr key={i} className="border-t border-red-100">
                        <td className="px-2 py-1.5 font-mono text-[11px]">{f.file}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px]">{f.line}</td>
                        <td className="px-2 py-1.5">
                          <Badge variant="destructive" className="text-[9px]">{f.pattern}</Badge>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-red-700 max-w-[400px] truncate">{f.snippet}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Controls by platform */}
      {PLATFORM_ORDER.map(platform => {
        const controls = CONTROLS.filter(c => c.platform === platform);
        const platGreen = controls.filter(c => getStatus(c) === "green").length;
        return (
          <Card key={platform}>
            <CardContent className="pt-4 pb-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold uppercase tracking-wide">{PLATFORM_LABELS[platform]}</span>
                </div>
                <Badge variant={platGreen === controls.length ? "default" : "secondary"} className="text-[10px]">
                  {platGreen}/{controls.length}
                </Badge>
              </div>

              <div className="space-y-1">
                {controls.map(control => {
                  const status = getStatus(control);
                  const detail = getDetail(control);
                  const isExpanded = expanded === control.id;
                  const Icon = STATUS_ICON[status];
                  const isAuto = !!control.autoCheckId && !!autoChecks[control.autoCheckId];

                  return (
                    <div key={control.id} className={`border rounded-lg overflow-hidden ${STATUS_BG[status]}`}>
                      {/* Header row */}
                      <button
                        onClick={() => setExpanded(isExpanded ? null : control.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-black/[0.02] transition-colors"
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${STATUS_COLOR[status]}`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{control.name}</span>
                          {control.severity === "critical" && (
                            <Badge variant="destructive" className="text-[8px] ml-2 px-1 py-0">CRITICAL</Badge>
                          )}
                          {isAuto && (
                            <Badge variant="outline" className="text-[8px] ml-1 px-1 py-0">AUTO</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {detail && <span className="text-[10px] text-muted-foreground">{detail}</span>}
                          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t bg-background/50 space-y-2">
                          <p className="text-xs text-muted-foreground">{control.description}</p>
                          <div className="text-xs">
                            <span className="font-semibold">How to fix: </span>
                            <span className="text-muted-foreground">{control.howToFix}</span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            {!isAuto && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-[11px]"
                                  onClick={() => { markAs(control.id, "green"); toast({ title: `Marked "${control.name}" as compliant` }); }}>
                                  <CheckCircle className="w-3 h-3 mr-1 text-emerald-600" /> Mark Compliant
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-[11px]"
                                  onClick={() => { markAs(control.id, "yellow"); }}>
                                  <AlertTriangle className="w-3 h-3 mr-1 text-amber-500" /> In Progress
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-[11px]"
                                  onClick={() => { markAs(control.id, "red"); }}>
                                  <XCircle className="w-3 h-3 mr-1 text-red-500" /> Not Done
                                </Button>
                              </>
                            )}
                            {isAuto && (
                              <span className="text-[10px] text-muted-foreground italic">Auto-detected from server scan</span>
                            )}
                            {control.actionUrl && (
                              <a href={control.actionUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline ml-auto">
                                Open settings <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
