// The only module in this codebase that knows hucre exists.
//
// It maps the writer-agnostic model from `@/lib/export-workbook` onto hucre's write model and
// hands the resulting bytes to the browser. Keeping the vendor confined here is the mitigation
// for its bus-factor-1 risk: swapping XLSX writers rewrites this file, not the feature.
//
// Browser-only — `downloadWorkbook` touches `document` and `URL.createObjectURL`. The writer
// itself is reached through a dynamic `import()` so its ~39 KiB gzip never lands in the
// dashboard's initial payload; only a moderator who actually exports pays for it.
import type { Cell, CellStyle, WriteSheet } from "hucre/xlsx";
import type { ExportCell, ExportSheet } from "@/lib/export-workbook";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Shown as the note's owner in Excel's comment box. */
const NOTE_AUTHOR = "Nieobecności";

/** Thin dotted black outline. One shared object: hucre folds identical styles into one XF. */
const DOTTED_SIDE = { style: "dotted", color: { rgb: "FF000000" } } as const;
const DOTTED_BORDER: NonNullable<CellStyle["border"]> = {
  top: DOTTED_SIDE,
  right: DOTTED_SIDE,
  bottom: DOTTED_SIDE,
  left: DOTTED_SIDE,
};

/**
 * `#rrggbb` → `RRGGBB`. hucre's `Color.rgb` takes the hex **without** the leading `#` and emits
 * it as `FFRRGGBB`; the catalogue stores it with the `#`.
 */
function rgb(hex: string): string {
  return hex.replace(/^#/, "").toUpperCase();
}

function toCell(cell: ExportCell): Partial<Cell> {
  const style: CellStyle = {};
  if (cell.fill) {
    style.fill = { type: "pattern", pattern: "solid", fgColor: { rgb: rgb(cell.fill) } };
  }
  if (cell.textColor ?? cell.bold) {
    style.font = {
      ...(cell.textColor ? { color: { rgb: rgb(cell.textColor) } } : {}),
      ...(cell.bold ? { bold: true } : {}),
    };
  }
  if (cell.wrap) {
    style.alignment = { wrapText: true };
  }
  if (cell.border) {
    style.border = DOTTED_BORDER;
  }

  // A day with no absence is an empty cell that still carries a fill and a border — that
  // combination is deliberate, not a degenerate case, so the value is written even when it is "".
  const out: Partial<Cell> = { value: cell.text, style };
  if (cell.note) {
    out.comment = { author: NOTE_AUTHOR, text: cell.note };
  }
  return out;
}

/** The Phase 1 sheet model as XLSX bytes. */
export async function writeWorkbook(sheets: ExportSheet[]): Promise<Uint8Array> {
  const { writeXlsx } = await import("hucre/xlsx");

  const writeSheets: WriteSheet[] = sheets.map((sheet) => ({
    name: sheet.name,
    columns: sheet.columnWidths.map((width) => ({ width })),
    rows: sheet.rows.map((row) => row.map(toCell)),
    // The property is `freezePane`, NOT `freeze`. The wrong key is a silent no-op: the file
    // still writes and `<sheetView>` simply comes out with no `<pane>` element, so this can
    // only be verified against the generated XML — never against the absence of an error.
    freezePane: { rows: sheet.freezeRows, columns: sheet.freezeColumns },
  }));

  return writeXlsx({ sheets: writeSheets });
}

/** Hand the bytes to the browser as a file download. Browser-only. */
export function downloadWorkbook(bytes: Uint8Array, filename: string): void {
  // `Uint8Array<ArrayBufferLike>` is not assignable to `BlobPart`, whose view type is pinned to
  // a non-shared `ArrayBuffer`. The writer never returns a SharedArrayBuffer-backed view, so the
  // narrowing is safe; there is no runtime conversion that would avoid the assertion.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  // ASCII-only by contract — a non-ASCII `download` value is honoured inconsistently.
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred rather than immediate: Safari cancels an in-flight download when the object URL
  // is revoked in the same tick as the click.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
