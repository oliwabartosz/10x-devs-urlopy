import { pathToFileURL } from "node:url";
import { reviewCode, DEFAULT_MODEL } from "./agent.js";

/**
 * Manual `npm start` sanity check for the code reviewer.
 *
 * Runs a single review against a buggy sample snippet and prints the summary
 * plus findings. Guarded so importing this module never runs the demo — it only
 * executes when the file is the process entry point.
 */

/** Small demonstration run, executed only when this file is the entry point. */
async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "Missing OPENROUTER_API_KEY. Copy .env.example to .env and add your key,\n" +
        "then run with: OPENROUTER_API_KEY=... npm start   (or use a dotenv loader).",
    );
    process.exitCode = 1;
    return;
  }

  const sample = [
    "function sum(items) {",
    "  let total;",
    "  for (let i = 0; i <= items.length; i++) {",
    "    total += items[i];",
    "  }",
    "  return total;",
    "}",
  ].join("\n");

  console.log(`Reviewing sample snippet with ${process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL}...\n`);
  const result = await reviewCode(sample, { language: "JavaScript" });

  console.log(result.summary, "\n");
  for (const f of result.findings) {
    const where = f.line === null ? "" : ` (line ${f.line})`;
    console.log(`[${f.severity}]${where} ${f.issue}\n  -> ${f.suggestion}\n`);
  }
}

// Run the demo only when executed directly (e.g. `npm start`), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
