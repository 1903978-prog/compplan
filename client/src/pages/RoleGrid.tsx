import { useStore } from "@/hooks/use-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { RoleGridRow } from "@shared/schema";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function RoleGridPage() {
  const { roleGrid, updateRoleGrid, resetDefaults } = useStore();
  const { toast } = useToast();
  
  // Local state for editing to avoid constant store updates on every keystroke
  const [gridState, setGridState] = useState(roleGrid);
  const [hasChanges, setHasChanges] = useState(false);

  const handleCellChange = (index: number, field: keyof RoleGridRow, value: string | number) => {
    const newGrid = [...gridState];
    // @ts-ignore - dynamic key assignment
    newGrid[index][field] = value;
    setGridState(newGrid);
    setHasChanges(true);
  };

  const handleSave = async () => {
    await updateRoleGrid(gridState);
    setHasChanges(false);
    toast({ title: "Role Grid configuration saved" });
  };

  const handleReset = async () => {
    if (confirm("Reset to default configuration? This will wipe custom changes.")) {
      await resetDefaults();
      window.location.reload();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Grid Configuration"
        description="Define role progression paths, salary bands, and promotion timing."
        actions={
          <div className="flex gap-2">
             <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset Defaults
             </Button>
             <Button onClick={handleSave} disabled={!hasChanges} className={hasChanges ? "animate-pulse" : ""}>
                Save Changes
             </Button>
          </div>
        }
      />

      <Card className="overflow-hidden border-border shadow-md">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[80px]">Code</TableHead>
                <TableHead className="min-w-[150px]">Role Name</TableHead>
                <TableHead>Next Role</TableHead>
                <TableHead className="text-center bg-purple-50/50">Fast (Yrs)</TableHead>
                <TableHead className="text-center bg-blue-50/50">Norm (Yrs)</TableHead>
                <TableHead className="text-center bg-orange-50/50">Slow (Yrs)</TableHead>
                <TableHead className="text-center border-l">Gross fixed min (k€)</TableHead>
                <TableHead className="text-center">Gross fixed max (k€)</TableHead>
                <TableHead className="text-center border-l text-muted-foreground font-normal">RAL min (k€)</TableHead>
                <TableHead className="text-center text-muted-foreground font-normal">RAL max (k€)</TableHead>
                <TableHead className="text-center border-l">Bonus %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gridState.map((row, index) => (
                <TableRow key={row.role_code}>
                  <TableCell className="font-medium bg-muted/10">{row.role_code}</TableCell>
                  <TableCell>{row.role_name}</TableCell>
                  <TableCell>
                      <Input
                        value={row.next_role_code || ""}
                        onChange={(e) => handleCellChange(index, "next_role_code", e.target.value)}
                        className="h-8 w-20"
                        placeholder="-"
                      />
                  </TableCell>
                  <TableCell className="bg-purple-50/30">
                     <Input
                        type="number" step="0.5"
                        value={row.promo_years_fast}
                        onChange={(e) => handleCellChange(index, "promo_years_fast", parseFloat(e.target.value))}
                        className="h-8 w-16 mx-auto text-center"
                      />
                  </TableCell>
                  <TableCell className="bg-blue-50/30">
                     <Input
                        type="number" step="0.5"
                        value={row.promo_years_normal}
                        onChange={(e) => handleCellChange(index, "promo_years_normal", parseFloat(e.target.value))}
                        className="h-8 w-16 mx-auto text-center"
                      />
                  </TableCell>
                  <TableCell className="bg-orange-50/30">
                     <Input
                        type="number" step="0.5"
                        value={row.promo_years_slow}
                        onChange={(e) => handleCellChange(index, "promo_years_slow", parseFloat(e.target.value))}
                        className="h-8 w-16 mx-auto text-center"
                      />
                  </TableCell>
                  <TableCell className="border-l">
                     <Input
                        type="number" step="100"
                        value={Math.round(row.gross_fixed_min_month * row.months_paid / 1000 * 10) / 10}
                        onChange={(e) => {
                          const annualK = parseFloat(e.target.value);
                          if (!isNaN(annualK)) handleCellChange(index, "gross_fixed_min_month", Math.round(annualK * 1000 / row.months_paid));
                        }}
                        className="h-8 w-20 mx-auto text-right font-mono"
                      />
                  </TableCell>
                  <TableCell>
                     <Input
                        type="number" step="100"
                        value={Math.round(row.gross_fixed_max_month * row.months_paid / 1000 * 10) / 10}
                        onChange={(e) => {
                          const annualK = parseFloat(e.target.value);
                          if (!isNaN(annualK)) handleCellChange(index, "gross_fixed_max_month", Math.round(annualK * 1000 / row.months_paid));
                        }}
                        className="h-8 w-20 mx-auto text-right font-mono"
                      />
                  </TableCell>
                  <TableCell className="border-l">
                     <Input
                        type="number"
                        value={row.ral_min_k}
                        onChange={(e) => handleCellChange(index, "ral_min_k", parseFloat(e.target.value))}
                        className="h-8 w-20 mx-auto text-right font-mono text-muted-foreground"
                      />
                  </TableCell>
                  <TableCell>
                     <Input
                        type="number"
                        value={row.ral_max_k}
                        onChange={(e) => handleCellChange(index, "ral_max_k", parseFloat(e.target.value))}
                        className="h-8 w-20 mx-auto text-right font-mono text-muted-foreground"
                      />
                  </TableCell>
                  <TableCell className="border-l">
                     <div className="relative w-20 mx-auto">
                        <Input
                            type="number"
                            value={row.bonus_pct}
                            onChange={(e) => handleCellChange(index, "bonus_pct", parseFloat(e.target.value))}
                            className="h-8 w-full pr-6 text-right"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                     </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
