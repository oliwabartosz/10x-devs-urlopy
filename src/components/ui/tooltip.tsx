import * as React from "react";
// The unified `radix-ui` package, matching every other primitive here (popover.tsx:6,
// select.tsx:3, dialog.tsx:3). `npx shadcn@latest add tooltip` would write
// `@radix-ui/react-tooltip` instead, pulling a second Radix copy into a bundle CI measures
// (.github/workflows/ci.yml:47) — which is why this file is hand-written, like popover.tsx.
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Radix requires a provider above every tooltip, so `Tooltip` carries its own rather than making
 * each caller remember one. Nesting providers is supported; the outer one only supplies defaults.
 */
function Tooltip({ delayDuration = 200, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipPrimitive.Provider>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * Portaled, like `PopoverContent` (popover.tsx:32) — which is what lets it escape the absence
 * dialog's stacking context instead of being clipped by it.
 *
 * A tooltip opens on hover *and* on keyboard focus, so the explanation is reachable without a
 * pointer. It is deliberately not the only place a rule is stated: the toast still names a
 * correction after the fact, and the dial refuses illegal positions outright.
 */
function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-primary text-primary-foreground data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 z-50 max-w-72 origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-2 text-xs leading-relaxed text-balance",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipTrigger };
