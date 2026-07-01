/**
 * Prompts for the code reviewer.
 *
 * Centralized and separate from model wiring so prompts stay versionable and
 * eval-friendly. The system prompt is a static constant; the user prompt is
 * built per call from the code under review. The optional language hint is
 * applied to the instructions (see `appendLanguageHint`) rather than the user
 * prompt, so the agent can inject it via `prepareCall`.
 */

/** System prompt: the reviewer's persona and mandate. */
export const SYSTEM_INSTRUCTIONS =
  "You are a senior software engineer performing a focused code review. " +
  "Identify correctness bugs, security issues, and clear simplifications. " +
  "Be specific and actionable; do not invent problems.";

/** Build the user prompt that presents the code to review. */
export function buildReviewPrompt(code: string): string {
  return `Review the following code and report your findings.\n\n\`\`\`\n${code}\n\`\`\``;
}

/**
 * Append an optional language/framework hint to the instructions.
 *
 * Returns `instructions` unchanged when no language is given.
 */
export function appendLanguageHint(instructions: string, language?: string): string {
  if (!language) return instructions;
  return `${instructions} The code is written in ${language}.`;
}
