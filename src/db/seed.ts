import type { DatabaseSync } from "node:sqlite";

/**
 * The canonical absence-type catalogue, consolidated.
 *
 * These are the **final** values — what the Postgres environment holds after
 * `20260526000002_seed_absence_types.sql` seeded six types, `20260722120000` added
 * `urlop planowany`, `20260807122840` adopted the new-design palette/icons/order, and
 * `20260812153000` corrected the offsite icon. The last of those matters: the grid cell carries
 * no type name, so the icon is the only per-type signal, and the 8-codepoint ZWJ sequence it
 * replaced ("🏃🏼‍♂️‍➡️", U+1F3C3 U+1F3FC U+200D U+2642 U+FE0F U+200D U+27A1 U+FE0F) decomposes into
 * three or four glyphs on any font lacking the ligature. The value below is one codepoint, U+1F3C3.
 *
 * `name` is the key, not `id` — `src/lib/absence-types.ts` gates the partial-day feature on exact
 * name strings, and `absence_types.name` is now UNIQUE so a duplicate cannot silently break it.
 * Source for the palette: new-design/10xUrlopy.dc.html:599-607.
 */
export const ABSENCE_TYPE_SEED = [
  { name: "urlop", color: "#cceeff", text_color: "#0b5a72", icon: "🌴", display_order: 1 },
  {
    name: "szkolenie/wyjście poza miejsce pracy",
    color: "#ffcc99",
    text_color: "#8a4a00",
    icon: "🏃",
    display_order: 2,
  },
  { name: "szkolenie w miejscu pracy", color: "#ffe8a8", text_color: "#7a5b00", icon: "🎓", display_order: 3 },
  { name: "choroba", color: "#2f578c", text_color: "#ffffff", icon: "🤒", display_order: 4 },
  { name: "wyjazd zagraniczny", color: "#f2a3a3", text_color: "#7d0d1c", icon: "🌍", display_order: 5 },
  { name: "stała nieobecność", color: "#ccffcc", text_color: "#2c5c2c", icon: "🚫", display_order: 6 },
  { name: "urlop planowany", color: "#99ccff", text_color: "#0b3f6b", icon: "📅", display_order: 7 },
] as const;

/**
 * Apply the catalogue. Idempotent by `name`: inserts a missing type, and refreshes the
 * presentation columns of one that already exists, so an upgrade picks up a palette change
 * without a hand-written data migration. Never deletes — a type an absence references must stay.
 */
export function seedAbsenceTypes(handle: DatabaseSync): void {
  const insert = handle.prepare(
    `INSERT INTO absence_types (name, color, icon, text_color, display_order)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET
       color = excluded.color,
       icon = excluded.icon,
       text_color = excluded.text_color,
       display_order = excluded.display_order`,
  );
  for (const type of ABSENCE_TYPE_SEED) {
    insert.run(type.name, type.color, type.icon, type.text_color, type.display_order);
  }
}
