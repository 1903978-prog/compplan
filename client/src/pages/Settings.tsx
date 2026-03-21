import { useStore } from "@/hooks/use-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { adminSettingsSchema, type AdminSettings } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

import { Plus, Trash2 } from "lucide-react";

export default function Settings() {
  const { settings, updateSettings } = useStore();
  const { toast } = useToast();

  const form = useForm<AdminSettings>({
    resolver: zodResolver(adminSettingsSchema),
    defaultValues: settings,
  });

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
            </div>

            <div className="space-y-2">
                <Label>Promotion Windows (MM-DD)</Label>
                {/* 
                   Handling array input simply for this demo. 
                   Real app might use a tag input or multi-field.
                   We'll register it as a transform or just use the default array handling if we trust the user not to break it 
                   Actually, let's just make it read-only for now or simple inputs.
                */}
                <div className="flex gap-2">
                    {settings.promotion_windows.map((w, idx) => (
                        <div key={idx} className="bg-secondary px-3 py-2 rounded-md font-mono text-sm border">
                            {w}
                        </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">Fixed promo dates (Currently read-only in UI)</p>
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
                    form.setValue("tests", [...current, { id: Math.random().toString(36).substr(2, 9), name: "", due_from_hire_months: 0 }]);
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
                    <div className="w-32 space-y-2">
                      <Label>Due (Months)</Label>
                      <Input type="number" {...form.register(`tests.${index}.due_from_hire_months`, { valueAsNumber: true })} />
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
