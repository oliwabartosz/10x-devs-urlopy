import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  MAX_END_MINUTES,
  MAX_SPAN_MINUTES,
  MINUTES_PER_DAY,
  MIN_START_MINUTES,
  STEP_MINUTES,
  angleToMinutes,
  announcedBounds,
  cartesianToAngle,
  constrainPair,
  formatClockTime,
  handleBounds,
  minutesToAngle,
  parseClockTime,
  polarToCartesian,
  stepFrom,
} from "@/lib/time-dial";
import type { DialHandle } from "@/lib/time-dial";

/**
 * A 24-hour range dial for a partial-day absence.
 *
 * Rendering and events only — every numeric decision belongs to `@/lib/time-dial`, which is the
 * half that unit tests can reach. In particular, a position is passed through `constrainHandle`
 * *before* it is committed, never committed and then repaired: a handle that jumped back after
 * landing would be the same silent rewrite this change exists to remove.
 *
 * The face is 24-hour, so 06:00 and 18:00 sit on opposite sides and the sub-06:00 dead zone is one
 * contiguous wedge rather than two halves of a 12-hour clock.
 *
 * Not standalone-focusable: it is meant to live in a `PopoverContent`, which gives it its own
 * dismissable layer inside the absence dialog. See `ui/popover.tsx`.
 */

const CENTER = 120;
const TRACK_RADIUS = 92;
const TRACK_WIDTH = 20;
const TICK_OUTER_RADIUS = 78;
const TICK_INNER_RADIUS = 74;
const TICK_INNER_RADIUS_MAJOR = 70;
const LABEL_RADIUS = 58;
const HANDLE_RADIUS = 9;

/** Every third hour gets a number; all 24 get a tick. More than that is noise at this size. */
const LABELLED_HOUR_INTERVAL = 3;

const STEPS_PER_HOUR = 60 / STEP_MINUTES;

/**
 * Matches the 5px `PointerSensor` activation constraint the grid drags with
 * (`AbsenceGrid.tsx:110`), so a click that wobbles focuses the handle instead of nudging the time.
 */
const DRAG_ACTIVATION_DISTANCE = 5;

/**
 * What the dial shows when a field is still empty — a plain working day, not a domain rule.
 * The moment a handle moves, both fields are written, so this is only ever a starting picture.
 */
const SEED_START_MINUTES = 8 * 60;

interface TimeRangeDialProps {
  /** `"HH:MM"`. An empty or malformed value falls back to the seed range. */
  startTime: string;
  /** `"HH:MM"`. An empty or malformed value falls back to a full working day after the start. */
  endTime: string;
  /** Fires with both times whenever a handle actually moves. Always `"HH:MM"`. */
  onChange: (startTime: string, endTime: string) => void;
}

