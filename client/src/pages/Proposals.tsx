import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { Plus, Trash2, ArrowRight, ArrowLeft, Loader2, Download, Pencil, Eye, FileText, Upload, Check, X, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TeamMember { role: string; count: number; days_per_week: number }
interface PriceBreakdown { role: string; count: number; daily_rate: number; days: number; total: number }
interface ProposalOption {
  name: string;
  duration_weeks: number;
  staffing_mode: string;
  team: TeamMember[];
  scope: string[];
  deliverables: string[];
  cadence: string;
  assumptions: string[];
  price_breakdown: PriceBreakdown[];
  total_fee: number;
}

interface Proposal {
  id?: number;
  company_name: string;
  website?: string | null;
  transcript?: string | null;
  notes?: string | null;
  revenue?: number | null;
  ebitda_margin?: number | null;
  scope_perimeter?: string | null;
  objective?: string | null;
  urgency?: string | null;
  company_summary?: string | null;
  proposal_title?: string | null;
  why_now?: string | null;
  objective_statement?: string | null;
  scope_statement?: string | null;
  recommended_team?: string | null;
  staffing_intensity?: string | null;
  options: ProposalOption[];
  ai_analysis?: any;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Template {
  id: number;
  name: string;
  file_size: number;
  is_active: number;
  uploaded_at: string;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(val);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const URGENCY_OPTIONS = ["Low", "Medium", "High", "Critical"];

// ── Main Component ────────────────────────────────────────────────────────────

export default function Proposals() {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [view, setView] = useState<"list" | "wizard">("list");
  const [step, setStep] = useState(1); // 1=input, 2=analyzing, 3=edit architecture, 4=generate
  const [current, setCurrent] = useState<Proposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Form state for step 1
  const [form, setForm] = useState({
    company_name: "",
    website: "",
    transcript: "",
    notes: "",
    revenue: "",
    ebitda_margin: "",
    scope_perimeter: "",
    objective: "",
    urgency: "Medium",
  });

  useEffect(() => {
    loadProposals();
    loadTemplates();
  }, []);

  async function loadProposals() {
    const res = await fetch("/api/proposals", { credentials: "include" });
    if (res.ok) setProposals(await res.json());
  }

  async function loadTemplates() {
    const res = await fetch("/api/proposal-templates", { credentials: "include" });
    if (res.ok) setTemplates(await res.json());
  }

  function startNew() {
    setForm({ company_name: "", website: "", transcript: "", notes: "", revenue: "", ebitda_margin: "", scope_perimeter: "", objective: "", urgency: "Medium" });
    setCurrent(null);
    setStep(1);
    setView("wizard");
  }

  function openProposal(p: Proposal) {
    setCurrent(p);
    if (p.status === "draft") {
      setForm({
        company_name: p.company_name,
        website: p.website || "",
        transcript: p.transcript || "",
        notes: p.notes || "",
        revenue: p.revenue ? String(p.revenue) : "",
        ebitda_margin: p.ebitda_margin ? String(p.ebitda_margin) : "",
        scope_perimeter: p.scope_perimeter || "",
        objective: p.objective || "",
        urgency: p.urgency || "Medium",
      });
      setStep(1);
    } else {
      setStep(3);
    }
    setView("wizard");
  }

  async function deleteProposal(id: number) {
    await fetch(`/api/proposals/${id}`, { method: "DELETE", credentials: "include" });
    setProposals(prev => prev.filter(p => p.id !== id));
    toast({ title: "Proposal deleted" });
  }

  // Step 1: Save draft & trigger analysis
  async function handleSubmitInputs() {
    if (!form.company_name.trim()) {
      toast({ title: "Company name is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const body = {
      company_name: form.company_name,
      website: form.website || null,
      transcript: form.transcript || null,
      notes: form.notes || null,
      revenue: form.revenue ? Number(form.revenue) : null,
      ebitda_margin: form.ebitda_margin ? Number(form.ebitda_margin) : null,
      scope_perimeter: form.scope_perimeter || null,
      objective: form.objective || null,
      urgency: form.urgency || null,
      status: "draft",
      options: [],
      created_at: current?.created_at || now,
      updated_at: now,
    };

    try {
      let saved: Proposal;
      if (current?.id) {
        const res = await fetch(`/api/proposals/${current.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        saved = await res.json();
      } else {
        const res = await fetch("/api/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        saved = await res.json();
      }
      setCurrent(saved);
      setSaving(false);

      // Move to step 2: analyzing
      setStep(2);
      setAnalyzing(true);

      const analyzeRes = await fetch(`/api/proposals/${saved.id}/analyze`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const analyzed = await analyzeRes.json();
      setCurrent(analyzed);
      setAnalyzing(false);
      setStep(3);
      loadProposals();
    } catch (err: any) {
      setSaving(false);
      setAnalyzing(false);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  // Step 3: Save edits to proposal
  async function saveEdits() {
    if (!current?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, updated_at: new Date().toISOString() }),
      });
      const updated = await res.json();
      setCurrent(updated);
      loadProposals();
      toast({ title: "Proposal saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setSaving(false);
  }

  // Step 4: Generate deck
  async function generateDeck() {
    if (!current?.id) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}/generate-deck`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error("Generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Eendigo_Proposal_${current.company_name.replace(/[^a-zA-Z0-9]/g, "_")}.pptx`;
      a.click();
      URL.revokeObjectURL(url);

      // Mark finalized
      await fetch(`/api/proposals/${current.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, status: "finalized", updated_at: new Date().toISOString() }),
      });
      loadProposals();
      toast({ title: "Deck downloaded!" });
    } catch {
      toast({ title: "Deck generation failed", variant: "destructive" });
    }
    setGenerating(false);
  }

  // Template upload
  async function handleTemplateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const res = await fetch("/api/proposal-templates", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          file_data: base64,
          file_size: file.size,
          is_active: 0,
          uploaded_at: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        loadTemplates();
        toast({ title: "Template uploaded" });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function activateTemplate(id: number) {
    await fetch(`/api/proposal-templates/${id}/activate`, { method: "POST", credentials: "include" });
    loadTemplates();
    toast({ title: "Template activated" });
  }

  async function deleteTemplate(id: number) {
    await fetch(`/api/proposal-templates/${id}`, { method: "DELETE", credentials: "include" });
    loadTemplates();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (showTemplates) {
    return (
      <div>
        <PageHeader
          title="Proposal Templates"
          description="Manage PowerPoint templates for deck generation"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowTemplates(false)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <label>
                <Button asChild><span><Upload className="w-4 h-4 mr-1" /> Upload .pptx</span></Button>
                <input type="file" accept=".pptx" className="hidden" onChange={handleTemplateUpload} />
              </label>
            </div>
          }
        />
        <Card className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No templates uploaded yet</TableCell></TableRow>
              )}
              {templates.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{(t.file_size / 1024).toFixed(0)} KB</TableCell>
                  <TableCell>{formatDate(t.uploaded_at)}</TableCell>
                  <TableCell>
                    {t.is_active ? (
                      <span className="inline-flex items-center gap-1 text-green-600 font-medium"><Check className="w-4 h-4" /> Active</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => activateTemplate(t.id)}>Set Active</Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => deleteTemplate(t.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  if (view === "wizard") {
    return (
      <div>
        <PageHeader
          title={step === 1 ? "New Proposal" : current?.proposal_title || `Proposal: ${current?.company_name || ""}`}
          description={step === 1 ? "Enter client information" : step === 2 ? "AI is analyzing..." : "Review and edit proposal architecture"}
          actions={
            <Button variant="outline" onClick={() => { setView("list"); setStep(1); }}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to List
            </Button>
          }
        />

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {[
            { n: 1, label: "Input" },
            { n: 2, label: "Analysis" },
            { n: 3, label: "Architecture" },
            { n: 4, label: "Generate" },
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === n ? "bg-primary text-primary-foreground" :
                step > n ? "bg-green-500 text-white" :
                "bg-muted text-muted-foreground"
              }`}>
                {step > n ? <Check className="w-4 h-4" /> : n}
              </div>
              <span className={`text-sm ${step === n ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
              {n < 4 && <div className={`w-8 h-0.5 ${step > n ? "bg-green-500" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: Input form */}
        {step === 1 && (
          <Card className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Company Name *</label>
                <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Corp" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Website</label>
                <Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Revenue (EUR M)</label>
                <Input type="number" value={form.revenue} onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))} placeholder="150" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">EBITDA Margin %</label>
                <Input type="number" value={form.ebitda_margin} onChange={e => setForm(f => ({ ...f, ebitda_margin: e.target.value }))} placeholder="12" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Objective</label>
                <Input value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} placeholder="Improve commercial effectiveness..." />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Urgency</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.urgency}
                  onChange={e => setForm(f => ({ ...f, urgency: e.target.value }))}
                >
                  {URGENCY_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-1 block">Scope / Perimeter</label>
                <Textarea value={form.scope_perimeter} onChange={e => setForm(f => ({ ...f, scope_perimeter: e.target.value }))} placeholder="Which functions, geographies, products..." rows={2} />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-1 block">Call Transcript / Meeting Notes</label>
                <Textarea value={form.transcript} onChange={e => setForm(f => ({ ...f, transcript: e.target.value }))} placeholder="Paste call transcript or key notes..." rows={4} />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-1 block">Additional Notes</label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Anything else relevant..." rows={2} />
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button onClick={handleSubmitInputs} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                Analyze with AI
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Analyzing */}
        {step === 2 && (
          <Card className="p-12 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-lg font-medium">Claude is analyzing your inputs...</p>
            <p className="text-sm text-muted-foreground">Building proposal architecture with 3 options, team composition, pricing...</p>
          </Card>
        )}

        {/* Step 3: Editable Architecture */}
        {step === 3 && current && (
          <div className="space-y-6">
            {/* Summary fields */}
            <Card className="p-6 space-y-4">
              <h3 className="text-lg font-semibold">Proposal Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Proposal Title</label>
                  <Input value={current.proposal_title || ""} onChange={e => setCurrent(c => c ? { ...c, proposal_title: e.target.value } : c)} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Staffing Intensity</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={current.staffing_intensity || "moderate"}
                    onChange={e => setCurrent(c => c ? { ...c, staffing_intensity: e.target.value } : c)}
                  >
                    <option value="light">Light</option>
                    <option value="moderate">Moderate</option>
                    <option value="intensive">Intensive</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Company Summary</label>
                  <Textarea value={current.company_summary || ""} onChange={e => setCurrent(c => c ? { ...c, company_summary: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Why Now?</label>
                  <Textarea value={current.why_now || ""} onChange={e => setCurrent(c => c ? { ...c, why_now: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Objective Statement</label>
                  <Textarea value={current.objective_statement || ""} onChange={e => setCurrent(c => c ? { ...c, objective_statement: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Scope Statement</label>
                  <Textarea value={current.scope_statement || ""} onChange={e => setCurrent(c => c ? { ...c, scope_statement: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Recommended Team</label>
                  <Textarea value={current.recommended_team || ""} onChange={e => setCurrent(c => c ? { ...c, recommended_team: e.target.value } : c)} rows={2} />
                </div>
              </div>
            </Card>

            {/* 3 Option Cards */}
            <h3 className="text-lg font-semibold">Engagement Options</h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(current.options || []).map((opt, optIdx) => (
                <OptionCard
                  key={optIdx}
                  option={opt}
                  onChange={(updated) => {
                    setCurrent(c => {
                      if (!c) return c;
                      const newOpts = [...c.options];
                      newOpts[optIdx] = updated;
                      return { ...c, options: newOpts };
                    });
                  }}
                />
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Inputs
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={saveEdits} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                  Save Changes
                </Button>
                <Button onClick={async () => { await saveEdits(); setStep(4); }}>
                  Generate Deck <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Generate & Download */}
        {step === 4 && current && (
          <Card className="p-8 flex flex-col items-center gap-6">
            <FileText className="w-16 h-16 text-primary" />
            <h3 className="text-xl font-semibold">Ready to Generate Deck</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Your proposal for <strong>{current.company_name}</strong> is complete.
              Click below to generate and download the PowerPoint deck.
            </p>

            {/* Pricing summary */}
            <div className="w-full max-w-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Option</TableHead>
                    <TableHead className="text-center">Weeks</TableHead>
                    <TableHead className="text-right">Total Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(current.options || []).map((opt, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{opt.name}</TableCell>
                      <TableCell className="text-center">{opt.duration_weeks}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(opt.total_fee)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Edit Architecture
              </Button>
              <Button size="lg" onClick={generateDeck} disabled={generating}>
                {generating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
                Download PowerPoint
              </Button>
            </div>
          </Card>
        )}
      </div>
    );
  }

  // ── List View ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Internal proposal operating system"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowTemplates(true)}>
              <Upload className="w-4 h-4 mr-1" /> Templates
            </Button>
            <Button onClick={startNew}>
              <Plus className="w-4 h-4 mr-1" /> New Proposal
            </Button>
          </div>
        }
      />
      <Card className="p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Options</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No proposals yet. Click "New Proposal" to start.</TableCell></TableRow>
            )}
            {[...proposals].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(p => (
              <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openProposal(p)}>
                <TableCell className="font-medium">{p.company_name}</TableCell>
                <TableCell className="text-muted-foreground">{p.proposal_title || "—"}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.status === "finalized" ? "bg-green-100 text-green-700" :
                    p.status === "analyzed" ? "bg-blue-100 text-blue-700" :
                    "bg-gray-100 text-gray-700"
                  }`}>
                    {p.status}
                  </span>
                </TableCell>
                <TableCell>
                  {(p.options || []).length > 0
                    ? (p.options as ProposalOption[]).map(o => formatCurrency(o.total_fee)).join(" / ")
                    : "—"
                  }
                </TableCell>
                <TableCell>{formatDate(p.created_at)}</TableCell>
                <TableCell>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => openProposal(p)}><Eye className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteProposal(p.id!)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ── Option Card Sub-Component ─────────────────────────────────────────────────

function OptionCard({ option, onChange }: { option: ProposalOption; onChange: (o: ProposalOption) => void }) {
  const [editingScope, setEditingScope] = useState(false);
  const [editingDeliverables, setEditingDeliverables] = useState(false);

  function updateTeamMember(idx: number, field: keyof TeamMember, val: string) {
    const team = [...option.team];
    if (field === "role") {
      team[idx] = { ...team[idx], role: val };
    } else {
      team[idx] = { ...team[idx], [field]: Number(val) || 0 };
    }
    recalcPricing({ ...option, team });
  }

  function recalcPricing(opt: ProposalOption) {
    const RATES: Record<string, number> = { Partner: 7000, EM: 2800, ASC: 1200 };
    const price_breakdown = opt.team.map(m => {
      const rate = RATES[m.role] || 1200;
      const days = m.days_per_week * opt.duration_weeks;
      return { role: m.role, count: m.count, daily_rate: rate, days, total: rate * days * m.count };
    });
    const total_fee = price_breakdown.reduce((s, b) => s + b.total, 0);
    onChange({ ...opt, price_breakdown, total_fee });
  }

  return (
    <Card className="p-4 space-y-3 border-2 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-lg">{option.name}</h4>
        <span className="text-xl font-bold text-primary">{formatCurrency(option.total_fee)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Duration (weeks)</label>
          <Input
            type="number"
            value={option.duration_weeks}
            onChange={e => recalcPricing({ ...option, duration_weeks: Number(e.target.value) || 0 })}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Staffing Mode</label>
          <Input
            value={option.staffing_mode}
            onChange={e => onChange({ ...option, staffing_mode: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Team */}
      <div>
        <label className="text-xs text-muted-foreground font-medium">Team</label>
        <div className="space-y-1 mt-1">
          {option.team.map((m, i) => (
            <div key={i} className="grid grid-cols-3 gap-1">
              <Input value={m.role} onChange={e => updateTeamMember(i, "role", e.target.value)} className="h-7 text-xs" />
              <Input type="number" value={m.count} onChange={e => updateTeamMember(i, "count", e.target.value)} className="h-7 text-xs" placeholder="count" />
              <Input type="number" value={m.days_per_week} onChange={e => updateTeamMember(i, "days_per_week", e.target.value)} className="h-7 text-xs" placeholder="d/wk" />
            </div>
          ))}
        </div>
      </div>

      {/* Scope */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground font-medium">Scope</label>
          <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setEditingScope(!editingScope)}>
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        {editingScope ? (
          <Textarea
            value={option.scope.join("\n")}
            onChange={e => onChange({ ...option, scope: e.target.value.split("\n").filter(Boolean) })}
            rows={3}
            className="text-xs mt-1"
            placeholder="One item per line"
          />
        ) : (
          <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {option.scope.map((s, i) => <li key={i}>- {s}</li>)}
          </ul>
        )}
      </div>

      {/* Deliverables */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground font-medium">Deliverables</label>
          <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setEditingDeliverables(!editingDeliverables)}>
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        {editingDeliverables ? (
          <Textarea
            value={option.deliverables.join("\n")}
            onChange={e => onChange({ ...option, deliverables: e.target.value.split("\n").filter(Boolean) })}
            rows={3}
            className="text-xs mt-1"
            placeholder="One item per line"
          />
        ) : (
          <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {option.deliverables.map((d, i) => <li key={i}>- {d}</li>)}
          </ul>
        )}
      </div>

      {/* Cadence */}
      <div>
        <label className="text-xs text-muted-foreground">Cadence</label>
        <Input value={option.cadence} onChange={e => onChange({ ...option, cadence: e.target.value })} className="h-7 text-xs" />
      </div>

      {/* Price breakdown */}
      <div className="border-t pt-2 mt-2">
        <label className="text-xs text-muted-foreground font-medium">Price Breakdown</label>
        <div className="text-xs space-y-0.5 mt-1">
          {(option.price_breakdown || []).map((b, i) => (
            <div key={i} className="flex justify-between">
              <span>{b.role} ({b.count}x) - {b.days}d @ {formatCurrency(b.daily_rate)}</span>
              <span className="font-medium">{formatCurrency(b.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
