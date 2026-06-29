/**
 * Poranny digest statusu projektu — read-only internal builder (lekcja M5L1).
 *
 * Godzi trzy lokalne źródła stanu — `context/changes/<id>/change.md` (deklarowany
 * status), `context/foundation/roadmap.md` (status slice'ów) i `git log` (realny
 * ruch) — w jeden datowany raport Markdown w `context/team/digests/<RRRR-MM-DD>.md`.
 * Uzupełnia, nie zastępuje GitHub/Linear/CI: czyta, streszcza i LINKUJE do źródeł.
 *
 * Git jest kanoniczny dla „ruchu" — pole `updated:` we frontmatterze bywa równe
 * `created:`, więc dni bez ruchu liczymy wyłącznie z `git log -- <folder>`.
 * Parsowanie jest odporne na błędy: wadliwy `change.md` ląduje w sekcji ⚠️,
 * a nie wywraca biegu (skip-and-warn).
 *
 * NIE importuje `@/lib/...` ani `@/db/...` — tak jak `seed-admin.ts`, te moduły
 * czytają `astro:env/server` i działają tylko w Workerze. Sygnały zewnętrzne
 * (Faza C) budujemy inline z `process.env` / podprocesów.
 *
 * Usage: `npm run digest`.
 */
import { execFileSync } from "node:child_process";
import { globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/** Statusy zmiany „w toku" — kandydaci do sekcji „W toku". */
const IN_PROGRESS = ["new", "planned", "implementing"] as const;
/** Scope'y commitów, które nie mapują się na folder zmiany. */
const NON_CHANGE_SCOPES = new Set(["roadmap", "lint", "build", "ai", "deps", "ci"]);

/** Sentry — z DSN w `sentry.client.config.js` (org id, host regionalny, project id). */
const SENTRY_HOST = "de.sentry.io";
const SENTRY_ORG_ID = "4511534802993152";
const SENTRY_PROJECT_ID = "4511534806007888";

const changeFrontmatterSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["new", "planned", "implementing", "implemented", "impl_reviewed", "archived"]),
  created: z.string().min(1),
  updated: z.string().min(1),
  roadmapRef: z.string().optional(),
  title: z.string().optional(),
});

type Change = z.infer<typeof changeFrontmatterSchema> & {
  lastTouch: string | null; // ISO date z git, null = brak historii
  daysIdle: number; // dni bez ruchu wg git (0 gdy brak historii)
};

interface ParseError {
  file: string;
  reason: string;
}

/** Wytnij blok frontmatteru i rozbij na pary klucz→wartość (płaski format). */
function parseFrontmatter(raw: string): Record<string, string | undefined> {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const out: Record<string, string | undefined> = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const idx = lines[i].indexOf(":");
    if (idx === -1) continue;
    const key = lines[i].slice(0, idx).trim();
    let value = lines[i].slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, ""); // zdejmij cudzysłowy
    if (key) out[key] = value;
  }
  return out;
}

