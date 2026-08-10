import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HolidayBalanceDialog } from "@/components/holiday/HolidayBalanceDialog";
import { cn } from "@/lib/utils";
import type { HolidayBalanceView, UserRole } from "@/types";

interface HolidayBalanceCardProps {
  initialBalance: HolidayBalanceView;
  employeeId: string;
  year: number;
  currentRole: UserRole;
}

// Trim trailing zeros so 2.5 stays "2,5" and 3.0 shows as "3"; Polish decimal comma.
function formatDays(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("pl-PL", { maximumFractionDigits: 2 });
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[104px] bg-white px-[18px] py-2.5">
      <div className="text-muted-foreground mb-1 text-[11px] tracking-[0.05em] uppercase">{label}</div>
      <div className="text-primary text-xl font-bold">{value}</div>
    </div>
  );
}

export default function HolidayBalanceCard({ initialBalance, employeeId, year, currentRole }: HolidayBalanceCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const balance = initialBalance;
  const isEmpty = balance.balance_id === null;
  // Negative balances are surfaced, never clamped — an S-15 decision
  // (context/archive/2026-06-22-urlop-balance/).
  const negative = balance.left_days < 0;

  return (
    <div className="border-line flex flex-wrap items-start justify-between gap-8 rounded-[14px] border bg-white px-6 py-[22px]">
      <div className="flex flex-wrap items-baseline gap-10">
        <div>
          <h2 className="text-muted-foreground mb-2 text-xs font-bold tracking-[0.08em] uppercase">
            Urlop {year} – pozostało
          </h2>
          {isEmpty ? (
            <p className="text-muted-foreground text-sm">Brak wprowadzonego wymiaru urlopu.</p>
          ) : (
            <div className="flex items-baseline gap-3">
              <span
                className={cn("text-[40px] leading-none font-bold", negative ? "text-destructive" : "text-primary")}
              >
                {formatDays(balance.left_days)} dni
              </span>
              {balance.valid_until && (
                <span className="text-muted-foreground text-[13px]">Do dnia: {balance.valid_until}</span>
              )}
            </div>
          )}
        </div>

        {!isEmpty && (
          <div className="border-line bg-line flex gap-px overflow-hidden rounded-[10px] border">
            <Tile label="Bieżące" value={formatDays(balance.current_entitlement_days)} />
            <Tile label="Zaległe" value={formatDays(balance.carryover_days)} />
            <Tile label="Wykorzystane" value={formatDays(balance.used_days)} />
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDialogOpen(true);
          }}
          className="border-primary text-primary hover:bg-primary hover:text-primary-foreground rounded-lg px-5 py-[9px] text-[13px] font-bold"
        >
          Edytuj
        </Button>
        {negative && (
          <div className="border-destructive flex items-center gap-2 rounded-lg border bg-[#fdecef] px-3 py-[7px]">
            <span className="bg-destructive block size-2 rounded-full" />
            <span className="text-destructive text-xs font-bold">
              Przekroczono wymiar urlopu o {formatDays(Math.abs(balance.left_days))} dni
            </span>
          </div>
        )}
      </div>

      {/*
        Keyed on the open state so each Edytuj remounts the dialog and its fields re-derive
        from `balance`. Without the key the form state survives a Cancel, and reopening
        shows the abandoned edits — visible now that the steppers change a value per click.
      */}
      <HolidayBalanceDialog
        key={dialogOpen ? "open" : "closed"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        balance={balance}
        employeeId={employeeId}
        year={year}
        currentRole={currentRole}
      />
    </div>
  );
}
