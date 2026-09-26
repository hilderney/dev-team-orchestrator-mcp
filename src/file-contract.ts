/**
 * FILE contract repair + write_file tool schema helpers (P1-1 / Fase D).
 */
import { z } from "zod";

export const writeFileToolSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Path relative to project root (no .., not absolute)"),
  content: z.string().describe("Full file contents"),
});

export type WriteFileToolArgs = z.infer<typeof writeFileToolSchema>;

const WRITE_FILE_TOOL = {
  type: "function" as const,
  function: {
    name: "write_file",
    description:
      "Write a single file under the project root. Call once per file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from project root",
        },
        content: {
          type: "string",
          description: "Full file contents",
        },
      },
      required: ["path", "content"],
    },
  },
};

export function writeFileToolDefinition() {
  return WRITE_FILE_TOOL;
}

/**
 * Cheap format repair: unwrap outer fences, normalize FILE markers, strip prose
 * before first FILE without regenerating content via LLM.
 */
export function repairFileContract(raw: string): string {
  let text = (raw || "").trim();
  if (!text) return text;

  // Outer fence around whole reply
  const whole = text.match(/^```(?:[\w.+-]*)\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (whole) text = whole[1].trim();

  // Markdown heading mistaken for FILE
  text = text.replace(
    /^#{1,3}\s*FILE:\s*([^\n]+)$/gim,
    "===FILE: $1==="
  );
  text = text.replace(
    /^FILE:\s*([^\s].*?)$/gim,
    "===FILE: $1==="
  );
  // Missing closing ===
  text = text.replace(
    /^===FILE:\s*([^\r\n=]+?)(?:===)?\s*$/gim,
    (_m, p1: string) => `===FILE: ${String(p1).trim()}===`
  );

  // Drop leading essay before first FILE
  const first = text.search(/===FILE:\s*/i);
  if (first > 0) {
    text = text.slice(first);
  }

  return text.trim();
}

/** Paths that must stay .ts even if content has angle brackets (generics, etc.). */
export function shouldSkipTsxCoercion(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  const base = p.split("/").pop() || "";
  if (/\.d\.ts$/i.test(p)) return true;
  if (/^types\.ts$/i.test(base)) return true;
  if (/Store\.ts$/i.test(base)) return true;
  return false;
}

/**
 * Detect real JSX that requires .tsx/.jsx — not TypeScript generics like Array<string>.
 * Prefer return/arrow JSX expressions or PascalCase component pairs.
 */
export function bodyLooksLikeJsx(content: string): boolean {
  if (/React\.createElement\s*\(/.test(content)) return true;
  // return ( <Tag  or  => ( <Tag  or  => <Tag
  if (
    /(return\s*\(|=>\s*\(|=>\s*)[\s\S]{0,240}<[A-Za-z][A-Za-z0-9.]*(\s|>|\/>)/.test(
      content
    )
  ) {
    return true;
  }
  // Matched PascalCase open/close tags (components, not HTML)
  if (
    /<[A-Z][A-Za-z0-9.]*(\s|>|\/>)/.test(content) &&
    /<\/[A-Z][A-Za-z0-9.]*>/.test(content)
  ) {
    return true;
  }
  return false;
}

/** Prose / agent notes that must not land in source/test files (P0-5). */
export function stripAgentNotesFromCode(content: string): string {
  const lines = content.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    if (/^[→\-]\s*(omitido|omitted|skipped)/i.test(t)) return false;
    if (/^->\s*(omitido|omitted|skipped)/i.test(t)) return false;
    if (/\bPONYTAIL\b/i.test(t)) return false;
    if (/^NOTE\s*\(agent\)/i.test(t)) return false;
    if (/^\/\*\s*zteam:/i.test(t)) return false;
    return true;
  });
  return lines.join("\n");
}

export function isCodeOrTestPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/").toLowerCase();
  if (p.includes("/fixtures/") || p.startsWith("fixtures/")) return false;
  if (/\.(json|md|txt|css|html|svg)$/i.test(p)) return false;
  return /\.(tsx?|jsx?|mjs|cjs)$/i.test(p);
}

/**
 * Validate path extension vs content; return corrected path or throw.
 */
export function coercePathForContent(
  relPath: string,
  content: string
): string {
  if (!isCodeOrTestPath(relPath)) return relPath;
  if (shouldSkipTsxCoercion(relPath)) return relPath;
  if (bodyLooksLikeJsx(content) && /\.ts$/i.test(relPath) && !/\.tsx$/i.test(relPath)) {
    return relPath.replace(/\.ts$/i, ".tsx");
  }
  if (bodyLooksLikeJsx(content) && /\.js$/i.test(relPath) && !/\.jsx$/i.test(relPath)) {
    return relPath.replace(/\.js$/i, ".jsx");
  }
  return relPath;
}

/** Convert tool call args into ===FILE=== text for existing writeParsedFiles. */
export function toolCallsToFileSections(
  calls: Array<{ path: string; content: string }>
): string {
  return calls
    .map((c) => `===FILE: ${c.path}===\n${c.content}`)
    .join("\n\n");
}

/**
 * Extract write_file tool calls from LangChain AIMessage-like content.
 */
export function extractWriteFileToolCalls(message: unknown): {
  files: Array<{ path: string; content: string }>;
  malformed: number;
} {
  const files: Array<{ path: string; content: string }> = [];
  let malformed = 0;
  if (!message || typeof message !== "object") {
    return { files, malformed };
  }
  const toolCalls =
    (message as { tool_calls?: unknown[] }).tool_calls ||
    (message as { additional_kwargs?: { tool_calls?: unknown[] } })
      .additional_kwargs?.tool_calls ||
    [];
  if (!Array.isArray(toolCalls)) return { files, malformed };

  for (const tc of toolCalls) {
    if (!tc || typeof tc !== "object") {
      malformed += 1;
      continue;
    }
    const name =
      (tc as { name?: string }).name ||
      (tc as { function?: { name?: string } }).function?.name;
    if (name !== "write_file") continue;
    let args: unknown =
      (tc as { args?: unknown }).args ??
      (tc as { function?: { arguments?: unknown } }).function?.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        malformed += 1;
        continue;
      }
    }
    const parsed = writeFileToolSchema.safeParse(args);
    if (!parsed.success) {
      malformed += 1;
      continue;
    }
    files.push(parsed.data);
  }
  return { files, malformed };
}
