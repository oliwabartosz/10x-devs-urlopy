# Ground Truth — `react-16-to-19-migration`

The fixture (`pr.diff`) migrates `LeaveRequestsPanel` from a React 16 class
component to a React 19 function component, and switches its island entry point
from `ReactDOM.render` to `createRoot`. **Most of the migration is correct and
idiomatic** — class → function, `static contextType` → `useContext`, class
state → `useState`, bound handler → plain function, `render()` → returned JSX,
and `ReactDOM.render(el, ...)` → `createRoot(el).render(...)` are all sound.

Three impactful bugs are planted in that otherwise-plausible migration. A
competent review must surface all three and fail the PR. This document is the
authoritative reference the Phase 3 LLM rubrics paraphrase — keep the rubrics in
sync with the headings below.

---

## Flaw 1 — Stale-closure poll interval freezes the merge base

**Where:** the first `useEffect(() => { ... }, [])` (the polling effect), line
`setRequests(mergeById(requests, incoming));`.

**What the class did:** the `setInterval` callback in `componentDidMount` used a
functional updater — `this.setState((prev) => ({ requests: mergeById(prev.requests, incoming) }))`
— so each poll merged against the **current** requests.

**The bug:** the migration reads `requests` directly from the effect closure,
and the effect's dependency array is `[]`, so `requests` is permanently captured
at its initial value (`[]`). Every poll therefore merges incoming rows against
an empty base instead of the live list.

**User-visible symptom:** rows added optimistically (or merged in) between polls
are silently discarded on the next 30-second tick — the panel repeatedly resets
to just the latest server page, so entries flicker and disappear. Data loss.

**Correct migration:** use a functional update — `setRequests((prev) => mergeById(prev, incoming))`
— (optionally adding `orgId` to the dependency array), so the merge base is
always current without re-subscribing the interval.

---

## Flaw 2 — Dropped cleanup leaks the subscription and set-states after unmount

**Where:** the second `useEffect(() => { loadRequests(); leaveEvents.subscribe(loadRequests); }, [])`
(the load-and-subscribe effect). It has **no cleanup return**.

**What the class did:** `componentDidMount` stored the unsubscribe handle
(`this.unsubscribe = leaveEvents.subscribe(this.handleExternalChange)`) and
`componentWillUnmount` called `this.unsubscribe?.()` (alongside
`clearInterval`).

**The bug:** the migration throws away the value returned by
`leaveEvents.subscribe(...)` and the effect returns nothing, so the listener is
never removed. The subscription outlives the component: every mount leaks
another listener, and because `loadRequests` performs an async fetch that calls
`setRequests`, a `leaveEvents` fire (or an in-flight fetch) after unmount runs a
state setter on an unmounted component — a classic leak + set-state-after-unmount
race.

**User-visible symptom:** growing memory/listener leak across mounts, stale
callbacks firing against dead components, and React's "state update on an
unmounted component" warnings; in the worst case the wrong org's data is written
after navigation.

**Correct migration:** capture and release the subscription in a cleanup —
`const unsubscribe = leaveEvents.subscribe(loadRequests); return () => unsubscribe();`
(and guard/abort the in-flight fetch as needed).

---

## Flaw 3 — Inline object in the dependency array causes an infinite render loop

**Where:** the third `useEffect(..., [requests, { status: statusFilter }])`
(the derived-view effect), specifically the `{ status: statusFilter }` element
in the dependency array.

**What the class did:** `static getDerivedStateFromProps` recomputed
`visibleRequests` synchronously from `state.requests` and `props.statusFilter`
during render — no extra render pass.

**The bug:** the effect writes derived state (`setVisibleRequests(...)`) and its
dependency array contains a freshly-allocated object literal `{ status: statusFilter }`.
That object has a new reference on **every** render, so React always considers
the dependencies changed, re-runs the effect after every commit, which calls
`setVisibleRequests` and triggers another render — an unconditional infinite
render loop.

**User-visible symptom:** the component spins at 100% CPU immediately on mount,
the tab hangs/freezes, and React eventually throws "Maximum update depth
exceeded." The panel is effectively unusable.

**Correct migration:** depend on the primitive, not a wrapper object —
`[requests, statusFilter]` — or (better) drop the effect entirely and derive the
value during render with `useMemo(() => requests.filter((r) => matchesFilter(r, statusFilter)), [requests, statusFilter])`.

---

## Expected overall outcome

A competent review **must fail this PR**: it ships three severe defects (data
loss, a memory/race leak, and an infinite render loop), so the implementation
criterion must score **below `PASS_FLOOR` (5)** and `deriveVerdict` must return
`"failed"`. A review that finds fewer than all three flaws — or that passes the
PR despite them — is a weaker result, and that gap is exactly the signal this
eval exists to surface across the three models.
