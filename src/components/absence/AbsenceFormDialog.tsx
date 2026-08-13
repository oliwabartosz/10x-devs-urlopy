import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleHelp, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeRangeDial } from "@/components/absence/TimeRangeDial";
import { typeAllowsPartialDay } from "@/lib/absence-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clampAbsenceHours, MIN_START_TIME } from "@/lib/absence-hours";
import { FULL_DAY_HOURS } from "@/lib/hours";
import { initialsOf } from "@/lib/initials";
import { avatarColor } from "@/lib/avatar";
import { useRovingRadioGroup } from "@/components/hooks/useRovingRadioGroup";
import { cn } from "@/lib/utils";
import type { Absence, AbsenceType, Employee } from "@/types";

/**
 * Accessible name of the single dial trigger. Named once because the E2E suite locates the button
 * by it (`e2e-rules.md:43`) — a rename here has to move both files in one change.
 */
const DIAL_TRIGGER_NAME = "Wybierz godziny na tarczy zegara";

const HOURS_HELP_NAME = "Zasady dotyczące godzin";

/**
 * The rules stated up front, so they are readable *before* a correction happens rather than only
 * in the toast that follows one. Both figures are interpolated from the shared domain constants —
 * the same two `clampAbsenceHours` enforces — so this text cannot drift from what the server does.
 */
const HOURS_HELP_TEXT = [
  `Nieobecność nie może zaczynać się przed ${MIN_START_TIME}.`,
  `Zakres nie może trwać dłużej niż ${String(FULL_DAY_HOURS)} godz.`,
  "Wpisane godziny poza tymi zasadami poprawiamy automatycznie po wyjściu z pola — pokażemy powiadomienie z nową wartością.",
  "Na tarczy zegara tych granic nie da się przekroczyć, a wskazówki przeskakują co 15 minut.",
];

interface HoursColumnProps {
  /** Kept as `start-time` / `end-time`; the `<label>` points at it. */
  id: string;
  /** The visible column heading, per the mockup. */
  label: string;
  /**
   * The input's `aria-label`. It wins over the `<label>` element, so the accessible name stays
   * „Czas od" / „Czas do" — the E2E suite locates these fields by it (`e2e-rules.md:43`).
   */
  fieldName: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
}

/**
 * One labelled time field — half of the mockup's two-column hours row
 * (`new-design/10xUrlopy.dc.html:563-575`).
 *
 * The dial is not here: one dial holds both ends of the range, so a trigger per column would be
 * two buttons opening the same control. The single trigger sits beside the pair instead.
 */
function HoursColumn({ id, label, fieldName, value, onValueChange, onBlur }: HoursColumnProps) {
  return (
    <div className="min-w-0 flex-1">
      <Label htmlFor={id} className="mb-1.5 text-xs font-bold tracking-[0.05em] text-black uppercase">
        {label}
      </Label>
      <Input
        id={id}
        aria-label={fieldName}
        type="time"
        lang="pl-PL"
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
        }}
        onBlur={onBlur}
        className="w-full min-w-0"
      />
    </div>
  );
}

interface AbsenceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  existingAbsence: Absence | null;
  absenceTypes: AbsenceType[];
  employees: Employee[];
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
  targetEmployee: Employee;
}

