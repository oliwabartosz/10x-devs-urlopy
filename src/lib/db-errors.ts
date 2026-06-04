export function extractPgErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code ?? undefined;
}
