# Deactivated Employee Grid — Implementation Plan

## Overview

Fix a bug where historical absences of deactivated employees are invisible to moderators in the monthly grid (and Details/Stats tabs). The employee columns are displayed correctly already; only the absence data is stripped by an over-broad `isNull(employees.deleted_at)` condition in two query sites.

## Current State Analysis

The monthly grid in `dashboard.astro` fetches absences with:

```
.innerJoin(employeesTable, and(eq(absencesTable.employee_id, employeesTable.id), isNull(employeesTable.deleted_at)))
```

The `isNull` predicate filters out any absence whose employee record has `deleted_at IS NOT NULL` — even for a moderator viewing a historical month where the employee was still active. The `gridEmployees` filter at `dashboard.astro:105–112` already handles column visibility correctly (shows deactivated employees who were active during the viewed month), but the absences are missing, leaving those columns empty.

The same `isNull` filter appears in `/api/absences/index.ts:99`, which serves the Details subcards' today/yearly lazy-fetches.

`AbsenceGrid.tsx` currently renders all employee columns identically regardless of `deleted_at`, and treats all moderator cells as clickable. `Employee.deleted_at` is already in the type (via Drizzle `$inferSelect`) and present in the props at runtime.

## Desired End State

**For moderators:**
- Deactivated employee columns in the monthly grid display their historical absence colors for the viewed month.
- Deactivated employee column headers show a gray background and a `(nakt.)` suffix after the name.
- Clicking on a deactivated employee's cell does nothing — no dialog, no cursor-pointer.
- Details and Stats tabs for the viewed month reflect the same absences (automatic consequence of the query fix).

**For regular employees:**
- Behavior unchanged — deactivated employees' columns and absences remain hidden.

**Known limitation (out of scope):** In the Yearly subcard, deactivated employees' absences from months outside the viewed month may show "—" for the employee name. This is a follow-up issue.

### Key Discoveries

- `dashboard.astro:99` — `innerJoin` with `isNull(employeesTable.deleted_at)` is the primary bug site.
- `api/absences/index.ts:99` — Same pattern; used by `AbsenceDetailsSubcards` for client-side fetches.
- `dashboard.astro:105–112` — `gridEmployees` filter already correct; no changes needed here.
- `AbsenceGrid.tsx:98` — `const clickable = (isOwn || isModerator) && !isWeekend;` — deactivated cells need an extra guard.
- `AbsenceGrid.tsx:63–78` — column header renders `{emp.first_name} {emp.last_name}` with a background class; both need to be conditional on `emp.deleted_at`.
- `Employee` type = `typeof employees.$inferSelect` → includes `deleted_at: Date | null`. At runtime in React islands, Astro serializes `Date` as an ISO string, so the check must be truthiness-based (`!!emp.deleted_at`), not `instanceof Date`.

## What We're NOT Doing

- Fixing the yearly subcard employee name resolution for deactivated employees (follow-up).
- Allowing moderators to add/edit absences for deactivated employees (they are read-only).
- Any schema or RLS changes — `deleted_at` is already in place.
- Changing behavior for regular employees — they continue to see only active employees.

## Implementation Approach

**Phase 1** — Fix the two absences query sites so moderators receive deactivated employees' absences. Both sites use the same pattern; the fix in each is a one-line conditional join predicate.

**Phase 2** — Update `AbsenceGrid` to mark deactivated employee columns visually and block clicking on their cells.

## Phase 1: Fix Absences Query

### Overview

Make the `innerJoin` condition on `employees` role-aware: moderators join without the `isNull(deleted_at)` guard; regular employees retain it. No structural query changes — only the join predicate differs.

### Changes Required

#### 1. `dashboard.astro` — role-conditional join predicate

**File:** `src/pages/dashboard.astro`

**Intent:** Let moderators receive absences for deactivated employees. Regular employees must not (they have no deactivated employee columns and would see "—" rows in Details).

**Contract:** At the absences `innerJoin` call (currently line 99), compute the join condition before the query using the already-known `currentEmployee.role`:

```ts
const absencesJoin =
  currentEmployee.role === "moderator"
    ? eq(absencesTable.employee_id, employeesTable.id)
    : and(eq(absencesTable.employee_id, employeesTable.id), isNull(employeesTable.deleted_at));
```

Pass `absencesJoin` as the second argument to `.innerJoin(employeesTable, absencesJoin)`.

Also add the `isNotNull` import from `drizzle-orm` only if not already present — the existing imports at line 10 already include `isNull`; `isNotNull` is not needed for this change.

#### 2. `/api/absences` — same conditional in the GET handler

**File:** `src/pages/api/absences/index.ts`

**Intent:** The route serves `AbsenceDetailsSubcards` lazy-fetches (today/yearly subcards). A moderator fetching yearly data should receive deactivated employees' absences.

