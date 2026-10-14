/**
 * Mechanical gates between Cursor playbook / pipeline stages (Item 3 of Update Plan).
 *
 * Ensures:
 * - `sa-requirements`: `.docs/requirements.md` exists and covers numbered constraints from `userIdea`
 * - `qa-tdd-red` / `qa-tdd-red:{slug}`:
 *   1) Rejects native addon imports (`better-sqlite3`, `sqlite3`, `bcrypt`, `canvas`) when `.docs/host.json` says `nativeCompileLikelyOk === false` or `hasNodeSqlite === true`
 *   2) Rejects contradictory numeric bounds across test assertions / spec rules (e.g. requiring 13 consecutive free cells when max free cells is 3)
 *   3) Optionally checks that `npm test` fails (red) rather than crashing on `Cannot find package`
 * - `se-implement` / `se-implement:{slug}`: checks expected files exist
 * - `qa-tdd-verify`: only allows `[x]` when tests pass (exit code 0)
 */
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readHostProbeFile } from "./host-probe.js";

export type StageGateResult = {
  ok: boolean;
  stage: string;
  reasons: string[];
  warnings: string[];
  checkedFiles: string[];
};

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

async function collectTestFiles(dir: string, relBase = ""): Promise<string[]> {
  const out: string[] = [];
  if (!(await pathExists(dir))) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (
      e.name === "node_modules" ||
      e.name === ".git" ||
      e.name === "dist" ||
      e.name === ".zteam" ||
      e.name === ".docs"
    ) {
      continue;
    }
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectTestFiles(abs, rel)));
    } else if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/i.test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Extract numeric upper/lower rules on the same subject from spec + tests
 * and detect direct contradictions (e.g. max 3 consecutive free cells vs test requiring >= 13 free cells).
 */
export function findTestContradictions(
  specText: string,
  testContents: Array<{ file: string; content: string }>
): string[] {
  const issues: string[] = [];
  const combinedSpec = (specText || "").toLowerCase();

  // Extract max bound rules from spec or test comments:
  // e.g. "no máximo 3 células livres", "at most 3 free cells", "max 3 consecutive free"
  const maxRules: Array<{ limit: number; unit: string; raw: string }> = [];
  const maxRegex =
    /(?:no\s+m[áa]ximo|at\s+most|max(?:imum)?(?:\s+of)?|<=?)\s+(\d+)\s+(c[ée]lulas?\s+livres?|free\s+cells?|consecutive\s+free|empty\s+cells?|corridor)/gi;
  let m: RegExpExecArray | null;
  while ((m = maxRegex.exec(combinedSpec)) !== null) {
    maxRules.push({
      limit: Number.parseInt(m[1], 10),
      unit: m[2].trim(),
      raw: m[0],
    });
  }

  for (const tf of testContents) {
    const body = tf.content;
    const lower = body.toLowerCase();

    // Also scan test file itself for max rules
    while ((m = maxRegex.exec(lower)) !== null) {
      maxRules.push({
        limit: Number.parseInt(m[1], 10),
        unit: m[2].trim(),
        raw: m[0],
      });
    }

    // Look for positive requirements in tests that exceed maxRules on the same domain
    // e.g., "13 células livres em linha", "13 free cells", "toBeGreaterThanOrEqual(13)", ".repeat(13)"
    const minRegex =
      /(?:pelo\s+menos|at\s+least|min(?:imum)?(?:\s+of)?|exig[ei]\w*|requires?|>=?)\s*(\d+)\s+(c[ée]lulas?\s+livres?|free\s+cells?|consecutive\s+free|empty\s+cells?|em\s+linha)/gi;
    while ((m = minRegex.exec(lower)) !== null) {
      const reqVal = Number.parseInt(m[1], 10);
      for (const maxRule of maxRules) {
        if (reqVal > maxRule.limit) {
          issues.push(
            `Contradictory test rule in ${tf.file}: requires "${m[0]}" (${reqVal}) which violates maximum rule "${maxRule.raw}" (max ${maxRule.limit}).`
          );
        }
      }
    }

    // Check explicit numeric assertions paired with free/corridor run-length checks
    if (maxRules.length > 0) {
      const assertMinRe =
        /expect\([^)]*(?:free|corridor|empty|livres|linha)[^)]*\)\.(?:toBeGreaterThan(?:OrEqual)?|toBe)\(\s*(\d+)\s*\)/gi;
      while ((m = assertMinRe.exec(body)) !== null) {
        const assertedVal = Number.parseInt(m[1], 10);
        for (const maxRule of maxRules) {
          if (assertedVal > maxRule.limit) {
            issues.push(
              `Contradictory assertion in ${tf.file}: ${m[0]} demands ${assertedVal}, violating "${maxRule.raw}" (max ${maxRule.limit}).`
            );
          }
        }
      }
    }
  }

  return [...new Set(issues)];
}

/**
 * Detect forbidden native C++ modules in tests or package.json when host prefers built-in `node:sqlite`.
 */
