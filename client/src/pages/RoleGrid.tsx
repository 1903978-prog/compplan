import { useStore } from "@/hooks/use-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RoleGridRow } from "@shared/schema";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

// Lookup table: [ral_k, gross_piva_eur] - sorted by gross ascending for interpolation
const RAL_TABLE: [number, number][] = [
  [10, 11200], [12, 15200], [20, 22724], [21, 23503], [22, 24288],
  [23, 25312], [24, 26336], [25, 26964], [26, 27807], [27, 28559],
  [28, 29354], [29, 29619], [30, 30423], [31, 31246], [32, 31998],
  [33, 32654], [34, 33305], [35, 33808], [36, 34336], [37, 34992],
  [38, 35456], [40, 36660], [41, 37685], [42, 38041], [43, 39077],
  [44, 39404], [45, 40469], [46, 40777], [47, 41463], [48, 42238],
  [49, 43253], [50, 43557], [51, 44765], [52, 44921], [53, 46157],
  [54, 46324], [55, 47549], [56, 48245], [57, 48941], [58, 49092],
  [59, 50333], [60, 50486], [62, 52312], [61, 52848], [65, 54296],
  [63, 54320], [64, 55056], [70, 56000], [73, 57776], [80, 63280],
  [90, 69952], [100, 76608], [110, 83200], [120, 89952], [130, 96624],
  [140, 103280], [150, 109952], [160, 116624], [170, 123200], [180, 129920],
  [190, 136480], [200, 143200], [215, 152000],
];

function grossToRal(grossAnnual: number): number {
  if (grossAnnual <= RAL_TABLE[0][1]) return RAL_TABLE[0][0];
  if (grossAnnual >= RAL_TABLE[RAL_TABLE.length - 1][1]) return RAL_TABLE[RAL_TABLE.length - 1][0];
  for (let i = 0; i < RAL_TABLE.length - 1; i++) {
    const [ral1, gross1] = RAL_TABLE[i];
    const [ral2, gross2] = RAL_TABLE[i + 1];
    if (grossAnnual >= gross1 && grossAnnual <= gross2) {
      const t = (grossAnnual - gross1) / (gross2 - gross1);
      return Math.round((ral1 + t * (ral2 - ral1)) * 10) / 10;
    }
  }
  return RAL_TABLE[RAL_TABLE.length - 1][0];
}