**Contract:** At the absences `innerJoin` (currently line 99), apply the same pattern using the already-fetched `employeeRow.role`:

```ts
const joinCondition =
  employeeRow.role === "moderator"
    ? eq(absences.employee_id, employees.id)
    : and(eq(absences.employee_id, employees.id), isNull(employees.deleted_at));
```

Pass `joinCondition` to `.innerJoin(employees, joinCondition)`.

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Log in as a moderator. Ensure at least one employee has `deleted_at` set and had absences in the same month. Navigate to that month — absence cells for the deactivated employee should now appear colored in the grid.
- Log in as a regular employee. Deactivated employees' columns and absences remain invisible.

**Implementation Note:** After automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: AbsenceGrid Visual Indicator and Read-Only Cells

### Overview

Update `AbsenceGrid.tsx` to visually distinguish deactivated employee columns and prevent clicking on their cells.

### Changes Required

#### 1. Column header — inactive indicator

**File:** `src/components/absence/AbsenceGrid.tsx`

**Intent:** Give moderators a visual signal that a column belongs to a deactivated employee, to prevent confusion about why `+` doesn't appear on hover.

**Contract:** Inside the `employees.map` for column headers (currently lines 63–78), derive an `isInactive` boolean: `const isInactive = !!emp.deleted_at;`. Apply conditionally:
- Background class: `isInactive ? "bg-gray-100" : isOwn ? "bg-blue-50" : "bg-gray-50"`
- Name span: append `" (nakt.)"` to the rendered name when `isInactive` is true.

The `deleted_at` field is already on the `Employee` type and in the props at runtime (serialized as an ISO string by Astro — truthy when set, null otherwise).

#### 2. Cell clickability — read-only for deactivated employees

**File:** `src/components/absence/AbsenceGrid.tsx`

**Intent:** Block the `AbsenceFormDialog` from opening on deactivated employee cells. The absence color should still render (display-only).

**Contract:** In the body row cell loop (currently line 98), add a guard to `clickable`:

```ts
const clickable = (isOwn || isModerator) && !isWeekend && !isInactive;
```

`isInactive` must be derived inside the `employees.map` for cells too (same `!!emp.deleted_at` check). The `+` placeholder (currently line 119–121) is already gated on `clickable`, so it will also be suppressed automatically.

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Deactivated employee column header shows a slightly darker gray background and "(nakt.)" after the name.
- Hovering/clicking a deactivated employee's cell does not open the dialog. No `+` appears on hover.
- Existing absence colors for deactivated employees still render (Phase 1 fix visible).
- Active employee columns are unaffected — same background, same click behavior as before.

**Implementation Note:** After automated checks pass, pause for manual confirmation before proceeding to epilogue.

---

## Testing Strategy

### Manual Testing Steps

1. Create a test scenario: have an employee with absences in the current month, then deactivate them via the moderator's employee management sheet.
2. As moderator, navigate to that month's grid — verify the absence colors appear and the column shows "(nakt.)".
3. Click on one of the deactivated employee's colored cells — verify no dialog opens.
4. Click on an empty cell of the deactivated employee — verify no dialog, no `+` on hover.
5. Navigate to Details tab for the same month — verify the absences appear in the table with the employee's name.
6. Navigate to Stats tab — verify the absence counts include the deactivated employee.
7. As a regular employee, verify no change in behavior — deactivated employee columns not visible.

## Performance Considerations

No performance impact — removing the `isNull` join predicate for moderators means a slightly broader result set, but team size is ≤10 employees and monthly absences are a tiny dataset.

## References

- Roadmap S-08: `context/foundation/roadmap.md`
- Schema: `src/db/schema.ts:17–25`
- Grid component: `src/components/absence/AbsenceGrid.tsx`
- Dashboard page: `src/pages/dashboard.astro`
- Absences API: `src/pages/api/absences/index.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fix Absences Query

#### Automated

- [x] 1.1 Build passes: npm run build — 1685886
- [x] 1.2 Lint passes: npm run lint — 1685886

#### Manual

- [x] 1.3 Moderator sees deactivated employee's absence colors in the grid for the month they were active — 1685886
- [x] 1.4 Regular employee view unchanged — no deactivated employee columns or absences visible — 1685886

### Phase 2: AbsenceGrid Visual Indicator and Read-Only Cells

#### Automated

- [x] 2.1 Build passes: npm run build — cc768af
- [x] 2.2 Lint passes: npm run lint — cc768af

#### Manual

- [x] 2.3 Deactivated column header shows gray background and "(nakt.)" suffix — cc768af
- [x] 2.4 Clicking deactivated employee's cell opens no dialog; no "+" on hover — cc768af
- [x] 2.5 Absence colors still render on deactivated employee cells — cc768af
- [x] 2.6 Active employee columns unaffected — cc768af