export function AbsenceFormDialog({
  open,
  onOpenChange,
  day,
  existingAbsence,
  absenceTypes,
  employees,
  currentEmployee,
  targetEmployee,
}: AbsenceFormDialogProps) {
  // Defensive: an existing entry whose type is not partial-day eligible opens as full-day,
  // so the form can never resubmit a combination the API rejects. No such data is expected.
  const existingAllowsPartialDay = typeAllowsPartialDay(
    absenceTypes.find((t) => t.id === existingAbsence?.absence_type_id)?.name,
  );

  const [absenceTypeId, setAbsenceTypeId] = useState<number | null>(existingAbsence?.absence_type_id ?? null);
  const [isFullDay, setIsFullDay] = useState(existingAllowsPartialDay ? (existingAbsence?.is_full_day ?? true) : true);
  const [startTime, setStartTime] = useState(
    existingAllowsPartialDay ? (existingAbsence?.start_time?.slice(0, 5) ?? "") : "",
  );
  const [endTime, setEndTime] = useState(
    existingAllowsPartialDay ? (existingAbsence?.end_time?.slice(0, 5) ?? "") : "",
  );
  const [comment, setComment] = useState(existingAbsence?.comment ?? "");
  const [substituteEmployeeId, setSubstituteEmployeeId] = useState<string | null>(
    existingAbsence?.substitute_employee_id ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The hours-rules tooltip is controlled so it can open on *tap* as well as on hover and focus.
  // Radix Tooltip does not open on touch by design, which would leave a phone user with no path to
  // the rules at all — the correction toast would become the only channel, which is the inverse of
  // stating a rule before it bites.
  const [hoursHelpOpen, setHoursHelpOpen] = useState(false);
  // Radix asks to close on *pointerdown*, before the click handler runs, so by the time the click
  // arrives the state no longer says whether this tap was opening or closing. Sample it at press.
  const hoursHelpOpenAtPressRef = useRef(false);

  const dateStr = `${day.getFullYear().toString()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const dateHeading = day.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const selectedType = absenceTypes.find((t) => t.id === absenceTypeId);
  const canBePartialDay = typeAllowsPartialDay(selectedType?.name);

  const saveDisabled = absenceTypeId === null || isSubmitting || (!isFullDay && (!startTime || !endTime));

  // What a deferred callback needs to know about the form as it stands *now* rather than as it
  // stood when the callback was scheduled. Read only by `announceCorrection`.
  //
  // `useLayoutEffect`, not `useEffect`: the deferred notice decides during the click that follows
  // the blur, and a passive effect may not have run by then. A layout effect commits inside the
  // click's own dispatch, so the ref is current when it is read.
  const liveRef = useRef({ mounted: true, open, showsHours: false, startTime, endTime });
  useLayoutEffect(() => {
    liveRef.current = { ...liveRef.current, open, showsHours: canBePartialDay && !isFullDay, startTime, endTime };
  });
  useEffect(
    () => () => {
      liveRef.current.mounted = false;
    },
    [],
  );

  const otherEmployees = employees.filter((e) => e.id !== targetEmployee.id);

  // Shared by the click and the keyboard path so arrow-key selection cannot bypass the
  // partial-day reset below. Only the training types (PARTIAL_DAY_TYPE_NAMES) may be
  // partial-day; any other type reverts to full-day and drops the entered range.
  const selectType = (index: number) => {
    const type = absenceTypes[index];
    setAbsenceTypeId(type.id);
    if (!typeAllowsPartialDay(type.name)) {
      setIsFullDay(true);
      setStartTime("");
      setEndTime("");
    }
  };

  // Correct the range when focus leaves either time input, using the same module the API
  // enforces with (`@/lib/absence-hours`) — one rule, one source, exactly as
  // `typeAllowsPartialDay` is already shared between this form and the routes. The user sees
  // the value that will actually be stored instead of discovering it after the reload.
  //
  // Deliberately not on `onChange`: `<input type="time">` fires per keystroke, so clamping
  // there would rewrite a start time mid-entry. Skipped while either field is empty (the user
  // is mid-entry, and `saveDisabled` already gates that), and skipped on a rejection — that
  // range keeps its existing path of a server 400 surfaced through `toast.error`.
  //
  // A correction that nobody is told about is the second symptom this change exists to remove,
  // so a rewrite raises a toast naming both the new value and the rule behind it. The toast
  // fires *only* when a value actually moved — comparing against what was entered rather than
  // against `clamped.ok`, or every tab through an already-legal range would raise one. Start
  // moved means the 06:00 floor; end moved means the duration cap; both can fire at once
  // (`04:00–20:00` floors, then caps).
  const clampTimesOnBlur = () => {
    if (!startTime || !endTime) return;
    const clamped = clampAbsenceHours(startTime, endTime);
    if (!clamped.ok) return;
    const startCorrected = clamped.startTime !== startTime;
    const endCorrected = clamped.endTime !== endTime;
    setStartTime(clamped.startTime);
    setEndTime(clamped.endTime);
    const notices: string[] = [];
    if (startCorrected) {
      notices.push(`Poprawiono początek na ${clamped.startTime} — nieobecność nie może zaczynać się wcześniej.`);
    }
    if (endCorrected) {
      notices.push(
        `Poprawiono koniec na ${clamped.endTime} — nieobecność nie może trwać dłużej niż ${String(FULL_DAY_HOURS)} godz.`,
      );
    }
    if (notices.length === 0) return;
    announceCorrection(notices.join(" "), clamped.startTime, clamped.endTime);
  };

  // Blur fires on *mousedown*, so at this point the click that caused it has not run its handler
  // yet. Announcing immediately means a toast describing a range that the very next click throws
  // away — picking a non-training type, re-checking „Cały dzień" and Anuluj all clear or close the
  // row. So the notice waits one task and then asks whether the range it describes still exists.
  const announceCorrection = (notice: string, startTime: string, endTime: string) => {
    const show = () => {
      const live = liveRef.current;
      if (!live.mounted || !live.open || !live.showsHours) return;
      if (live.startTime !== startTime || live.endTime !== endTime) return;
      toast.info(notice);
    };
    // The click lands on `document` after React has processed it, so by then the row has already
    // been cleared or the dialog closed if that is where the click was going. A blur with no click
    // behind it — Tab, or focus moving to the dial — never gets that signal, so a short timer backs
    // the listener up; whichever fires first cancels the other.
    const settled = window.setTimeout(() => {
      document.removeEventListener("click", onClick);
      show();
    }, 250);
    const onClick = () => {
      window.clearTimeout(settled);
      show();
    };
    document.addEventListener("click", onClick, { once: true });
  };

  // The dial constrains every candidate position before committing it (`constrainPair`), so what
  // arrives here is already inside the domain — deliberately not routed through
  // `clampTimesOnBlur`, which could only ever be a no-op on it.
  const setRangeFromDial = (start: string, end: string) => {
    setStartTime(start);
    setEndTime(end);
  };

  const typeGroup = useRovingRadioGroup(
    absenceTypes.length,
    absenceTypes.findIndex((t) => t.id === absenceTypeId),
    selectType,
  );

  // Index 0 is the "brak zastępstwa" option, so employee i sits at i + 1.
  const selectSubstitute = (index: number) => {
    setSubstituteEmployeeId(index === 0 ? null : otherEmployees[index - 1].id);
  };

  const substituteGroup = useRovingRadioGroup(
    otherEmployees.length + 1,
    substituteEmployeeId === null ? 0 : otherEmployees.findIndex((e) => e.id === substituteEmployeeId) + 1,
    selectSubstitute,
  );

  const handleSave = async () => {
    setIsSubmitting(true);
    const sharedFields = {
      absence_type_id: absenceTypeId,
      date: dateStr,
      is_full_day: isFullDay,
      start_time: isFullDay ? null : startTime,
      end_time: isFullDay ? null : endTime,
      comment: comment || null,
      substitute_employee_id: substituteEmployeeId,
    };
    try {
      const res = existingAbsence
        ? await fetch(`/api/absences/${existingAbsence.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sharedFields),
          })
        : await fetch("/api/absences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_id: targetEmployee.id, ...sharedFields }),
          });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Nie udało się zapisać. Spróbuj ponownie.");
        setIsSubmitting(false);
      }
    } catch {
      toast.error("Nie udało się zapisać. Spróbuj ponownie.");
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingAbsence) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/absences/${existingAbsence.id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Nie udało się usunąć. Spróbuj ponownie.");
        setIsSubmitting(false);
      }
    } catch {
      toast.error("Nie udało się usunąć. Spróbuj ponownie.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-primary text-xl">
            {existingAbsence ? "Edytuj nieobecność" : "Dodaj nieobecność"}
          </DialogTitle>
          <p className="text-muted-foreground text-[13px] capitalize">{dateHeading}</p>
          {targetEmployee.id !== currentEmployee.id && (
            <p className="text-primary text-[13px] font-bold">
              {targetEmployee.first_name} {targetEmployee.last_name}
            </p>
          )}
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label id="absence-type-label">Typ nieobecności</Label>
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-labelledby="absence-type-label"
              onKeyDown={typeGroup.onKeyDown}
            >
              {absenceTypes.map((type, index) => {
                const selected = type.id === absenceTypeId;
                return (
                  <button
                    key={type.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={typeGroup.tabIndexFor(index)}
                    onClick={() => {
                      selectType(index);
                    }}
                    className={cn(
                      "hover:border-primary flex w-full items-center gap-2.5 rounded-[10px] text-left text-[13px] leading-tight text-black transition-colors",
                      selected
                        ? "border-primary ring-primary bg-[#f4f7fa] px-[11px] py-[9px] font-bold ring-1"
                        : "border-[#dcdcdc] px-3 py-2.5",
                      "border",
                    )}
                  >
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-[9px] text-sm leading-none"
                      style={{ backgroundColor: type.color, color: type.text_color }}
                    >
                      {type.icon}
                    </span>
                    <span className="min-w-0 flex-1">{type.name}</span>
                    <span className={cn("text-[13px] font-bold", selected ? "text-primary" : "text-transparent")}>
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {canBePartialDay && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is-full-day"
                  checked={isFullDay}
                  onChange={(e) => {
                    setIsFullDay(e.target.checked);
                    if (e.target.checked) {
                      setStartTime("");
                      setEndTime("");
                    }
                  }}
                  // `accent-color` on the native control rather than a Radix Checkbox: it paints
                  // the tick navy instead of the browser's blue while keeping a real
                  // `<input type="checkbox">`, which the E2E suite drives with check()/uncheck().
                  className="accent-primary focus-visible:ring-ring/50 h-4 w-4 cursor-pointer rounded-[4px] focus-visible:ring-[3px] focus-visible:outline-none"
                />
                <Label htmlFor="is-full-day" className="cursor-pointer">
                  Cały dzień
                </Label>
              </div>

              {!isFullDay && (
                <div className="flex items-end gap-3.5">
                  <HoursColumn
                    id="start-time"
                    label="Od godziny"
                    fieldName="Czas od"
                    value={startTime}
                    onValueChange={setStartTime}
                    onBlur={clampTimesOnBlur}
                  />
                  <HoursColumn
                    id="end-time"
                    label="Do godziny"
                    fieldName="Czas do"
                    value={endTime}
                    onValueChange={setEndTime}
                    onBlur={clampTimesOnBlur}
                  />
                  {/* One trigger for one dial: the dial carries both ends of the range, so a button
                      per column would be two ways to open the same control. It sits outside the two
                      `flex-1` columns and aligns with the inputs, whose labels sit above them. */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={DIAL_TRIGGER_NAME}
                        title={DIAL_TRIGGER_NAME}
                      >
                        <Clock />
                      </Button>
                    </PopoverTrigger>
                    {/* `w-auto` overrides the primitive's `w-72`: the dial sizes itself and the
                        popover should shrink to it rather than the other way round.

                        Radix gives `PopoverContent` `role="dialog"` and no name of its own, so
                        without this a screen reader announces a bare "dialog" on open. The SVG's
                        own label names the handle group inside it, not the layer. Reusing the
                        trigger's name keeps the two readings identical. */}
                    <PopoverContent className="w-auto p-3" aria-label={DIAL_TRIGGER_NAME}>
                      <TimeRangeDial startTime={startTime} endTime={endTime} onChange={setRangeFromDial} />
                    </PopoverContent>
                  </Popover>

                  {/* The rules, before they bite. A real `<button>` rather than an icon with a
                      `title`: a tooltip on a focusable element opens on keyboard focus too, so the
                      explanation is not pointer-only — and, controlled, on tap as well. */}
                  <Tooltip open={hoursHelpOpen} onOpenChange={setHoursHelpOpen}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={HOURS_HELP_NAME}
                        aria-expanded={hoursHelpOpen}
                        onPointerDown={() => {
                          hoursHelpOpenAtPressRef.current = hoursHelpOpen;
                        }}
                        onClick={() => {
                          setHoursHelpOpen(!hoursHelpOpenAtPressRef.current);
                        }}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <CircleHelp />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="end">
                      <div className="space-y-1.5">
                        {HOURS_HELP_TEXT.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="comment">Komentarz (opcjonalnie)</Label>
            <Input
              id="comment"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
              }}
              placeholder="Notatka..."
            />
          </div>

          {otherEmployees.length > 0 && (
            <div className="grid gap-1.5">
              <Label id="substitute-label">Zastępstwo (opcjonalnie)</Label>
              {/* otherEmployees excludes the *target* employee, not the editor
                  (context/changes/moderator-absence-management/plan.md:32), and the
                  employees prop is already visibleEmployeesFilter()-scoped, so the
                  is_system admin never appears here. */}
              <div
                className="flex flex-wrap items-center gap-2"
                role="radiogroup"
                aria-labelledby="substitute-label"
                onKeyDown={substituteGroup.onKeyDown}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={substituteEmployeeId === null}
                  aria-label="Brak zastępstwa"
                  title="Brak zastępstwa"
                  tabIndex={substituteGroup.tabIndexFor(0)}
                  onClick={() => {
                    selectSubstitute(0);
                  }}
                  className={cn(
                    "text-muted-foreground hover:border-accent flex size-[38px] shrink-0 items-center justify-center rounded-full border-2 bg-[#eeeeee] text-[13px] font-bold",
                    substituteEmployeeId === null ? "border-primary" : "border-transparent",
                  )}
                >
                  —
                </button>
                {otherEmployees.map((emp, index) => {
                  const selected = substituteEmployeeId === emp.id;
                  const fullName = `${emp.first_name} ${emp.last_name}`;
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      // The visible label is two initials, which names the control "AN" to a
                      // screen reader. Carry the full name explicitly.
                      aria-label={fullName}
                      title={fullName}
                      tabIndex={substituteGroup.tabIndexFor(index + 1)}
                      onClick={() => {
                        selectSubstitute(index + 1);
                      }}
                      className={cn(
                        "hover:border-accent flex size-[38px] shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold text-white",
                        selected ? "border-primary" : "border-transparent",
                      )}
                      style={{ backgroundColor: avatarColor(employees.indexOf(emp)) }}
                    >
                      {initialsOf(fullName)}
                    </button>
                  );
                })}
              </div>
              <p className="text-muted-foreground min-h-4 text-xs">
                {substituteEmployeeId === null
                  ? "Brak zastępstwa"
                  : (() => {
                      const sub = otherEmployees.find((e) => e.id === substituteEmployeeId);
                      return sub ? `${sub.first_name} ${sub.last_name}` : "";
                    })()}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {existingAbsence && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="mr-auto"
            >
              Usuń
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isSubmitting}
          >
            Anuluj
          </Button>
          <Button type="button" onClick={handleSave} disabled={saveDisabled}>
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