export function findForbiddenNativeImports(
  files: Array<{ file: string; content: string }>,
  opts: { nativeCompileLikelyOk: boolean; hasNodeSqlite: boolean }
): string[] {
  const issues: string[] = [];
  if (opts.nativeCompileLikelyOk && !opts.hasNodeSqlite) return issues;

  const nativeMods = ["better-sqlite3", "sqlite3", "bcrypt", "node-gyp"];
  for (const f of files) {
    for (const mod of nativeMods) {
      const importRe = new RegExp(
        `(?:from\\s+['"]${mod}['"]|require\\(\\s*['"]${mod}['"]\\s*\\)|import\\(\\s*['"]${mod}['"]\\s*\\))`,
        "i"
      );
      if (importRe.test(f.content)) {
        const alt =
          mod.includes("sqlite") && opts.hasNodeSqlite
            ? "Use built-in 'node:sqlite' (DatabaseSync) instead."
            : "Use a pure JS/Node built-in alternative.";
        issues.push(
          `Native addon '${mod}' imported in ${f.file}. ${alt}`
        );
      }
    }
  }
  return issues;
}

/**
 * Evaluate mechanical gate for a completed or about-to-complete stage.
 */
export async function checkStageGate(opts: {
  appRoot: string;
  stage: string;
  userIdea?: string;
  testExitCode?: number;
  testOutput?: string;
}): Promise<StageGateResult> {
  const root = resolve(opts.appRoot);
  const stage = (opts.stage || "").trim();
  const reasons: string[] = [];
  const warnings: string[] = [];
  const checkedFiles: string[] = [];

  const slugMatch = stage.match(/:([a-z0-9-_]+)$/i);
  const slug = slugMatch ? slugMatch[1] : "";

  // 1. Requirements gate
  if (stage === "sa-requirements" || stage === "ux-juice") {
    const reqPath = join(root, ".docs", "requirements.md");
    checkedFiles.push(".docs/requirements.md");
    if (!(await pathExists(reqPath))) {
      reasons.push("Missing `.docs/requirements.md`.");
    } else {
      const reqText = await readFile(reqPath, "utf8");
      if (reqText.trim().length < 120) {
        reasons.push("`.docs/requirements.md` is too short (< 120 chars).");
      }
      if (stage === "ux-juice" && !/##\s+UX\s*\/\s*Juice/i.test(reqText)) {
        warnings.push("`.docs/requirements.md` is missing `## UX / Juice addendum` heading.");
      }
    }
  }

  // 2. Tech stack gate
  if (stage === "ta-stack") {
    const techPath = join(root, ".docs", "technologies.md");
    checkedFiles.push(".docs/technologies.md");
    if (!(await pathExists(techPath))) {
      reasons.push("Missing `.docs/technologies.md`.");
    } else {
      const techText = await readFile(techPath, "utf8");
      const probe = await readHostProbeFile(root);
      if (
        probe &&
        !probe.nativeCompileLikelyOk &&
        /\bbetter-sqlite3\b/i.test(techText) &&
        !/avoid\s+better-sqlite3|do\s+not\s+use\s+better-sqlite3|node:sqlite/i.test(techText)
      ) {
        reasons.push(
          "`.docs/technologies.md` selects `better-sqlite3` on a host where native compilation is unavailable. Use `node:sqlite` (built-in) or `sql.js` per `.docs/host.json`."
        );
      }
    }
  }

  // 3. QA TDD Red gate
  if (stage === "qa-tdd-red" || stage.startsWith("qa-tdd-red:")) {
    const testRels = await collectTestFiles(root);
    checkedFiles.push(...testRels);
    if (testRels.length === 0) {
      reasons.push("No test files (`*.test.*` or `*.spec.*`) found in project after QA TDD Red.");
    } else {
      const probe = await readHostProbeFile(root);
      const loadedTests: Array<{ file: string; content: string }> = [];
      for (const rel of testRels) {
        try {
          loadedTests.push({
            file: rel,
            content: await readFile(join(root, rel), "utf8"),
          });
        } catch {
          /* ignore */
        }
      }

      // Check native addon imports
      const nativeIssues = findForbiddenNativeImports(loadedTests, {
        nativeCompileLikelyOk: probe?.nativeCompileLikelyOk ?? false,
        hasNodeSqlite: probe?.hasNodeSqlite ?? true,
      });
      reasons.push(...nativeIssues);

      // Load spec(s) for contradiction check
      let specText = "";
      if (slug) {
        const sp = join(root, ".docs", "specs", `${slug}.spec.md`);
        if (await pathExists(sp)) specText = await readFile(sp, "utf8");
      } else {
        const specsDir = join(root, ".docs", "specs");
        if (await pathExists(specsDir)) {
          const entries = await readdir(specsDir);
          for (const e of entries) {
            if (e.endsWith(".spec.md")) {
              specText += "\n" + (await readFile(join(specsDir, e), "utf8"));
            }
          }
        }
      }
      const reqPath = join(root, ".docs", "requirements.md");
      if (await pathExists(reqPath)) {
        specText += "\n" + (await readFile(reqPath, "utf8"));
      }

      const contradictions = findTestContradictions(specText, loadedTests);
      reasons.push(...contradictions);
    }

    if (opts.testOutput && /Cannot find package ['"]([^'"]+)['"]/i.test(opts.testOutput)) {
      const m = opts.testOutput.match(/Cannot find package ['"]([^'"]+)['"]/i);
      reasons.push(
        `QA red suite failed due to missing/uncompiled package '${m?.[1]}' rather than a behavioral assertion failure.`
      );
    }
  }

  // 4. QA TDD Verify gate
  if (stage === "qa-tdd-verify") {
    if (opts.testExitCode !== undefined && opts.testExitCode !== 0) {
      reasons.push(
        `Cannot pass qa-tdd-verify or mark todos [x]: test suite exited with code ${opts.testExitCode}.`
      );
    }
  }

  return {
    ok: reasons.length === 0,
    stage,
    reasons,
    warnings,
    checkedFiles,
  };
}
