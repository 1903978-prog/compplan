import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Cpu, Check, Sparkles, Zap, Plug, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActiveAIModel } from "@/hooks/use-active-ai-model";
import {
  AI_MODELS, PROVIDER_LABEL, modelsForProvider,
  type AIProvider, type AIModel,
} from "@/lib/aiModels";

// Shape returned by GET /api/ai/providers — mirrors server/aiProviders.ts providerStatus()
type ProviderStatus = Record<AIProvider, { configured: boolean; envVar: string }>;

// Shape returned by POST /api/ai/test (success / error branches)
interface AITestResponse {
  ok: boolean;
  text?: string;
  provider?: AIProvider;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: string;
  envVar?: string;
  status?: number;
  message?: string;
}

// ── AI Model selector ───────────────────────────────────────────────────────
// Admin submenu that lets the user pick which provider + model the app
// should default to. The selection is persisted in localStorage (via the
// useActiveAIModel hook) and reflected in a badge in the top navigation
// bar. Price-per-token table at the bottom so the user can trade off
// quality vs. cost before committing to a change.
//
// Note: this page records the PREFERENCE. Wiring every server-side AI
// call to read this preference is a separate effort (each call site —
// proposalAI, proposalBriefs, AI summaries — currently hardcodes its
// model). Today this page is the single place to change that default
// going forward; existing code paths keep their current hardcoded models
// until each is migrated to accept the selected model id.

