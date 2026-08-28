import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildExportWorkbook, exportYearOptions } from "@/lib/export-workbook";
import type { Absence, AbsenceType, EmployeeListItem } from "@/types";
import { withBase } from "@/lib/base-path";

interface AbsenceExportDialogProps {
  /** `allEmployees` in server order — deactivated rows included. */
  employees: EmployeeListItem[];
  absenceTypes: AbsenceType[];
  currentEmployeeId: string;
}

export function AbsenceExportDialog({ employees, absenceTypes, currentEmployeeId }: AbsenceExportDialogProps) {
  const currentYear = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Same cleanup contract as AbsenceStats' lazy year fetch: an export in flight when the
  // island unmounts must not resolve into a dead component.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const years = exportYearOptions(employees, currentYear);

  const handleExport = async () => {
    setError(null);
    setBusy("Pobieranie danych…");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // The fetch and the generation fail for unrelated reasons and are reported separately: an
    // offline browser throws out of `fetch`, and telling the user the *file* could not be
    // generated would point them at the wrong thing entirely.
    let absences: Absence[];
    try {
      const res = await fetch(withBase(`/api/absences?year=${year}`), { signal: controller.signal });
      if (!res.ok) {
        setError(`Nie udało się pobrać danych (błąd ${res.status}). Spróbuj ponownie.`);
        setBusy(null);
        return;
      }
      // A year quietly missing December is exactly the failure the server's truncation probe
      // exists to prevent, and it is far worse in a file than in a list on screen: nothing in
      // the workbook would show that it is short. Refuse rather than download a partial year.
      if (res.headers.get("X-Result-Truncated") === "1") {
        setError(`Rok ${year} przekracza limit wierszy serwera — eksport byłby niepełny.`);
        setBusy(null);
        return;
      }
      absences = (await res.json()) as Absence[];
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      // The dialog stays open so the year selection survives a retry.
      setError("Nie udało się pobrać danych. Sprawdź połączenie i spróbuj ponownie.");
      setBusy(null);
      return;
    }

    try {
      setBusy("Generowanie pliku…");
      const sheets = buildExportWorkbook({ year, employees, absences, absenceTypes, currentEmployeeId });
      // Loaded on click, not on page load: the writer is ~39 KiB gzip and only a moderator who
      // actually exports should pay for it. The first dynamic import in this codebase.
      const { writeWorkbook, downloadWorkbook } = await import("@/lib/export-xlsx");
      // Closing the dialog aborts the run; without these guards a cancelled export still
      // downloads a file and still drives setOpen on a dialog the user may have reopened.
      //
      // Read through a call rather than touching `controller.signal.aborted` directly: TS narrows
      // that property to `false` at the first guard and does not widen it back across the await,
      // so the second guard reads as dead code to no-unnecessary-condition. It is not dead — the
      // await below is the longest step here and the likeliest place for an abort to land.
      const aborted = () => controller.signal.aborted;
      if (aborted()) return;
      const bytes = await writeWorkbook(sheets);
      if (aborted()) return;
      // ASCII-only filename — a non-ASCII `download` value is honoured inconsistently.
      downloadWorkbook(bytes, `nieobecnosci-${year}.xlsx`);

      setBusy(null);
      setOpen(false);
    } catch {
      setError("Nie udało się wygenerować pliku. Spróbuj ponownie.");
      setBusy(null);
    }
  };

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        className="border-primary text-primary hover:border-accent hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center gap-[9px] rounded-lg border bg-white px-[18px] py-[9px] text-sm font-bold transition-colors"
      >
        <Download className="size-4" />
        Eksport XLSX
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Closing mid-export abandons it rather than leaving a fetch running behind a
          // dialog the user has dismissed.
          if (!next) {
            abortRef.current?.abort();
            setBusy(null);
            setError(null);
          }
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-primary text-xl">Eksport do XLSX</DialogTitle>
            <DialogDescription>
              Cały rok w jednym pliku — każdy miesiąc na osobnej karcie, z kolorami i komentarzami.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <label
              className="text-muted-foreground text-[11px] font-bold tracking-[0.06em] uppercase"
              htmlFor="export-year"
            >
              Rok
            </label>
            <Select
              value={String(year)}
              onValueChange={(v) => {
                setYear(Number(v));
              }}
              disabled={busy !== null}
            >
              <SelectTrigger id="export-year" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
              }}
              disabled={busy !== null}
            >
              Anuluj
            </Button>
            <Button type="button" onClick={handleExport} disabled={busy !== null}>
              {busy ?? "Pobierz plik"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
