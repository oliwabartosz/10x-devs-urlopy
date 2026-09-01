import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleHelp, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeRangeDial } from "@/components/absence/TimeRangeDial";
import { typeAllowsPartialDay, typeAllowsPriority } from "@/lib/absence-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clampAbsenceHours, MIN_START_TIME } from "@/lib/absence-hours";
import { FULL_DAY_HOURS } from "@/lib/hours";
import { initialsOf } from "@/lib/initials";
import { avatarColor } from "@/lib/avatar";
import { useRovingRadioGroup } from "@/components/hooks/useRovingRadioGroup";
import { rawTimeRange } from "@/lib/absence-grid-cell";
import { pluralPl } from "@/lib/plural";
import { cn } from "@/lib/utils";
import type { OccupiedRangeDay, RangeDay } from "@/lib/absence-range";
import type {
  Absence,
  AbsenceBulkCreateCommand,
  AbsenceBulkDeleteCommand,
  AbsenceType,
  EmployeeListItem,
} from "@/types";
import { withBase } from "@/lib/base-path";

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

interface AbsenceFormDialogBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  absenceTypes: AbsenceType[];
  employees: EmployeeListItem[];
  currentEmployee: Pick<EmployeeListItem, "id" | "first_name" | "last_name" | "role">;
  targetEmployee: EmployeeListItem;
}

interface AbsenceFormDialogSingleProps extends AbsenceFormDialogBaseProps {
  mode?: "single";
  day: Date;
  existingAbsence: Absence | null;
}

interface AbsenceFormDialogRangeProps extends AbsenceFormDialogBaseProps {
  mode: "range";
  /** Every non-weekend day the drag covers, in calendar order. Weekends are already dropped. */
  rangeDays: RangeDay[];
  /**
   * The subset of `rangeDays` that already holds an entry, each carrying that entry.
   *
   * Computed by the grid from the absences it already renders, which is why the confirmation
   * costs no request: at mouse-release the grid already knows every day it is about to replace.
   */
  occupiedDays: OccupiedRangeDay[];
}

/**
 * A discriminated union rather than an optional second date, so the type system rules out the
 * combination that has no meaning: a range plus an `existingAbsence`. Range mode never *edits* —
 * there is no "edit these five days" — and that is what keeps the branching inside the component
 * small enough to be worth having one component instead of two.
 *
 * Range mode does now *delete*, but that arm reads `occupiedDays`, not `existingAbsence`: the days
 * it removes are the ones the drag already covered, which is a set rather than a row. So the union
 * is unchanged — a range still has no single "existing absence" to point at.
 *
 * `mode` is optional on the single arm so every existing single-day call site stays valid.
 */
type AbsenceFormDialogProps = AbsenceFormDialogSingleProps | AbsenceFormDialogRangeProps;

/**
 * The days the server reports as overwritten that the confirmation never named.
 *
 * `occupiedDays` is computed from the grid as it was rendered, so it goes stale the moment anyone
 * else writes into the range; `overwritten_dates` is what the write actually replaced. The
 * difference is the set of entries destroyed without the user ever being shown them — the one
 * case the client-side confirmation cannot catch on its own.
 *
 * A malformed or unreadable body yields `[]`: the write succeeded either way, and a broken report
 * is not a reason to withhold the reload.
 */
async function unannouncedOverwrites(res: Response, announced: OccupiedRangeDay[]): Promise<string[]> {
  try {
    const body = (await res.json()) as { overwritten_dates?: unknown };
    if (!Array.isArray(body.overwritten_dates)) return [];
    const shown = new Set(announced.map((d) => d.key));
    return body.overwritten_dates.filter((d): d is string => typeof d === "string" && !shown.has(d));
  } catch {
    return [];
  }
}

/**
 * The days the confirmation named that the server found nothing to delete on.
 *
 * The exact inverse of {@link unannouncedOverwrites}, and stale for the same reason: `occupiedDays`
 * is computed from the grid as it was rendered, so a day someone else deleted in the meantime is
 * still listed in the confirmation. `missing_dates` is what the delete found absent. Where the
 * overwrite case reports rows destroyed without being shown, this reports rows shown that were
 * already gone.
 *
 * Only the occupied days are ever sent, so every `missing_dates` entry is by construction one the
 * confirmation named; the `shown` filter is belt-and-braces against a future caller widening the
 * request to the whole range, where free days would otherwise read as staleness.
 *
 * A malformed or unreadable body yields `[]`: the delete succeeded either way.
 */