export default function RoleGridPage() {
  const { roleGrid, updateRoleGrid } = useStore();
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

  const applyGrossMin = (grid: typeof gridState, index: number, annualEur: number) => {
    const row = grid[index];
    const monthlyGross = Math.round(annualEur / row.months_paid);
    const ral = grossToRal(annualEur);
    grid[index] = { ...grid[index], gross_fixed_min_month: monthlyGross, ral_min_k: ral };
  };

  const applyGrossMax = (grid: typeof gridState, index: number, annualEur: number) => {
    const row = grid[index];
    const monthlyGross = Math.round(annualEur / row.months_paid);
    const ral = grossToRal(annualEur);
    grid[index] = { ...grid[index], gross_fixed_max_month: monthlyGross, ral_max_k: ral };
  };

  const handleGrossChange = (index: number, isMin: boolean, annualK: number) => {
    if (isNaN(annualK)) return;
    const newGrid = [...gridState];
    if (isMin) applyGrossMin(newGrid, index, annualK * 1000);
    else applyGrossMax(newGrid, index, annualK * 1000);
    setGridState(newGrid);
    setHasChanges(true);
  };

  const handleMinIncreaseChange = (index: number, pct: number) => {
    if (isNaN(pct) || index === 0) return;
    pct = Math.round(pct);
    const prev = gridState[index - 1];
    const prevMinAnnual = prev.gross_fixed_min_month * prev.months_paid;
    const newMinAnnual = Math.round(prevMinAnnual * (1 + pct / 100));
    const newGrid = [...gridState];
    applyGrossMin(newGrid, index, newMinAnnual);
    setGridState(newGrid);
    setHasChanges(true);
  };

  const handleMaxVsMinChange = (index: number, pct: number) => {
    if (isNaN(pct)) return;
    pct = Math.round(pct);
    const row = gridState[index];
    const curMinAnnual = row.gross_fixed_min_month * row.months_paid;
    const newMaxAnnual = Math.round(curMinAnnual * (1 + pct / 100));
    const newGrid = [...gridState];
    applyGrossMax(newGrid, index, newMaxAnnual);
    setGridState(newGrid);
    setHasChanges(true);
  };

  const handleSave = async () => {
    await updateRoleGrid(gridState);
    setHasChanges(false);
    toast({ title: "Role Grid configuration saved" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Grid Configuration"
        description="Define role progression paths, salary bands, and promotion timing."
        actions={
          <Button onClick={handleSave} disabled={!hasChanges} className={hasChanges ? "animate-pulse" : ""}>
            Save Changes
          </Button>
        }
      />

      <Card className="overflow-hidden border-border shadow-md">
        <div className="w-full">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[80px]">Code</TableHead>
                <TableHead className="min-w-[150px]">Role Name</TableHead>
                <TableHead>Next Role</TableHead>
                <TableHead className="text-center bg-purple-50/50">Fast (Mo)</TableHead>
                <TableHead className="text-center bg-blue-50/50">Norm (Mo)</TableHead>
                <TableHead className="text-center bg-orange-50/50">Slow (Mo)</TableHead>
                <TableHead className="text-center border-l">Months</TableHead>
                <TableHead className="text-center border-l">Gross yr min (k€)</TableHead>
                <TableHead className="text-center">Gross yr max (k€)</TableHead>
                <TableHead className="text-center border-l text-muted-foreground font-normal">Monthly min (€)</TableHead>
                <TableHead className="text-center text-muted-foreground font-normal">Monthly max (€)</TableHead>
                <TableHead className="text-center border-l text-muted-foreground font-normal">RAL min (k€)</TableHead>
                <TableHead className="text-center text-muted-foreground font-normal">RAL max (k€)</TableHead>
                <TableHead className="text-center border-l">Bonus %</TableHead>
                <TableHead className="text-center border-l">% Min Inc.</TableHead>
                <TableHead className="text-center">% Max/Min</TableHead>
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
                        type="number" step="1" min="1"
                        value={Math.round(row.promo_years_fast * 12)}
                        onChange={(e) => handleCellChange(index, "promo_years_fast", parseInt(e.target.value) / 12)}
                        className="h-8 w-14 mx-auto text-center"
                      />
                  </TableCell>
                  <TableCell className="bg-blue-50/30">
                     <Input
                        type="number" step="1" min="1"
                        value={Math.round(row.promo_years_normal * 12)}
                        onChange={(e) => handleCellChange(index, "promo_years_normal", parseInt(e.target.value) / 12)}
                        className="h-8 w-14 mx-auto text-center"
                      />
                  </TableCell>
                  <TableCell className="bg-orange-50/30">
                     <Input
                        type="number" step="1" min="1"
                        value={Math.round(row.promo_years_slow * 12)}
                        onChange={(e) => handleCellChange(index, "promo_years_slow", parseInt(e.target.value) / 12)}
                        className="h-8 w-14 mx-auto text-center"
                      />
                  </TableCell>
                  <TableCell className="border-l text-center">
                     <Input
                        type="number" step="1" min="12" max="13"
                        value={row.months_paid}
                        onChange={(e) => handleCellChange(index, "months_paid", parseInt(e.target.value))}
                        className="h-8 w-14 mx-auto text-center font-mono"
                      />
                  </TableCell>
                  <TableCell className="border-l">
                     <Input
                        type="number" step="1"
                        value={Math.round(row.gross_fixed_min_month * row.months_paid / 1000)}
                        onChange={(e) => handleGrossChange(index, true, parseFloat(e.target.value))}
                        className="h-8 w-20 mx-auto text-right font-mono"
                      />
                  </TableCell>
                  <TableCell>
                     <Input
                        type="number" step="1"
                        value={Math.round(row.gross_fixed_max_month * row.months_paid / 1000)}
                        onChange={(e) => handleGrossChange(index, false, parseFloat(e.target.value))}
                        className="h-8 w-20 mx-auto text-right font-mono"
                      />
                  </TableCell>
                  <TableCell className="border-l">
                     <span className="block w-20 mx-auto text-right font-mono text-muted-foreground text-sm pr-1">
                       {row.gross_fixed_min_month.toLocaleString("it-IT")}
                     </span>
                  </TableCell>
                  <TableCell>
                     <span className="block w-20 mx-auto text-right font-mono text-muted-foreground text-sm pr-1">
                       {row.gross_fixed_max_month.toLocaleString("it-IT")}
                     </span>
                  </TableCell>
                  <TableCell className="border-l">
                     <Input
                        type="number"
                        value={Math.round(row.ral_min_k * 10) / 10}
                        readOnly
                        className="h-8 w-20 mx-auto text-right font-mono text-muted-foreground bg-muted/30 cursor-default"
                      />
                  </TableCell>
                  <TableCell>
                     <Input
                        type="number"
                        value={Math.round(row.ral_max_k * 10) / 10}
                        readOnly
                        className="h-8 w-20 mx-auto text-right font-mono text-muted-foreground bg-muted/30 cursor-default"
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
                  <TableCell className="border-l">
                     {index === 0 ? (
                       <span className="block w-20 mx-auto text-center text-muted-foreground text-sm">—</span>
                     ) : (() => {
                       const prev = gridState[index - 1];
                       const prevMin = prev.gross_fixed_min_month * prev.months_paid;
                       const curMin = row.gross_fixed_min_month * row.months_paid;
                       const pct = prevMin > 0 ? Math.round((curMin / prevMin - 1) * 100) : 0;
                       return (
                         <div className="relative w-20 mx-auto">
                           <Input type="number" step="1" min="0" value={pct}
                             onChange={(e) => handleMinIncreaseChange(index, parseInt(e.target.value))}
                             className="h-8 w-full pr-5 text-right font-mono" />
                           <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                         </div>
                       );
                     })()}
                  </TableCell>
                  <TableCell>
                     {(() => {
                       const curMin = row.gross_fixed_min_month * row.months_paid;
                       const curMax = row.gross_fixed_max_month * row.months_paid;
                       const pct = curMin > 0 ? Math.round((curMax / curMin - 1) * 100) : 0;
                       return (
                         <div className="relative w-20 mx-auto">
                           <Input type="number" step="1" min="0" value={pct}
                             onChange={(e) => handleMaxVsMinChange(index, parseInt(e.target.value))}
                             className="h-8 w-full pr-5 text-right font-mono" />
                           <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                         </div>
                       );
                     })()}
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
