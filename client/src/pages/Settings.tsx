import { useStore } from "@/hooks/use-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { adminSettingsSchema, type AdminSettings } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

import { Plus, Trash2 } from "lucide-react";

const PROMO_ROLES = ["BA", "A1", "A2", "S1", "S2", "C1", "C2", "EM1"] as const;

export default function Settings() {
  const { settings, updateSettings } = useStore();
  const { toast } = useToast();

  const form = useForm<AdminSettings>({
    resolver: zodResolver(adminSettingsSchema),
    defaultValues: settings,
  });

  // Re-populate form whenever settings load from the API
  useEffect(() => {
    if (settings) form.reset(settings);
  }, [settings]);

  const onSubmit = async (data: AdminSettings) => {
    await updateSettings(data);
    toast({ title: "Settings updated successfully" });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader 
        title="Global Settings" 
        description="Configure application-wide assumptions and policy rules."
      />

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>Policy Assumptions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label>Net Factor</Label>
                    <Input 
                        type="number" 
                        step="0.01" 
                        {...form.register("net_factor", { valueAsNumber: true })} 
                    />
                    <p className="text-xs text-muted-foreground">Multiplier to estimate Net from Gross (e.g. 0.75)</p>
                </div>

                <div className="space-y-2">
                    <Label>Meal Voucher Days / Month</Label>
                    <Input 
                        type="number" 
                        {...form.register("meal_voucher_days_per_month", { valueAsNumber: true })} 
                    />
                </div>

                <div className="space-y-2">
                    <Label>Min Promotion Increase %</Label>
                    <div className="relative">
                        <Input 
                            type="number" 
                            {...form.register("min_promo_increase_pct", { valueAsNumber: true })} 
                            className="pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Minimum salary bump upon promotion</p>
                </div>

                <div className="space-y-2">
                    <Label>Window Tolerance (Days)</Label>
                    <Input
                        type="number"
                        {...form.register("window_tolerance_days", { valueAsNumber: true })}
                    />
                    <p className="text-xs text-muted-foreground">Days to "snap" to a promo window if close</p>
                </div>

                <div className="space-y-2">
                    <Label>Fast Track Threshold (Rate &gt;)</Label>
                    <Input
                        type="number"
                        step="0.1"
                        min="5"
                        max="10"
                        {...form.register("track_fast_threshold", { valueAsNumber: true })}
                    />
                    <p className="text-xs text-muted-foreground">Rate above this → Fast track (e.g. 8.5)</p>
                </div>

                <div className="space-y-2">
                    <Label>Slow Track Threshold (Rate &gt;)</Label>
                    <Input
                        type="number"
                        step="0.1"
                        min="5"
                        max="10"
                        {...form.register("track_slow_threshold", { valueAsNumber: true })}
                    />
                    <p className="text-xs text-muted-foreground">Rate above this → On Track; below → Slow (e.g. 7.0)</p>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Promotion Windows (Month)</Label>
                <div className="flex flex-wrap gap-2 items-center">
                    {(form.watch("promotion_windows") ?? []).map((w, idx) => {
                      const month = parseInt(w.split("-")[0], 10);
                      return (
                        <div key={idx} className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="1"
                            max="12"
                            value={month}
                            onChange={(e) => {
                              const m = Math.min(12, Math.max(1, parseInt(e.target.value) || 1));
                              const mm = String(m).padStart(2, "0");
                              const current = form.getValues("promotion_windows") ?? [];
                              const updated = [...current];
                              updated[idx] = `${mm}-01`;
                              form.setValue("promotion_windows", updated);
                            }}
                            className="h-8 w-16 text-center font-mono"
                          />
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive text-xs px-1"
                            onClick={() => {
                              const current = form.getValues("promotion_windows") ?? [];
                              form.setValue("promotion_windows", current.filter((_, i) => i !== idx));
                            }}
                          >✕</button>
                        </div>
                      );
                    })}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const current = form.getValues("promotion_windows") ?? [];
                        form.setValue("promotion_windows", [...current, "01-01"]);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">Enter month numbers (1–12). Effective promo date snaps to the next window.</p>
            </div>

            <div className="space-y-4 pt-4 border-t">
              <div className="flex justify-between items-center">
                <Label className="text-base font-bold">Promotion Required Tests</Label>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const current = form.getValues("tests") || [];
                    form.setValue("tests", [...current, { id: Math.random().toString(36).substr(2, 9), name: "", required_for_role: "" }]);
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Test
                </Button>
              </div>
              <div className="space-y-3">
                {form.watch("tests")?.map((test, index) => (
                  <div key={test.id} className="flex gap-4 items-end p-3 border rounded-lg bg-muted/10">
                    <div className="flex-1 space-y-2">
                      <Label>Test Name</Label>
                      <Input {...form.register(`tests.${index}.name`)} />
                    </div>
                    <div className="w-40 space-y-2">
                      <Label>Required for role</Label>
                      <Select
                        value={form.watch(`tests.${index}.required_for_role`) ?? ""}
                        onValueChange={(v) => form.setValue(`tests.${index}.required_for_role`, v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Pick role…" />
                        </SelectTrigger>
                        <SelectContent>
                          {PROMO_ROLES.map(r => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon"
                      onClick={() => {
                        const current = form.getValues("tests");
                        form.setValue("tests", current.filter((_, i) => i !== index));
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 flex justify-end">
                <Button type="submit">Save Settings</Button>
            </div>

          </CardContent>
        </Card>
      </form>
    </div>
  );
}
