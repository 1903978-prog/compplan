import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Code, Download, Upload, Activity, Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildClaudeCodePrompt, parseCoworkOutput, type AgentLite } from "./promptTemplates";

export default function Executive() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [generated, setGenerated] = useState<string>("");
  const [pasted, setPasted] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<{ created: number; errors: number } | null>(null);

  useEffect(() => {
    fetch("/api/agentic/agents", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setAgents);
  }, []);

  function generateClaudeCodePrompt() {
    const text = buildClaudeCodePrompt({
      date: new Date().toISOString().slice(0, 10),
      approvedAgentChanges: [],
      pendingAppChanges: [],
      raciGaps: [],
    });
    setGenerated(text);
  }

  // Parse pasted output and create the corresponding rows in the right tables.
  async function importPasted() {
    if (!pasted.trim()) return;
    setImporting(true);
    let created = 0, errors = 0;
    try {
      const parsed = parseCoworkOutput(pasted);
      const agentByName = new Map(agents.map(a => [a.name.toLowerCase().trim(), a.id]));

      for (const d of parsed.decisions) {
        const agent_id = agentByName.get(d.agent_name.toLowerCase().trim());
        if (!agent_id) { errors++; continue; }
        try {
          if (d.type === "idea") {
            await fetch("/api/agentic/ideas", {
              method: "POST", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agent_id,
                title: d.title,
                description: d.description,
                okr_link: d.okr_link,
                impact_score: d.impact, effort_score: d.effort, risk_score: d.risk,
                status: "proposed",
              }),
            });
            created++;
          } else if (d.type === "action" || d.type === "proposal") {
            await fetch("/api/agentic/tasks", {
              method: "POST", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agent_id,
                title: d.title,
                description: d.description,
                deadline: d.deadline,
                approval_level: d.approval_level,
              }),
            });
            created++;
          } else if (d.type === "conflict") {
            await fetch("/api/agentic/conflicts", {
              method: "POST", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: d.title,
                agents_involved: d.agent_name,
                severity: (d.impact ?? 0) >= 70 ? "high" : (d.impact ?? 0) >= 40 ? "medium" : "low",
              }),
            });
            created++;
          }
        } catch { errors++; }
      }
      // Log the import.
      await fetch("/api/agentic/log", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "output_imported",
          payload: { created, errors, parse_errors: parsed.errors.length },
        }),
      });
      // Phase 3 — auto-detect conflicts on the freshly-imported tasks.
      // Heuristics: overload (>7 actions/agent in last hour), same-deadline
      // collision across ≥2 agents, antonym-keyword titles. Each detection
      // creates a row in `conflicts` + an executive_log event.
      let autoConflicts = 0;
      try {
        const dr = await fetch("/api/agentic/conflicts/auto-detect", {
          method: "POST", credentials: "include",
        });
        if (dr.ok) {
          const j = await dr.json();
          autoConflicts = j.created ?? 0;
        }
      } catch { /* non-fatal */ }
      setLastImport({ created, errors: errors + parsed.errors.length });
      setPasted("");
      toast({
        title: `Imported ${created} decisions`,
        description: [
          errors > 0 ? `${errors} skipped` : null,
          autoConflicts > 0 ? `${autoConflicts} conflicts auto-detected — review on /logs` : null,
        ].filter(Boolean).join(" · ") || undefined,
      });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => toast({ title: "Copied to clipboard" }))
      .catch(() => toast({ title: "Copy failed", variant: "destructive" }));
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Briefcase className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Executive OKR</h1>
          <p className="text-sm text-muted-foreground">Phase 1 — top-level OKRs · agent-section mapping · RACI · prompt generators</p>
        </div>
      </div>

      {/* Top-level OKRs (placeholder — to be filled by COO skill in Phase 2) */}
      <Card className="p-4">
        <h2 className="text-sm font-bold mb-2">Company OKRs</h2>
        <p className="text-xs text-muted-foreground italic">
          Top-level company OKRs go here. In Phase 2 the COO skill will populate this from the CEO agent's objectives + KRs.
        </p>
      </Card>

      {/* Agent → app-section mapping (read-only summary; edits happen on each agent page) */}
      <Card className="p-4">
        <h2 className="text-sm font-bold mb-2">Agent → app-section mapping</h2>
        <p className="text-[10px] text-muted-foreground italic mb-3">
          Maintained by the COO. Edit per-agent on the Agent Detail page.
        </p>
        <div className="text-xs space-y-1">
          {agents.length === 0 ? <p className="italic text-muted-foreground">No agents yet.</p> : agents.map(a => (
            <div key={a.id} className="grid grid-cols-[160px_1fr] gap-2 py-1 border-b">
              <div className="font-semibold">{a.name}</div>
              <div className="text-muted-foreground whitespace-pre-wrap">
                {a.app_sections_assigned ?? <span className="italic">— not assigned —</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* RACI matrix — read-only seed; COO maintains in Phase 2 */}
      <Card className="p-4">
        <h2 className="text-sm font-bold mb-2">RACI matrix</h2>
        <p className="text-[10px] text-muted-foreground italic mb-3">
          Phase 1: read-only scaffolding. The COO skill will populate this in Phase 2.
        </p>
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-1.5">Responsibility</th>
                <th className="text-left p-1.5">Accountable</th>
                <th className="text-left p-1.5">Responsible</th>
                <th className="text-left p-1.5">Consulted</th>
                <th className="text-left p-1.5">Informed</th>
                <th className="text-left p-1.5">Approval</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b"><td className="p-1.5">Daily CEO review</td><td className="p-1.5">CEO</td><td className="p-1.5">CEO</td><td className="p-1.5">COO, CFO, CHRO, CMO</td><td className="p-1.5">Livio</td><td className="p-1.5">Livio</td></tr>
              <tr className="border-b"><td className="p-1.5">Pipeline forecast</td><td className="p-1.5">SVP Sales</td><td className="p-1.5">SVP Sales</td><td className="p-1.5">CFO, CHRO</td><td className="p-1.5">CEO</td><td className="p-1.5">CEO</td></tr>
              <tr className="border-b"><td className="p-1.5">Hiring forecast</td><td className="p-1.5">CHRO</td><td className="p-1.5">CHRO</td><td className="p-1.5">SVP Sales, COO, CFO</td><td className="p-1.5">CEO/Livio</td><td className="p-1.5">Livio</td></tr>
              <tr className="border-b"><td className="p-1.5">Payment reminders</td><td className="p-1.5">CFO</td><td className="p-1.5">CFO</td><td className="p-1.5">CEO if sensitive</td><td className="p-1.5">Livio if escalated</td><td className="p-1.5">CFO/Livio</td></tr>
              <tr className="border-b"><td className="p-1.5">Content creation</td><td className="p-1.5">CMO</td><td className="p-1.5">CMO</td><td className="p-1.5">CKO</td><td className="p-1.5">CEO</td><td className="p-1.5">Livio (publish)</td></tr>
              <tr className="border-b"><td className="p-1.5">Proposal generation</td><td className="p-1.5">SVP Sales</td><td className="p-1.5">SVP Sales</td><td className="p-1.5">CFO, CKO</td><td className="p-1.5">CEO</td><td className="p-1.5">Livio (final send)</td></tr>
              <tr><td className="p-1.5">Agent training</td><td className="p-1.5">CHRO</td><td className="p-1.5">CHRO</td><td className="p-1.5">Boss agents</td><td className="p-1.5">CEO</td><td className="p-1.5">CHRO</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Generate Claude Code prompt */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Code className="w-4 h-4" /> Claude Code prompt generator
          </h2>
          <Button size="sm" variant="outline" onClick={generateClaudeCodePrompt}>
            <Sparkles className="w-3.5 h-3.5 mr-1" /> Generate
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Bundles approved agent changes + pending app changes + RACI gaps into a paste-ready prompt for Claude Code (app/code work). In Phase 1 the bundle is empty — populated by the COO skill in Phase 2.
        </p>
        {generated && (
          <div className="space-y-2">
            <Textarea value={generated} readOnly rows={20} className="font-mono text-xs" />
            <Button size="sm" onClick={() => copy(generated)}>
              <Download className="w-3.5 h-3.5 mr-1" /> Copy to clipboard
            </Button>
          </div>
        )}
      </Card>

      {/* Import Cowork output */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4" />
          <h2 className="text-sm font-bold">Import Cowork output</h2>
          {lastImport && <Badge variant="outline" className="text-[10px]">last import: {lastImport.created} created · {lastImport.errors} errors</Badge>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Paste the structured output from your Cowork session below. Each <code>DECISION_ID</code> block (separated by <code>---</code>) becomes an idea / task / conflict on the matching agent.
        </p>
        <Textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={14}
          placeholder="DECISION_ID: 1&#10;TYPE: idea&#10;AGENT: SVP Sales / BD&#10;TITLE: Reconnect dormant PE contacts&#10;DESCRIPTION: Outbound to PE funds not contacted in 120d.&#10;OKR_LINK: 3&#10;DEADLINE: none&#10;APPROVAL_LEVEL: autonomous&#10;IMPACT: 60&#10;EFFORT: 20&#10;RISK: 10&#10;---"
          className="font-mono text-xs"
        />
        <Button size="sm" onClick={importPasted} disabled={!pasted.trim() || importing}>
          <Upload className="w-3.5 h-3.5 mr-1" /> {importing ? "Importing…" : "Import decisions"}
        </Button>
      </Card>
    </div>
  );
}