async function alreadyDeleted(res: Response, announced: OccupiedRangeDay[]): Promise<string[]> {
  try {
    const body = (await res.json()) as { missing_dates?: unknown };
    if (!Array.isArray(body.missing_dates)) return [];
    const shown = new Set(announced.map((d) => d.key));
    return body.missing_dates.filter((d): d is string => typeof d === "string" && shown.has(d));
  } catch {
    return [];
  }
}

export function AbsenceFormDialog(props: AbsenceFormDialogProps) {
  const { open, onOpenChange, absenceTypes, employees, currentEmployee, targetEmployee } = props;

  const isRange = props.mode === "range";
  // Range mode never edits, so `existingAbsence` is null there by construction. Every seeding
  // expression below already reads through it, which is what makes the range form open blank
  // without a second code path — and what keeps the *single-day* delete button's `existingAbsence &&`
  // guard sufficient rather than needing a mode check of its own. The range delete is a separate
  // render behind `isRange && occupiedDays.length > 0`; it never consults `existingAbsence`.
  const existingAbsence = props.mode === "range" ? null : props.existingAbsence;
  const rangeDays = props.mode === "range" ? props.rangeDays : [];
  const occupiedDays = props.mode === "range" ? props.occupiedDays : [];
  // Defensive: an existing entry whose type is not partial-day eligible opens as full-day,
  // so the form can never resubmit a combination the API rejects. No such data is expected.
  const existingAllowsPartialDay = typeAllowsPartialDay(
    absenceTypes.find((t) => t.id === existingAbsence?.absence_type_id)?.name,
  );
  // Same defensiveness for the priority marker: a stored row whose type is not priority-eligible
  // opens unflagged, so the form can never resubmit a combination the API rejects.
  const existingAllowsPriority = typeAllowsPriority(
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
  const [isPriority, setIsPriority] = useState(
    existingAllowsPriority ? (existingAbsence?.is_priority ?? false) : false,
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

  // Which step of the range dialog is showing. One `step` state swapping the body and the footer
  // inside the *same* Radix Dialog rather than opening a nested one — two stacked Radix dialogs
  // fight over the focus trap, and the confirmation is a step of this decision, not a new one.
  // Always "form" in single-day mode, where nothing can move it.
  const [step, setStep] = useState<"form" | "confirm">("form");

  // Which verb the confirm step is confirming. The step machine now has two consumers — the
  // overwrite warning and the range delete — and they share one body, one footer and one day list,
  // so the copy has to know which question it is asking. Set explicitly at both entrances rather
  // than defaulted, so a stale value can never describe the wrong action.
  const [pendingAction, setPendingAction] = useState<"save" | "delete">("save");

  const dateStr =
    props.mode === "range"
      ? ""
      : `${props.day.getFullYear().toString()}-${String(props.day.getMonth() + 1).padStart(2, "0")}-${String(props.day.getDate()).padStart(2, "0")}`;

  // The span, in the prototype's `dayFrom–dayTo MONTH` shape, plus the working-day count — the
  // count is what tells the user the weekends they dragged over were dropped rather than included.
  // A selection cannot leave one rendered month, so the month is named once.
  const rangeHeading = (() => {
    if (rangeDays.length === 0) return "";
    const first = rangeDays[0].date;
    const last = rangeDays[rangeDays.length - 1].date;
    const span =
      first.getTime() === last.getTime()
        ? first.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })
        : `${first.getDate().toString()}–${last.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}`;
    const count = rangeDays.length;
    return `${span} · ${count.toString()} ${pluralPl(count, "dzień roboczy", "dni robocze", "dni roboczych")}`;
  })();

  const dateHeading =
    props.mode === "range"
      ? rangeHeading
      : props.day.toLocaleDateString("pl-PL", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });

  const selectedType = absenceTypes.find((t) => t.id === absenceTypeId);
  const canBePartialDay = typeAllowsPartialDay(selectedType?.name);
  const canBePriority = typeAllowsPriority(selectedType?.name);

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
  //
  // The priority reset lives here for the same reason, and here *only*: this function is what
  // `useRovingRadioGroup` calls, so putting it in the button's onClick would leave arrow-key
  // selection carrying a flag onto an ineligible type.
  const selectType = (index: number) => {
    const type = absenceTypes[index];
    setAbsenceTypeId(type.id);
    if (!typeAllowsPartialDay(type.name)) {
      setIsFullDay(true);
      setStartTime("");
      setEndTime("");
    }
    if (!typeAllowsPriority(type.name)) {
      setIsPriority(false);
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

  // Pressing „Zapisz". In range mode a range that crosses existing entries stops here and asks
  // first; a range over empty days writes straight through, because there is nothing to warn about
  // and an unconditional confirmation would train the user to click past it.
  //
  // The confirmation is deliberately the *second* step rather than a gate before the form: asking
  // someone to approve an overwrite before they have decided what replaces it is asking them to
  // approve nothing in particular.
  const handleSave = async () => {
    if (isRange && step === "form" && occupiedDays.length > 0) {
      setPendingAction("save");
      setStep("confirm");
      return;
    }
    await submitAbsence();
  };

  // Pressing „Usuń" in range mode. Always confirms — unlike „Zapisz", which writes straight through
  // over empty days, a delete has nothing to do *but* destroy, so there is no case where skipping
  // the confirmation would save a pointless click.
  const handleRangeDeleteRequest = () => {
    setPendingAction("delete");
    setStep("confirm");
  };

  const submitAbsence = async () => {
    // `saveDisabled` already blocks a save with no type picked, so this never fires in practice.
    // Stating it here is what lets the request bodies below be typed against the shared DTOs
    // instead of carrying a `null` the API would reject anyway.
    if (absenceTypeId === null) return;
    setIsSubmitting(true);
    const sharedFields = {
      absence_type_id: absenceTypeId,
      is_full_day: isFullDay,
      start_time: isFullDay ? null : startTime,
      end_time: isFullDay ? null : endTime,
      comment: comment || null,
      // `canBePriority &&` rather than the raw state: the reset in `selectType` already clears it,
      // and this makes a stale `true` unable to leave the client even if a future edit reorders
      // that reset. The API rejects the combination either way; this keeps it from being asked.
      is_priority: canBePriority && isPriority,
      substitute_employee_id: substituteEmployeeId,
    };
    try {
      // One request for the whole range, against the route whose conflict behaviour is overwrite.
      // The single-day arms keep their exact previous behaviour, POST and PATCH alike.
      const res = isRange
        ? await fetch(withBase("/api/absences/bulk"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employee_id: targetEmployee.id,
              dates: rangeDays.map((d) => d.key),
              ...sharedFields,
            } satisfies AbsenceBulkCreateCommand),
          })
        : existingAbsence
          ? await fetch(withBase(`/api/absences/${existingAbsence.id}`), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...sharedFields, date: dateStr }),
            })
          : await fetch(withBase("/api/absences"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ employee_id: targetEmployee.id, ...sharedFields, date: dateStr }),
            });
      if (res.ok) {
        // The confirmation named the days the grid knew were occupied when the page rendered; the
        // server reports the days it actually replaced. A day in `overwritten_dates` that the
        // confirmation never named means someone wrote into this range since the page loaded, and
        // the overwrite destroyed an entry the user was never shown. The reload below would
        // swallow a plain toast, so this one holds the refresh behind an acknowledgement.
        const unannounced = isRange ? await unannouncedOverwrites(res, occupiedDays) : [];
        if (unannounced.length > 0) {
          const labels = unannounced
            .map((key) => rangeDays.find((d) => d.key === key)?.date)
            .map((date, i) => date?.toLocaleDateString("pl-PL", { day: "numeric", month: "long" }) ?? unannounced[i])
            .join(", ");
          toast.warning(`Nadpisano wpisy dodane w międzyczasie przez kogoś innego: ${labels}.`, {
            duration: Infinity,
            action: {
              label: "Odśwież",
              onClick: () => {
                window.location.reload();
              },
            },
          });
          // Deliberately stays `isSubmitting`: the write already landed, so a second press must
          // not repeat it. Acknowledging the toast is the only way forward.
          return;
        }
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Nie udało się zapisać. Spróbuj ponownie.");
        setIsSubmitting(false);
        // Back to the form on failure: the confirm step describes a write that did not happen, and
        // leaving it up would offer a retry of an overwrite whose error the user cannot see behind
        // the summary.
        setStep("form");
      }
    } catch {
      toast.error("Nie udało się zapisać. Spróbuj ponownie.");
      setIsSubmitting(false);
      setStep("form");
    }
  };

  const handleDelete = async () => {
    if (!existingAbsence) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(withBase(`/api/absences/${existingAbsence.id}`), { method: "DELETE" });
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

  // The range counterpart of `handleDelete`. Sends **only the occupied days**, never `rangeDays`:
  // the free days are already known to hold nothing, and asking about them would fill
  // `missing_dates` with noise that drowns the staleness signal below.
  const handleRangeDelete = async () => {
    if (!isRange || occupiedDays.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(withBase("/api/absences/bulk"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: targetEmployee.id,
          dates: occupiedDays.map((d) => d.key),
        } satisfies AbsenceBulkDeleteCommand),
      });
      if (res.ok) {
        // The confirmation named every day the grid knew was occupied when the page rendered; the
        // server reports which of them held nothing by the time the delete ran. The difference is
        // someone else's delete landing since the page loaded. The reload below would swallow a
        // plain toast, so this one holds the refresh behind an acknowledgement.
        const stale = await alreadyDeleted(res, occupiedDays);
        if (stale.length > 0) {
          const labels = stale
            .map((key) => occupiedDays.find((d) => d.key === key)?.date)
            .map((date, i) => date?.toLocaleDateString("pl-PL", { day: "numeric", month: "long" }) ?? stale[i])
            .join(", ");
          toast.warning(`Część wpisów została już usunięta przez kogoś innego: ${labels}.`, {
            duration: Infinity,
            action: {
              label: "Odśwież",
              onClick: () => {
                window.location.reload();
              },
            },
          });
          // Deliberately stays `isSubmitting`: the delete already landed, so a second press must
          // not repeat it. Acknowledging the toast is the only way forward.
          return;
        }
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Nie udało się usunąć. Spróbuj ponownie.");
        setIsSubmitting(false);
        // Back to the form on failure, for the same reason `submitAbsence` does it: a confirm step
        // describing a delete that did not happen offers a retry whose error is hidden behind it.
        setStep("form");
      }
    } catch {
      toast.error("Nie udało się usunąć. Spróbuj ponownie.");
      setIsSubmitting(false);
      setStep("form");
    }
  };

  const isDeleteConfirm = step === "confirm" && pendingAction === "delete";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Escape and an overlay click are the two dismissals the disabled `Anuluj` buttons do not
          cover. Left open, they let the dialog close while a write is in flight, so the user
          believes they cancelled while N rows land. Held shut until the request settles. */}
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-primary text-xl">
            {isDeleteConfirm
              ? "Usuń nieobecności z zakresu dni"
              : isRange
                ? "Dodaj nieobecność na zakres dni"
                : existingAbsence
                  ? "Edytuj nieobecność"
                  : "Dodaj nieobecność"}
          </DialogTitle>
          <DialogDescription>
            {isDeleteConfirm
              ? "Usunięcia nie można cofnąć. Sprawdź listę dni poniżej przed potwierdzeniem."
              : "Wybierz typ nieobecności i zakres. Dla wpisu godzinowego podaj obie godziny. Urlop i urlop planowany można dodatkowo oznaczyć jako priorytetowy."}
          </DialogDescription>
          {/* `capitalize` only on the single-day heading, which starts with a weekday name. The
              range heading starts with a digit, and capitalizing it would title-case the month. */}
          <p className={cn("text-muted-foreground text-[13px]", !isRange && "capitalize")}>{dateHeading}</p>
          {targetEmployee.id !== currentEmployee.id && (
            <p className="text-primary text-[13px] font-bold">
              {targetEmployee.first_name} {targetEmployee.last_name}
            </p>
          )}
        </DialogHeader>

        {step === "confirm" && (
          <div className="grid gap-3 py-2">
            {/* Only the lead paragraph branches; the day list below is shared verbatim, because
                both verbs are destroying the same rows and the user needs the same facts to judge
                either one. */}
            <p className="text-sm text-black">
              {pendingAction === "delete" ? (
                <>
                  Czy na pewno chcesz usunąć {occupiedDays.length.toString()}{" "}
                  {pluralPl(occupiedDays.length, "wpis", "wpisy", "wpisów")}? Poniższe dni zostaną usunięte z
                  kalendarza.
                </>
              ) : (
                <>
                  Czy na pewno chcesz nadpisać {occupiedDays.length.toString()}{" "}
                  {pluralPl(occupiedDays.length, "istniejący wpis", "istniejące wpisy", "istniejących wpisów")}?
                  Poniższe dni zostaną zastąpione, a ich dotychczasowe godziny przepadną.
                </>
              )}
            </p>
            {/* Each affected day named, not just counted. Replacing a partial-day training entry
                with a full-day urlop destroys its hours, and „3 wpisy" says neither which three nor
                what they hold. The days come from a prop the grid computed off the absences it
                already renders, so this list costs no request.

                Hours read through `rawTimeRange`, the ungated view — the same reasoning as the
                cell's tooltip. This names what is about to be destroyed, so a legacy row carrying
                hours on a type the product now forbids them on must still show them. */}
            <ul className="border-line divide-line max-h-[240px] divide-y overflow-y-auto rounded-[10px] border text-[13px]">
              {occupiedDays.map(({ key, date, absence }) => {
                const type = absenceTypes.find((t) => t.id === absence.absence_type_id);
                const hours = rawTimeRange(absence);
                return (
                  <li key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="shrink-0 font-bold text-black">
                      {date.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}
                    </span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-right">
                      {type?.name ?? "nieznany typ"}
                    </span>
                    <span className="text-muted-foreground shrink-0">{hours || "cały dzień"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Hidden rather than unmounted on the confirm step. `display: none` takes it out of the
            accessibility tree and out of the tab order just as unmounting would, but leaves the
            DOM — and the roving-radiogroup tab indices — exactly as the user left them, so
            „Anuluj" returns to the form they filled rather than to a freshly mounted one. */}
        <div className={cn("grid gap-4 py-2", step === "confirm" && "hidden")}>
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

          {/* Unmounted, not hidden — the opposite of the confirm-step wrapper above, and
              deliberately so. That one uses `display:none` to preserve the roving tab indices a
              user already moved; this control has no such state, so an ineligible type should
              take it out of the accessibility tree and the tab order entirely rather than leave
              a checkbox the user can reach but not legally use. */}
          {canBePriority && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is-priority"
                checked={isPriority}
                onChange={(e) => {
                  setIsPriority(e.target.checked);
                }}
                // Cloned from „Cały dzień" above, native control included: see the note there for
                // why this is not a Radix Checkbox.
                className="accent-primary focus-visible:ring-ring/50 h-4 w-4 cursor-pointer rounded-[4px] focus-visible:ring-[3px] focus-visible:outline-none"
              />
              <Label htmlFor="is-priority" className="cursor-pointer">
                Priorytet
              </Label>
            </div>
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
          {step === "confirm" ? (
            <>
              {/* „Anuluj" here steps back to the form rather than closing the dialog — the user is
                  declining the overwrite, not abandoning the absence they just described. */}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep("form");
                }}
                disabled={isSubmitting}
              >
                Anuluj
              </Button>
              {/* Reuses `isSubmitting`, so a double-press cannot fire two bulk requests. */}
              {pendingAction === "delete" ? (
                <Button type="button" variant="destructive" onClick={handleRangeDelete} disabled={isSubmitting}>
                  {isSubmitting ? "Usuwanie…" : "Usuń wpisy"}
                </Button>
              ) : (
                <Button type="button" variant="destructive" onClick={submitAbsence} disabled={isSubmitting}>
                  {isSubmitting ? "Zapisywanie…" : "Nadpisz i zapisz"}
                </Button>
              )}
            </>
          ) : (
            <>
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
              {/* Hidden, not disabled, when the run holds nothing — the same rule the single-day
                  arm above follows (`existingAbsence &&`), so one convention covers both modes:
                  withhold the affordance rather than render a no-op. */}
              {isRange && occupiedDays.length > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRangeDeleteRequest}
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
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
