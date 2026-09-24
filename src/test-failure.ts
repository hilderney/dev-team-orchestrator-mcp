/**
 * Classify test failure output (P0-3): bootstrap vs contract vs logic.
 */

export type TestFailureClass = "bootstrap" | "contract" | "logic";

const BOOTSTRAP_PATTERNS: RegExp[] = [
  /ERR_MODULE_NOT_FOUND/i,
  /Cannot find (module|package)/i,
  /não é reconhecido/i,
  /is not recognized/i,
  /not recognized as an internal or external command/i,
  /ETARGET/i,
  /ENOENT/i,
  /Missing script:\s*["']?test/i,
  /vitest.*(?:not found|não|not recognized)/i,
  /npm ERR!|npm error/i,
  /node_modules/i,
  /Cannot find package ['"]vitest['"]/i,
  /ERR_INVALID_TYPESCRIPT_SYNTAX/i,
];

const CONTRACT_PATTERNS: RegExp[] = [
  /no_file_sections/i,
  /empty_file_body/i,
  /===FILE:/i,
  /parse_failed/i,
];

export function classifyTestFailure(log: string): TestFailureClass {
  const text = log || "";
  for (const re of BOOTSTRAP_PATTERNS) {
    if (re.test(text)) return "bootstrap";
  }
  for (const re of CONTRACT_PATTERNS) {
    if (re.test(text)) return "contract";
  }
  return "logic";
}

/** Expandable list for docs / metrics. */
export function bootstrapPatternSources(): string[] {
  return BOOTSTRAP_PATTERNS.map((r) => r.source);
}
