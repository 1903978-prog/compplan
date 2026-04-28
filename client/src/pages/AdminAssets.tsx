import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Boxes } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Admin → Asset Types ────────────────────────────────────────────────────
// Two-column layout. Left: list of existing types with delete + edit.
// Right: form to add a new type. Type names cascade onto assets — to keep
// data simple we don't auto-rename; renames update the asset_types row but
// existing assets keep their stored asset_type until manually re-tagged.
//
// has_license_key flag: when ON, the assets-page form for this type shows
// a License Key input (used for software like ThinkCell). When OFF, it
// shows only identifier + details (used for hardware like PCs).

interface AssetType {
  id: number;
  name: string;
  has_license_key: number;
  identifier_hint: string | null;
  details_hint: string | null;
  created_at: string;
}

export default function AdminAssets() {
  const { toast } = useToast();
  const [types, setTypes] = useState<AssetType[]>([]);
  const [loading, setLoading] = useState(true);

  // New-type form state
  const [newName, setNewName] = useState("");
  const [newHasLicense, setNewHasLicense] = useState(false);
  const [newIdHint, setNewIdHint] = useState("");
  const [newDetailsHint, setNewDetailsHint] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/asset-types", { credentials: "include" });
      const data = await r.json();
      setTypes(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Failed to load asset types", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function addType() {
    if (!newName.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      const r = await fetch("/api/asset-types", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          has_license_key: newHasLicense,
          identifier_hint: newIdHint.trim() || null,
          details_hint: newDetailsHint.trim() || null,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${r.status}`);
      }
      setNewName(""); setNewHasLicense(false); setNewIdHint(""); setNewDetailsHint("");
      toast({ title: "Asset type added" });
      await load();
    } catch (e) {
      toast({ title: "Failed to add", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function deleteType(t: AssetType) {
    if (!confirm(`Delete asset type "${t.name}"? This fails if any asset still references it.`)) return;
    try {
      const r = await fetch(`/api/asset-types/${t.id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${r.status}`);
      }
      toast({ title: "Deleted" });
      await load();
    } catch (e) {
      toast({ title: "Failed to delete", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function patchType(t: AssetType, patch: Partial<AssetType>) {
    setTypes(prev => prev.map(x => x.id === t.id ? { ...x, ...patch } : x));
    try {
      const r = await fetch(`/api/asset-types/${t.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
      await load();
    }
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Boxes className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asset Types</h1>
          <p className="text-sm text-muted-foreground">
            Categories of company assets you can assign to employees (PCs, software licenses, monitors, phones, …). Assets themselves are managed on the Employees page.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Existing types */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Existing types ({types.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="text-xs text-muted-foreground italic">Loading…</div>
            ) : types.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No types yet — add one on the right.</div>
            ) : types.map(t => (
              <div key={t.id} className="border rounded p-3 space-y-2 bg-card">
                <div className="flex items-center gap-2">
                  <Input
                    value={t.name}
                    onChange={(e) => setTypes(prev => prev.map(x => x.id === t.id ? { ...x, name: e.target.value } : x))}
                    onBlur={() => patchType(t, { name: t.name })}
                    className="h-8 text-sm font-semibold"
                  />
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => deleteType(t)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={t.has_license_key === 1}
                    onChange={(e) => patchType(t, { has_license_key: e.target.checked ? 1 : 0 })}
                    className="h-3.5 w-3.5"
                  />
                  <span>Has license key</span>
                  {t.has_license_key === 1 && <Badge variant="outline" className="text-[10px]">software</Badge>}
                </label>
                <Input
                  value={t.identifier_hint ?? ""}
                  onChange={(e) => setTypes(prev => prev.map(x => x.id === t.id ? { ...x, identifier_hint: e.target.value } : x))}
                  onBlur={() => patchType(t, { identifier_hint: t.identifier_hint ?? null })}
                  placeholder="Identifier hint (e.g. LAP05)"
                  className="h-7 text-xs"
                />
                <Input
                  value={t.details_hint ?? ""}
                  onChange={(e) => setTypes(prev => prev.map(x => x.id === t.id ? { ...x, details_hint: e.target.value } : x))}
                  onBlur={() => patchType(t, { details_hint: t.details_hint ?? null })}
                  placeholder="Details hint (e.g. Lenovo V15 G4)"
                  className="h-7 text-xs"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Add new type */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Add a new type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Phone, Monitor, Adobe license"
                className="h-9 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={newHasLicense}
                onChange={(e) => setNewHasLicense(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Has license key (software)</span>
            </label>
            <div className="space-y-1">
              <Label className="text-xs">Identifier hint (optional)</Label>
              <Input
                value={newIdHint}
                onChange={(e) => setNewIdHint(e.target.value)}
                placeholder="e.g. LAP05, MON02"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Details hint (optional)</Label>
              <Input
                value={newDetailsHint}
                onChange={(e) => setNewDetailsHint(e.target.value)}
                placeholder="e.g. Lenovo V15 G4"
                className="h-9 text-sm"
              />
            </div>
            <Button onClick={addType} disabled={adding || !newName.trim()}>
              <Plus className="w-4 h-4 mr-2" /> {adding ? "Adding…" : "Add type"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