export default function AdminAIModels() {
  const { toast } = useToast();
  const { modelId, model, setModelId } = useActiveAIModel();

  // Provider defaults to whatever provider the current model belongs to
  // so the select is immediately consistent on first mount.
  const [provider, setProvider] = useState<AIProvider>(model?.provider ?? "anthropic");
  const [pendingId, setPendingId] = useState<string>(modelId);

  // Live provider status — which providers actually have their API key
  // configured on the server. Fetched once on mount; updated when a test
  // call succeeds in case the user just set an env var and is watching
  // the badge flip from "not configured" to "ok".
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  useEffect(() => {
    fetch("/api/ai/providers", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(setProviderStatus)
      .catch(() => setProviderStatus(null));
  }, []);

  // Per-provider test-connection state: result of the last "Test
  // connection" click, keyed by provider so the user can test each one.
  const [testing, setTesting] = useState<AIProvider | null>(null);
  const [testResult, setTestResult] = useState<Record<AIProvider, AITestResponse | null>>(
    { anthropic: null, openai: null, gemini: null },
  );
  const runTest = async (p: AIProvider) => {
    // Use the model the user has picked for this provider, falling back
    // to the cheapest option so the test is free-ish.
    const pickedInProvider = modelsForProvider(p).find(m => m.id === pendingId) ?? modelsForProvider(p)[0];
    if (!pickedInProvider) {
      toast({ title: "No model defined for this provider", variant: "destructive" });
      return;
    }
    setTesting(p);
    setTestResult(r => ({ ...r, [p]: null }));
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: p,
          model: pickedInProvider.id,
          prompt: "In one short sentence, confirm this connection works by replying with the current provider name and today's status.",
          system: "You are a connection tester. Keep replies under 20 words.",
          maxTokens: 80,
        }),
      });
      const body: AITestResponse = await res.json();
      setTestResult(r => ({ ...r, [p]: body }));
      if (body.ok) {
        toast({ title: `${PROVIDER_LABEL[p]}: connection ok`, description: body.text?.slice(0, 140) });
        // Connection succeeded → the key is definitely configured. Reflect it.
        setProviderStatus(s => s ? { ...s, [p]: { ...s[p], configured: true } } : s);
      } else if (body.error === "missing_api_key") {
        toast({
          title: `${PROVIDER_LABEL[p]}: API key missing`,
          description: `Set ${body.envVar} in the server environment.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${PROVIDER_LABEL[p]}: test failed`,
          description: body.message?.slice(0, 200) ?? body.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Test request failed", description: e?.message ?? "Network error", variant: "destructive" });
    } finally {
      setTesting(null);
    }
  };

  // When the user changes provider, auto-select that provider's first
  // model unless the current pendingId already belongs to the new one.
  const handleProviderChange = (p: AIProvider) => {
    setProvider(p);
    const firstOfProvider = modelsForProvider(p)[0];
    if (firstOfProvider && !modelsForProvider(p).some(m => m.id === pendingId)) {
      setPendingId(firstOfProvider.id);
    }
  };

  const saveSelection = () => {
    setModelId(pendingId);
    const chosen = AI_MODELS.find(m => m.id === pendingId);
    toast({
      title: "Default model saved",
      description: chosen ? `${chosen.label} (${chosen.abbrev}) is now the active model.` : "Selection updated.",
    });
  };

  const fmtUSD = (n: number) => `$${n.toFixed(n < 1 ? 2 : 2).replace(/\.?0+$/, "")}`;
  const isActive = (m: AIModel) => m.id === modelId;
  const isPending = (m: AIModel) => m.id === pendingId;
  const pending = AI_MODELS.find(m => m.id === pendingId);
  const providerModels = modelsForProvider(provider);

  return (
    <div>
      <PageHeader
        title="AI Models"
        description="Choose which provider + model the app uses by default for its AI jobs, and compare per-token pricing."
      />

      {/* Migration status banner — tells the user which server-side call
          sites actually honor the model picker. Kept accurate as each
          call site is migrated to generateJSON / generateText. */}
      <div className="mb-4 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
        <div className="font-bold uppercase tracking-wide text-[10px] mb-1">✓ Model picker active for proposal generation</div>
        <div className="space-y-1">
          <div>
            <strong>Migrated (respect your selection):</strong> Proposal generation
            (<code className="text-[11px] bg-white px-1 rounded">/api/proposals/:id/analyze</code>) — calls the provider + model you pick below.
          </div>
          <div>
            <strong>Not yet migrated (still hardcoded Claude Sonnet 4.5):</strong> Briefing extraction, slide analysis, reference-image analysis, candidate summaries.
          </div>
          <div className="italic text-emerald-800/80">
            The "Test connection" button on each provider card hits each vendor's real API end-to-end — use it to verify your API keys before switching the picker.
          </div>
        </div>
      </div>

      {/* Provider status + test-connection grid — the part of this page
          that actually does something useful today. One card per provider
          with a configured/not-configured badge and a "Test connection"
          button that POSTs to /api/ai/test with the smallest cheapest
          model so the test is ~free. */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        {(Object.keys(PROVIDER_LABEL) as AIProvider[]).map(p => {
          const status = providerStatus?.[p];
          const result = testResult[p];
          const isTesting = testing === p;
          return (
            <Card key={p} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plug className="w-4 h-4 text-primary" />
                  <span className="font-bold text-sm">{PROVIDER_LABEL[p]}</span>
                </div>
                {status == null ? (
                  <span className="text-[10px] text-muted-foreground italic">checking…</span>
                ) : status.configured ? (
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded px-2 py-0.5">Configured</span>
                ) : (
                  <span className="text-[10px] font-bold bg-red-100 text-red-700 rounded px-2 py-0.5" title={`Set ${status.envVar} in the server env`}>
                    Not configured
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                env: <span className="text-foreground">{status?.envVar ?? "—"}</span>
              </div>
              <Button
                size="sm" variant="outline" className="w-full h-8 text-xs"
                disabled={isTesting || (status != null && !status.configured)}
                onClick={() => runTest(p)}
              >
                {isTesting ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Testing…</>
                ) : (
                  <><Plug className="w-3 h-3 mr-1" /> Test connection</>
                )}
              </Button>
              {result && (
                result.ok ? (
                  <div className="rounded bg-emerald-50 border border-emerald-200 p-2 text-[10px] text-emerald-900 space-y-1">
                    <div className="font-semibold">✓ OK · {result.model}</div>
                    {result.text && <div className="italic leading-snug">"{result.text.slice(0, 160)}{result.text.length > 160 ? "…" : ""}"</div>}
                    {result.usage?.total_tokens != null && (
                      <div className="font-mono text-[9px] text-emerald-800/70">
                        {result.usage.input_tokens ?? "?"} in · {result.usage.output_tokens ?? "?"} out · {result.usage.total_tokens} total tokens
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded bg-red-50 border border-red-200 p-2 text-[10px] text-red-900 space-y-1">
                    <div className="font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {result.error === "missing_api_key" ? "Missing API key"
                        : result.error === "provider_error" ? `Provider ${result.status ?? "error"}`
                        : "Error"}
                    </div>
                    <div className="leading-snug break-words">{result.message ?? result.envVar ?? "See server logs"}</div>
                  </div>
                )
              )}
            </Card>
          );
        })}
      </div>

      <div className="space-y-6">
        {/* Selector card ------------------------------------------------ */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">Active model selection</h3>
            {model && (
              <span className="text-[10px] font-semibold bg-primary/10 text-primary rounded px-2 py-0.5 ml-auto">
                Currently active: <span className="font-mono">{model.abbrev}</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Provider</label>
              <Select value={provider} onValueChange={v => handleProviderChange(v as AIProvider)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROVIDER_LABEL) as AIProvider[]).map(p => (
                    <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Model</label>
              <Select value={pendingId} onValueChange={setPendingId}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {providerModels.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                      {m.recommendedFor?.[0] && (
                        <span className="text-[10px] text-muted-foreground ml-2">· {m.recommendedFor[0]}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {pending && (
            <div className="rounded border bg-muted/20 p-3 space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-semibold">{pending.label}</span>
                <span className="text-[10px] font-mono bg-foreground text-background px-1.5 py-0.5 rounded">{pending.abbrev}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{(pending.contextTokens / 1000).toLocaleString()}k context</span>
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground font-mono">
                <span>Input: <span className="text-foreground font-semibold">{fmtUSD(pending.inputPerM)}</span> / 1M</span>
                <span>Output: <span className="text-foreground font-semibold">{fmtUSD(pending.outputPerM)}</span> / 1M</span>
                {pending.cachedReadPerM != null && (
                  <span>Cache read: <span className="text-foreground font-semibold">{fmtUSD(pending.cachedReadPerM)}</span> / 1M</span>
                )}
              </div>
              {pending.notes && (
                <div className="text-[10px] italic text-amber-700/80">⚠ {pending.notes}</div>
              )}
              {pending.recommendedFor && pending.recommendedFor.length > 0 && (
                <div className="flex gap-1 flex-wrap pt-1">
                  {pending.recommendedFor.map(tag => (
                    <span key={tag} className="text-[9px] bg-primary/10 text-primary rounded px-1.5 py-0.5">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {pendingId !== modelId && (
              <Button variant="ghost" onClick={() => setPendingId(modelId)}>Reset</Button>
            )}
            <Button onClick={saveSelection} disabled={pendingId === modelId}>
              <Check className="w-4 h-4 mr-1" /> Save selection
            </Button>
          </div>
        </Card>

        {/* Price-per-token comparison table -------------------------------- */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">All models — price per million tokens</h3>
            <span className="text-[10px] text-muted-foreground ml-auto italic">Prices in USD · last updated April 2026</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-center">Abbrev</TableHead>
                  <TableHead className="text-right">Input /1M</TableHead>
                  <TableHead className="text-right">Output /1M</TableHead>
                  <TableHead className="text-right">Cache read /1M</TableHead>
                  <TableHead className="text-right">Context</TableHead>
                  <TableHead>Best for</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AI_MODELS.map(m => {
                  const active = isActive(m);
                  const pend = isPending(m) && !active;
                  return (
                    <TableRow key={m.id}
                      className={`cursor-pointer ${active ? "bg-emerald-50" : pend ? "bg-amber-50" : ""}`}
                      onClick={() => {
                        setProvider(m.provider);
                        setPendingId(m.id);
                      }}
                    >
                      <TableCell className="text-xs text-muted-foreground">{PROVIDER_LABEL[m.provider]}</TableCell>
                      <TableCell className="font-medium text-sm">
                        {m.label}
                        {active && <span className="ml-2 text-[9px] font-bold uppercase bg-emerald-600 text-white px-1.5 py-0.5 rounded">active</span>}
                        {pend && <span className="ml-2 text-[9px] font-bold uppercase bg-amber-500 text-white px-1.5 py-0.5 rounded">pending</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-mono text-[10px] bg-foreground text-background px-1.5 py-0.5 rounded">{m.abbrev}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtUSD(m.inputPerM)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtUSD(m.outputPerM)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {m.cachedReadPerM != null ? fmtUSD(m.cachedReadPerM) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                        {m.contextTokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        {m.recommendedFor?.join(" · ") ?? m.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="text-[10px] text-muted-foreground italic border-t pt-2">
            Click a row to pre-select it. Prices are list rates from the official provider docs; volume discounts and
            batch APIs (when applicable) can reduce them further. Cache-read column applies only when the prompt-caching
            feature is enabled on a request.
          </div>
        </Card>
      </div>
    </div>
  );
}