/** Data ostatniego commita dotykającego folder zmiany (ISO) lub null. */
function gitLastTouch(folder: string): string | null {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%aI", "--", folder], {
      encoding: "utf8",
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

function daysSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Wczytaj i znormalizuj wszystkie change.md; błędy → lista skip-and-warn. */
function readChanges(now: Date): { changes: Change[]; errors: ParseError[] } {
  let files: string[];
  try {
    files = globSync("context/changes/*/change.md").sort();
  } catch {
    // Brak/niedostępny katalog zmian → zero zmian, digest i tak powstaje.
    return { changes: [], errors: [] };
  }
  const changes: Change[] = [];
  const errors: ParseError[] = [];

  for (const file of files) {
    const folder = dirname(file);
    try {
      const fm = parseFrontmatter(readFileSync(file, "utf8"));
      // Niespójny frontmatter: akceptuj oba warianty kluczy.
      const normalized = {
        id: fm.id ?? fm.change_id,
        status: fm.status,
        created: fm.created,
        updated: fm.updated,
        roadmapRef: fm.roadmap_ref ?? fm.roadmap_id,
        title: fm.title,
      };
      const parsed = changeFrontmatterSchema.safeParse(normalized);
      if (!parsed.success) {
        const reason = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        errors.push({ file, reason });
        continue;
      }
      const lastTouch = gitLastTouch(folder);
      changes.push({
        ...parsed.data,
        lastTouch,
        daysIdle: lastTouch ? daysSince(lastTouch, now) : 0,
      });
    } catch (err) {
      errors.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { changes, errors };
}

/** Commity z ostatniego okna 24h, pogrupowane po scope = change-id. */
function commitsSinceYesterday(): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  let out = "";
  try {
    out = execFileSync("git", ["log", "--since=yesterday", "--pretty=%h%x09%s"], {
      encoding: "utf8",
    });
  } catch {
    return grouped;
  }
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [hash, subject = ""] = line.split("\t");
    const m = /^\w+\(([^)]+)\):/.exec(subject);
    const scope = m?.[1] ?? "(bez scope)";
    if (NON_CHANGE_SCOPES.has(scope)) continue;
    const entry = `${hash} ${subject}`;
    const list = grouped.get(scope) ?? [];
    list.push(entry);
    grouped.set(scope, list);
  }
  return grouped;
}