export function TimeRangeDial({ startTime, endTime, onChange }: TimeRangeDialProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    handle: DialHandle;
    pointerId: number;
    originX: number;
    originY: number;
    centerX: number;
    centerY: number;
    activated: boolean;
  } | null>(null);

  const startMinutes = parseClockTime(startTime) ?? SEED_START_MINUTES;
  const endMinutes = parseClockTime(endTime) ?? Math.min(startMinutes + MAX_SPAN_MINUTES, MAX_END_MINUTES);

  // `constrainPair`, not `constrainHandle`: the anchor is whatever the typed field holds, and the
  // blur clamp does not run while the other field is empty — so echoing it back unchanged could
  // commit a value the API rewrites silently. The pair that leaves here is one the server returns
  // untouched.
  const commit = (handle: DialHandle, candidateMinutes: number) => {
    const next = constrainPair({ handle, candidateMinutes, startMinutes, endMinutes });
    if (next.startMinutes === startMinutes && next.endMinutes === endMinutes) return;
    onChange(formatClockTime(next.startMinutes), formatClockTime(next.endMinutes));
  };

  const onHandleKeyDown = (handle: DialHandle) => (event: KeyboardEvent<SVGGElement>) => {
    const current = handle === "start" ? startMinutes : endMinutes;
    const bounds = handleBounds(handle, startMinutes, endMinutes);
    let candidate: number;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        candidate = stepFrom(current, 1);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        candidate = stepFrom(current, -1);
        break;
      case "PageUp":
        candidate = stepFrom(current, STEPS_PER_HOUR);
        break;
      case "PageDown":
        candidate = stepFrom(current, -STEPS_PER_HOUR);
        break;
      case "Home":
        candidate = bounds.min;
        break;
      case "End":
        candidate = bounds.max;
        break;
      default:
        return;
    }
    // Only after a key we actually handle: PageUp/PageDown and the arrows scroll the popover
    // otherwise, and Home/End would jump the dialog.
    event.preventDefault();
    commit(handle, candidate);
  };

  const onHandlePointerDown = (handle: DialHandle) => (event: PointerEvent<SVGGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // The face is a circle, so only the *direction* from its centre carries a time — the
    // viewBox-to-pixel scale cancels out and never has to be measured.
    dragRef.current = {
      handle,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      activated: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    // preventDefault stops the browser starting a selection or a native drag, but it also
    // suppresses the focus that a press would normally give — so take focus explicitly, or a
    // pointer user could not carry on with the arrow keys.
    event.preventDefault();
    event.currentTarget.focus();
  };

  const onHandlePointerMove = (event: PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (!drag.activated) {
      if (Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) < DRAG_ACTIVATION_DISTANCE) return;
      drag.activated = true;
    }
    commit(drag.handle, angleToMinutes(cartesianToAngle(event.clientX - drag.centerX, event.clientY - drag.centerY)));
  };

  const onHandlePointerEnd = (event: PointerEvent<SVGGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handles: { handle: DialHandle; minutes: number; label: string }[] = [
    { handle: "start", minutes: startMinutes, label: "Godzina rozpoczęcia" },
    { handle: "end", minutes: endMinutes, label: "Godzina zakończenia" },
  ];

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 240 240"
      role="group"
      aria-label="Zakres godzin"
      className="h-60 w-60 max-w-full touch-none select-none"
    >
      {/* Base track: the whole day. */}
      <circle cx={CENTER} cy={CENTER} r={TRACK_RADIUS} className="stroke-surface fill-none" strokeWidth={TRACK_WIDTH} />

      {/* Dead zone: everything before the 06:00 floor, unreachable by either handle. */}
      <path d={arcPath(0, MIN_START_MINUTES)} className="stroke-line-strong fill-none" strokeWidth={TRACK_WIDTH} />

      {/* The selected range. */}
      <path d={arcPath(startMinutes, endMinutes)} className="stroke-primary fill-none" strokeWidth={TRACK_WIDTH} />

      {Array.from({ length: 24 }, (_, hour) => {
        const degrees = minutesToAngle(hour * 60);
        const major = hour % LABELLED_HOUR_INTERVAL === 0;
        const outer = polarToCartesian({ cx: CENTER, cy: CENTER, radius: TICK_OUTER_RADIUS, degrees });
        const inner = polarToCartesian({
          cx: CENTER,
          cy: CENTER,
          radius: major ? TICK_INNER_RADIUS_MAJOR : TICK_INNER_RADIUS,
          degrees,
        });
        return (
          <line
            key={hour}
            x1={round(outer.x)}
            y1={round(outer.y)}
            x2={round(inner.x)}
            y2={round(inner.y)}
            className={major ? "stroke-muted-foreground" : "stroke-line"}
            strokeWidth={major ? 1.5 : 1}
          />
        );
      })}

      {Array.from({ length: 24 / LABELLED_HOUR_INTERVAL }, (_, index) => {
        const hour = index * LABELLED_HOUR_INTERVAL;
        const point = polarToCartesian({
          cx: CENTER,
          cy: CENTER,
          radius: LABEL_RADIUS,
          degrees: minutesToAngle(hour * 60),
        });
        return (
          <text
            key={hour}
            x={round(point.x)}
            y={round(point.y)}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {String(hour).padStart(2, "0")}
          </text>
        );
      })}

      {/* Readout, so a pointer user reads the value they are dragging without leaving the dial. */}
      <text x={CENTER} y={114} textAnchor="middle" className="fill-primary text-[14px] font-bold">
        {formatClockTime(startMinutes)} – {formatClockTime(endMinutes)}
      </text>
      <text x={CENTER} y={132} textAnchor="middle" className="fill-muted-foreground text-[10px]">
        {formatDuration(endMinutes - startMinutes)}
      </text>

      {handles.map(({ handle, minutes, label }) => {
        // What is *said* about the handle, which is not always what `handleBounds` returns — see
        // `announcedBounds`. Movement still goes through the raw window, via `commit`.
        const bounds = announcedBounds(handle, minutes, startMinutes, endMinutes);
        const point = polarToCartesian({
          cx: CENTER,
          cy: CENTER,
          radius: TRACK_RADIUS,
          degrees: minutesToAngle(minutes),
        });
        return (
          <g
            key={handle}
            role="slider"
            tabIndex={0}
            aria-label={label}
            // No `aria-orientation`: a circular slider is neither horizontal nor vertical, and
            // ARIA's third value ("undefined") is not in React's prop types. The implied
            // horizontal costs nothing here — both arrow pairs are handled, so either assumption
            // matches the keys that work.
            aria-valuemin={bounds.min}
            aria-valuemax={bounds.max}
            aria-valuenow={minutes}
            aria-valuetext={formatClockTime(minutes)}
            aria-disabled={bounds.movable ? undefined : true}
            onKeyDown={onHandleKeyDown(handle)}
            onPointerDown={onHandlePointerDown(handle)}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerEnd}
            onPointerCancel={onHandlePointerEnd}
            className="group cursor-grab touch-none outline-none active:cursor-grabbing"
          >
            {/* A finger is wider than the visible handle. */}
            <circle cx={round(point.x)} cy={round(point.y)} r={HANDLE_RADIUS + 10} fill="transparent" />
            {/* The `--ring` halo `input.tsx:12` gives a focused field. box-shadow does not render
                on SVG shapes, so the ring is drawn rather than applied as a utility. */}
            <circle
              cx={round(point.x)}
              cy={round(point.y)}
              r={HANDLE_RADIUS + 2.5}
              strokeWidth={3}
              className="stroke-ring/50 fill-none opacity-0 group-focus-visible:opacity-100"
            />
            <circle
              cx={round(point.x)}
              cy={round(point.y)}
              r={HANDLE_RADIUS}
              strokeWidth={2.5}
              className={
                handle === "start" ? "fill-primary stroke-card" : "fill-card stroke-primary group-hover:fill-accent"
              }
            />
          </g>
        );
      })}
    </svg>
  );
}

/** A clockwise arc between two times, on the track. */
function arcPath(fromMinutes: number, toMinutes: number): string {
  const from = polarToCartesian({
    cx: CENTER,
    cy: CENTER,
    radius: TRACK_RADIUS,
    degrees: minutesToAngle(fromMinutes),
  });
  const to = polarToCartesian({ cx: CENTER, cy: CENTER, radius: TRACK_RADIUS, degrees: minutesToAngle(toMinutes) });
  const sweep = (((toMinutes - fromMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  // Only reachable for a range saved before the cap existed; the dial itself never opens past 8 h.
  const largeArc = sweep > MINUTES_PER_DAY / 2 ? 1 : 0;
  return `M ${round(from.x)} ${round(from.y)} A ${TRACK_RADIUS} ${TRACK_RADIUS} 0 ${largeArc} 1 ${round(to.x)} ${round(to.y)}`;
}

/** „4 h 30 min" — the span, in the units the balance is reasoned about in. */
function formatDuration(minutes: number): string {
  if (minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} h`;
  return `${String(hours)} h ${String(rest)} min`;
}

/** Keeps float noise out of the rendered path data. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
