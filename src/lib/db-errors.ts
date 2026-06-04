export function extractPgErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e.code ?? e.cause?.code;
  return typeof code === "string" ? code : undefined;
}