/** Mapa change-id → status roadmapy z tabeli „At a glance". */
function readRoadmapStatuses(): Map<string, string> {
  const map = new Map<string, string>();
  let raw = "";
  try {
    raw = readFileSync("context/foundation/roadmap.md", "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split(/\r?\n/)) {
    // Wiersze tabeli: | F-01 | data-schema-and-rls | … | done |
    if (!/^\|\s*[FS]-\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] = "" (przed pierwszym |); [1]=ID, [2]=Change ID, ostatni=Status
    const changeId = cells[2];
    const status = cells[cells.length - 2];
    if (changeId) map.set(changeId, status);
  }
  return map;
}

/** Change-id obecne w mirror-doc (tabela Issues, change-id w backtickach). */
function readMirrorChangeIds(): { ids: Set<string>; rows: number } {
  const ids = new Set<string>();
  let raw = "";
  try {
    raw = readFileSync("context/foundation/tasks-github.md", "utf8");
  } catch {
    return { ids, rows: 0 };
  }
  let rows = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!/^\|\s*\[#\d+\]/.test(line)) continue; // wiersz issue: | [#1](…) | …
    rows++;
    const m = /`([a-z0-9-]+)`/.exec(line);
    if (m) ids.add(m[1]);
  }
  return { ids, rows };
}

function changeLink(id: string): string {
  return `[${id}](../../changes/${id}/)`;
}

/** Status ostatniego runu GitHub Actions przez `gh` (sync). Błąd/brak `gh` → „niedostępne". */
function githubCiLines(): string[] {
  try {
    const out = execFileSync(
      "gh",
      ["run", "list", "--limit", "1", "--json", "status,conclusion,headBranch,createdAt"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const runs = JSON.parse(out) as {
      status: string;
      conclusion: string | null;
      headBranch: string;
      createdAt: string;
    }[];
    if (runs.length === 0) return ["- **GitHub Actions**: brak runów."];
    const r = runs[0];
    const outcome = r.conclusion ?? r.status;
    return [`- **GitHub Actions**: ostatni run \`${outcome}\` na \`${r.headBranch}\` (${r.createdAt.slice(0, 10)}).`];
  } catch {
    return ["- **GitHub Actions**: niedostępne."];
  }
}

/** Nowe issues z Sentry (okno 24h) przez REST. Brak tokena/błąd → „niedostępne". */
async function sentryLines(): Promise<string[]> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) return ["- **Sentry**: niedostępne (brak SENTRY_AUTH_TOKEN)."];
  try {
    const url =
      `https://${SENTRY_HOST}/api/0/organizations/${SENTRY_ORG_ID}/issues/` +
      `?project=${SENTRY_PROJECT_ID}&statsPeriod=24h&query=is:unresolved&limit=5`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [`- **Sentry**: niedostępne (HTTP ${res.status}).`];
    const payload: unknown = await res.json();
    if (!Array.isArray(payload)) return ["- **Sentry**: niedostępne (nieoczekiwany format)."];
    const issues = payload as { title: string; permalink?: string }[];
    if (issues.length === 0) return ["- **Sentry**: brak nowych issues w ostatnich 24h."];
    const out = [`- **Sentry**: ${issues.length} nowych issue(s) w ostatnich 24h:`];
    for (const i of issues) {
      out.push(`  - ${i.permalink ? `[${i.title}](${i.permalink})` : i.title}`);
    }
    return out;
  } catch (err) {
    return [`- **Sentry**: niedostępne (${err instanceof Error ? err.message : String(err)}).`];
  }
}

function buildDigest(now: Date, ciLines: string[]): string {
  const { changes, errors } = readChanges(now);
  const changed = commitsSinceYesterday();
  const roadmap = readRoadmapStatuses();
  const mirror = readMirrorChangeIds();
  const today = localDateStr(now);

  const lines: string[] = [];
  lines.push(`# Poranny digest statusu — ${today}`);
  lines.push("");
  lines.push(
    "> Read-only. Streszcza i **linkuje** do źródeł (`context/changes/`, `roadmap.md`, `git log`, CI, Sentry). Nie jest źródłem prawdy. Wygenerowane przez `npm run digest`.",
  );
  lines.push("");

  // 1. Co się zmieniło (od wczoraj)
  lines.push("## Co się zmieniło (od wczoraj)");
  lines.push("");
  if (changed.size === 0) {
    lines.push("Brak commitów w oknie ostatnich 24h.");
  } else {
    for (const [scope, entries] of changed) {
      const heading = roadmap.has(scope) || changes.some((c) => c.id === scope) ? changeLink(scope) : `**${scope}**`;
      lines.push(`- ${heading}`);
      for (const e of entries) lines.push(`  - \`${e}\``);
    }
  }
  lines.push("");

  // 2. W toku (wg dni bez ruchu)
  lines.push("## W toku (wg dni bez ruchu)");
  lines.push("");
  lines.push(
    "Sortowanie malejąco po dniach od ostatniego commita dotykającego folder zmiany (źródło: `git log -- context/changes/<id>/`). Bez progu/etykiety „utknęło”.",
  );
  lines.push("");
  const inProgress = changes
    .filter((c) => (IN_PROGRESS as readonly string[]).includes(c.status))
    .sort((a, b) => b.daysIdle - a.daysIdle);
  if (inProgress.length === 0) {
    lines.push("Brak zmian w toku.");
  } else {
    lines.push("| Dni bez ruchu | Zmiana | Status | Ostatni ruch (git) |");
    lines.push("| --- | --- | --- | --- |");
    for (const c of inProgress) {
      const days = c.lastTouch ? String(c.daysIdle) : "brak historii git";
      const touch = c.lastTouch ? c.lastTouch.slice(0, 10) : "— (folder niezacommitowany)";
      lines.push(`| ${days} | ${changeLink(c.id)} | ${c.status} | ${touch} |`);
    }
  }
  lines.push("");

  // 3. Rozjazdy
  lines.push("## Rozjazdy");
  lines.push("");
  lines.push("**a) git ↔ frontmatter (deklarowany status vs realny ruch)**");
  lines.push("");
  const noHistory = changes.filter((c) => c.lastTouch === null);
  if (noHistory.length === 0) {
    lines.push("- Brak — każda zmiana ma pokrycie w historii git.");
  } else {
    for (const c of noHistory) {
      lines.push(
        `- ${changeLink(c.id)} — deklaruje \`${c.status}\`, ale folder nie ma żadnego commita (\`git log -- context/changes/${c.id}/\` pusty). Praca istnieje lokalnie, lecz nie wylądowała w historii.`,
      );
    }
  }
  lines.push("");
  lines.push("**b) mirror-docs drift**");
  lines.push("");
  lines.push(
    `- ${changes.length} sparsowanych zmian w \`context/changes/\` vs ${mirror.rows} wierszy w \`tasks-github.md\` (mirror zamrożony). Mirror nie odzwierciedla bieżącego backlogu. → [tasks-github.md](../../foundation/tasks-github.md)`,
  );
  lines.push("");
  lines.push("**c) change-id obecne lokalnie, brak w mirror**");
  lines.push("");
  const missing = changes.map((c) => c.id).filter((id) => !mirror.ids.has(id));
  if (missing.length === 0) {
    lines.push("- Brak — wszystkie lokalne zmiany mają wiersz w mirror.");
  } else {
    lines.push(`- ${missing.map((id) => `\`${id}\``).join(", ")}`);
  }
  lines.push("");

  // 4. Decyzje na dziś (deterministyczne, z reguł)
  lines.push("## Decyzje na dziś");
  lines.push("");
  const decisions: string[] = [];
  const oldest = inProgress.find((c) => c.lastTouch !== null);
  if (oldest) {
    decisions.push(
      `**${changeLink(oldest.id)} stoi ${oldest.daysIdle} dni bez commita** (status \`${oldest.status}\`) — dokończyć czy zaparkować? → [folder](../../changes/${oldest.id}/)`,
    );
  }
  if (noHistory.length > 0) {
    const ids = noHistory.map((c) => `\`${c.id}\``).join(", ");
    decisions.push(
      `**${noHistory.length} zmiana(-y) bez żadnego commita w folderze** (${ids}) — zacommitować dotychczasową pracę, żeby ruch był widoczny w git? → [context/changes/](../../changes/)`,
    );
  }
  if (mirror.rows < changes.length) {
    decisions.push(
      `**Mirror-docs (${mirror.rows} wierszy) odstaje od ${changes.length} aktywnych zmian** — odświeżyć mirror czy świadomie z niego zrezygnować? → [tasks-github.md](../../foundation/tasks-github.md)`,
    );
  }
  if (decisions.length === 0) {
    lines.push("Brak sygnałów wymagających decyzji.");
  } else {
    for (const d of decisions.slice(0, 3)) lines.push(`1. ${d}`);
  }
  lines.push("");

  // 5. CI / Błędy (sygnały zewnętrzne, graceful degradation)
  lines.push("## CI / Błędy");
  lines.push("");
  for (const l of ciLines) lines.push(l);
  lines.push("");

  // 6. ⚠️ Nie udało się sparsować
  lines.push("## ⚠️ Nie udało się sparsować");
  lines.push("");
  if (errors.length === 0) {
    lines.push(`Brak — wszystkie ${changes.length} plików \`change.md\` sparsowane poprawnie.`);
  } else {
    for (const e of errors) lines.push(`- \`${e.file}\` — ${e.reason}`);
  }
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  // Sygnały zewnętrzne potrzebują SENTRY_AUTH_TOKEN z .env; ładujemy je tu, ignorując
  // brak pliku — bez tokena sekcja Sentry zdegraduje się łaskawie.
  try {
    process.loadEnvFile();
  } catch {
    /* brak .env — OK, sygnały zewnętrzne zdegradują się łaskawie */
  }

  const now = new Date();
  const ciLines = [...githubCiLines(), ...(await sentryLines())];
  const content = buildDigest(now, ciLines);

  mkdirSync("context/team/digests", { recursive: true });
  const outPath = `context/team/digests/${localDateStr(now)}.md`;
  writeFileSync(outPath, content, "utf8");
  // eslint-disable-next-line no-console
  console.log(`✔ Digest zapisany: ${outPath}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("✖ digest failed:", err);
  process.exit(1);
});
