import type { KeyboardEvent } from "react";

export interface RovingRadioGroup {
  /** Attach to the element carrying `role="radiogroup"`; handles arrows, Home and End. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Roving tabindex — the active option is the group's single tab stop. */
  tabIndexFor: (index: number) => 0 | -1;
}

/**
 * Keyboard behaviour for a hand-rolled `role="radiogroup"`.
 *
 * S-17 replaced two shadcn `<Select>` primitives with button grids for the absence type
 * and substitute pickers. The roles and `aria-checked` came across, but the primitives
 * had also been providing arrow-key navigation and a single tab stop — without those, a
 * radiogroup is a row of N tab stops that ignores the arrow keys, which is not the
 * pattern its role advertises.
 *
 * Arrows wrap in both directions, Home/End jump to the ends, and selection follows focus
 * (the standard radiogroup contract). Focus moves by querying `event.currentTarget` — the
 * group element the handler is attached to — for `[role="radio"]`, so the options' DOM
 * order must match the index `onSelect` receives. Deliberately ref-free: returning a ref
 * would mean touching it during render at the JSX attribute.
 */
export function useRovingRadioGroup(
  count: number,
  selectedIndex: number,
  onSelect: (index: number) => void,
): RovingRadioGroup {
  // Nothing selected yet still needs a tab stop, so fall back to the first option.
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (count === 0) return;
    const last = count - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = activeIndex >= last ? 0 : activeIndex + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = activeIndex <= 0 ? last : activeIndex - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    onSelect(next);
    // `.at()` rather than an index so a DOM/count mismatch is a no-op, not a throw.
    Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')).at(next)?.focus();
  };

  return {
    onKeyDown,
    tabIndexFor: (index: number) => (index === activeIndex ? 0 : -1),
  };
}
