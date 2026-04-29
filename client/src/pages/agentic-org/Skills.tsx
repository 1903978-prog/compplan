import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Cpu, Download, Upload, Sparkles, Factory, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Skill {
  id: number; name: string; agent_key: string; kind: "core" | "drafted";
  markdown: string; status: string; source_task_id: number | null;
  source_agent_id: number | null; notes: string | null;
  created_at: string; updated_at: string;
}
interface QueueTask {
  id: number; title: string; description: string | null; agent_id: number;
}

export default function Skills() {
  const { toast } = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [factoryPayload, setFactoryPayload] = useState<string>("");
  const [importInput, setImportInput] = useState<string>("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, q, p] = await Promise.all([
        fetch("/api/agentic/skills",                  { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/skills/factory-queue",    { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/skills/factory-payload",  { credentials: "include" }).then(r => r.ok ? r.json() : { payload: "", count: 0 }),
      ]);
      setSkills(Array.isArray(s) ? s : []);
      setQueue(Array.isArray(q) ? q : []);
      setFactoryPayload(p.payload ?? "");
    } catch {
      toast({ title: "Failed to load skills", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  function toggle(id: number) {
    setExpandedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text)
      .then(() => toast({ title: `Copied: ${label}` }))
      .catch(() => toast({ title: "Copy failed", variant: "destructive" }));
  }

  async function patch(s: Skill, patch: Partial<Skill>) {
    setSkills(prev => prev.map(x => x.id === s.id ? { ...x, ...patch } as Skill : x));
    await fetch(`/api/agentic/skills/${s.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // Activate a drafted skill: parse markdown → create agent row →
  // link source_agent_id back. The button lights up only when status is
  // 'draft' and kind='drafted'.
  async function activate(s: Skill) {
    try {
      const r = await fetch(`/api/agentic/skills/${s.id}/activate`, {
        method: "POST", credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? `HTTP ${r.status}`);
      toast({
        title: `Activated: ${data.agent?.name ?? "agent"}`,
        description: "Agent created with mission + decision rights from the skill markdown. Visit /agents to confirm.",
      });
      await load();
    } catch (e) {
      toast({ title: "Activation failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function importDraftedSkills() {
    if (!importInput.trim()) return;
    try {
      const r = await fetch("/api/agentic/skills/import", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: importInput }),
      });
      const data = await r.json();
      toast({
        title: `Imported ${data.created} drafted skills`,
        description: data.errors?.length ? `${data.errors.length} errors` : undefined,
      });
      setImportInput("");
      await load();
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    }
  }

  const coreSkills    = skills.filter(s => s.kind === "core");
  const draftedSkills = skills.filter(s => s.kind === "drafted");

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Cpu className="w-7 h-7 text-primary" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">AIOS</p>
          <h1 className="text-2xl font-bold tracking-tight">Skill Factory</h1>
          <p className="text-sm text-muted-foreground">{skills.length} CoWork skills · {queue.length} approved proposals awaiting COO drafting</p>
        </div>
      </div>

      {/* Skill Factory queue + payload */}
      <Card className="p-4 space-y-3 border-primary/30">
        <div className="flex items-center gap-2">
          <Factory className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold">Skill Factory queue ({queue.length} approved proposals)</h2>
        </div>
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Nothing waiting. Approved hire proposals (Livio-approved tasks starting with "Hire:") will appear here.
            The CEO skill emits these as TYPE=proposal blocks during the daily reasoning loop.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              {queue.map(t => (
                <div key={t.id} className="text-xs flex items-center gap-2 border rounded p-2 bg-muted/20">
                  <Badge variant="outline" className="font-mono text-[10px]">#{t.id}</Badge>
                  <span className="font-semibold">{t.title}</span>
                  {t.description && <span className="text-muted-foreground truncate">— {t.description}</span>}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                <strong>Step 1:</strong> open Cowork with the <strong>Eendigo COO Skill Factory</strong> skill loaded (copy from below).
                <strong> Step 2:</strong> paste the payload below into that Cowork session.
                <strong> Step 3:</strong> copy COO's response and paste it into the import box at the bottom of this page.
              </p>
              <Textarea readOnly value={factoryPayload} rows={Math.min(12, factoryPayload.split("\n").length + 1)} className="font-mono text-xs" />
              <Button size="sm" onClick={() => copy(factoryPayload, "Skill Factory payload")}>
                <Download className="w-3.5 h-3.5 mr-1" /> Copy payload
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Core skills */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold flex items-center gap-2"><Sparkles className="w-4 h-4" /> Core skills (handcrafted)</h2>
          <Badge variant="outline" className="text-[10px]">{coreSkills.length}</Badge>
        </div>
        {loading ? <p className="text-xs italic text-muted-foreground">Loading…</p> : (
          <div className="space-y-2">
            {coreSkills.map(s => (
              <SkillRow key={s.id} skill={s} expanded={expandedIds.has(s.id)} onToggle={() => toggle(s.id)} onCopy={() => copy(s.markdown, s.name)} onStatus={(status) => patch(s, { status })} onActivate={() => activate(s)} />
            ))}
          </div>
        )}
      </Card>

      {/* Drafted skills */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold flex items-center gap-2"><Factory className="w-4 h-4" /> Drafted skills (from Skill Factory)</h2>
          <Badge variant="outline" className="text-[10px]">{draftedSkills.length}</Badge>
        </div>
        {draftedSkills.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            Drafted skills appear here after you import COO's output. Each starts as <Badge variant="outline" className="text-[9px] mx-1">draft</Badge> — review, click <strong>Activate</strong> to create the agent row (mission + decision rights parsed from the markdown), then paste the skill into a fresh Cowork session.
          </p>
        ) : (
          <div className="space-y-2">
            {draftedSkills.map(s => (
              <SkillRow key={s.id} skill={s} expanded={expandedIds.has(s.id)} onToggle={() => toggle(s.id)} onCopy={() => copy(s.markdown, s.name)} onStatus={(status) => patch(s, { status })} onActivate={() => activate(s)} />
            ))}
          </div>
        )}
      </Card>

      {/* Import COO output */}
      <Card className="p-4 space-y-3 border-amber-300/40">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4" />
          <h2 className="text-sm font-bold">Import COO's drafted skills</h2>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Paste the entire response from COO's Cowork session below. Each <code>```skill-md</code> fenced block becomes a row above (kind=drafted, status=draft). The parser silently skips blocks missing AGENT_KEY or ROLE_NAME.
        </p>
        <Textarea
          value={importInput}
          onChange={(e) => setImportInput(e.target.value)}
          rows={14}
          placeholder={"```skill-md\nDRAFT_FOR_TASK: 42\nAGENT_KEY: sdr-lead\nROLE_NAME: SDR Lead (Outbound)\n\n# Eendigo SDR Lead — Cowork Skill\n…\n```"}
          className="font-mono text-xs"
        />
        <Button size="sm" onClick={importDraftedSkills} disabled={!importInput.trim()}>
          <Upload className="w-3.5 h-3.5 mr-1" /> Import drafted skills
        </Button>
      </Card>
    </div>
  );
}

// One skill row — collapsed by default, expanded shows the full markdown.
function SkillRow({
  skill, expanded, onToggle, onCopy, onStatus, onActivate,
}: {
  skill: Skill; expanded: boolean; onToggle: () => void; onCopy: () => void;
  onStatus: (s: string) => void; onActivate: () => void;
}) {
  const statusTone =
    skill.status === "ready"      ? "border-emerald-300 text-emerald-700 bg-emerald-50"
    : skill.status === "pasted"   ? "border-blue-300 text-blue-700 bg-blue-50"
    : skill.status === "draft"    ? "border-amber-300 text-amber-700 bg-amber-50"
    :                                "border-slate-300 text-slate-700 bg-slate-50";
  // Activate button is only meaningful for drafted skills that don't yet
  // have a backing agent row (source_agent_id null).
  const canActivate = skill.kind === "drafted" && !skill.source_agent_id;
  return (
    <div className="border rounded overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 flex-wrap">
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span className="font-semibold text-sm flex-1 truncate min-w-[120px]">{skill.name}</span>
        <Badge variant="outline" className="text-[10px] font-mono">{skill.agent_key}</Badge>
        <Badge variant="outline" className={`text-[10px] ${statusTone}`}>{skill.status}</Badge>
        {skill.source_agent_id && (
          <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">agent #{skill.source_agent_id}</Badge>
        )}
        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onCopy}>
          <Download className="w-3 h-3 mr-1" /> Copy
        </Button>
        {canActivate && (
          <Button size="sm" className="h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700" onClick={onActivate}>
            <Check className="w-3 h-3 mr-1" /> Activate (create agent)
          </Button>
        )}
        {skill.status !== "ready" && skill.status !== "pasted" && !canActivate && (
          <Button size="sm" className="h-6 text-[10px]" onClick={() => onStatus("ready")}>
            <Check className="w-3 h-3 mr-1" /> Ready
          </Button>
        )}
        {skill.status === "ready" && (
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => onStatus("pasted")}>
            Mark pasted
          </Button>
        )}
      </div>
      {expanded && (
        <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap p-3 bg-muted/10 border-t max-h-[60vh] overflow-y-auto">
          {skill.markdown}
        </pre>
      )}
    </div>
  );
}
