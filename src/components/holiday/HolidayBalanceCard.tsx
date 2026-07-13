import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HolidayBalanceDialog } from "@/components/holiday/HolidayBalanceDialog";
import type { Employee, HolidayBalanceView } from "@/types";

interface HolidayBalanceCardProps {
  initialBalance: HolidayBalanceView;
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
  year: number;
}

// Trim trailing zeros so 2.5 stays "2,5" and 3.0 shows as "3"; Polish decimal comma.
function formatDays(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("pl-PL", { maximumFractionDigits: 2 });
}

export default function HolidayBalanceCard({ initialBalance, currentEmployee, year }: HolidayBalanceCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const balance = initialBalance;
  const isEmpty = balance.balance_id === null;
  const negative = balance.left_days < 0;

  return (
    <div className="mt-3 rounded border bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-gray-500">Urlop {year} — pozostało</h2>
          {isEmpty ? (
            <p className="mt-1 text-sm text-gray-500">Brak wprowadzonego wymiaru urlopu.</p>
          ) : (
            <>
              <p className={`mt-1 text-3xl font-bold ${negative ? "text-red-600" : "text-gray-900"}`}>
                {formatDays(balance.left_days)} dni
              </p>
              <p className="mt-1 text-sm text-gray-600">
                Bieżące {formatDays(balance.current_entitlement_days)} + Zaległe {formatDays(balance.carryover_days)} −
                Wykorzystane {formatDays(balance.used_days)} = {formatDays(balance.left_days)}
              </p>
              {negative && (
                <p className="mt-1 text-sm font-medium text-red-600">
                  Przekroczono wymiar urlopu o {formatDays(Math.abs(balance.left_days))} dni.
                </p>
              )}
              {balance.valid_until && <p className="mt-1 text-xs text-gray-400">Do dnia: {balance.valid_until}</p>}
            </>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          Edytuj
        </Button>
      </div>

      <HolidayBalanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        balance={balance}
        employeeId={currentEmployee.id}
        year={year}
      />
    </div>
  );
}
