import type { AnalyzerContext } from "../analyzer/index.js";
import { relPosix } from "../utils/fs.js";

const QUOTED_RE = /["'`]([^"'`\\\n]{2,160})["'`]/g;

/** Token strings likely to appear in code that bare file basenames could
 * collide with; we keep the threshold conservative. */
const WEAK_TOKENS = new Set(["index", "main", "app", "server", "client", "utils", "types", "config", "styles", "common", "lib", "api", "components", "test", "data", "helpers"]);

/**
 * Searches the repository's non-source text (configs, scripts, docs, html,
 * css) plus string literals in source files for references to a given file.
 * This catches the "referenced through strings" class of usage (webpack
 * entry strings, tailwind content globs, file reads, etc.).
 */
export async function findStringReferences(
  ctx: AnalyzerContext,
  targetAbs: string,
): Promise<{ count: number; sources: string[] }> {
  const targetRel = relPosix(targetAbs, ctx.root);
  const basename = targetRel.split("/").at(-1) ?? targetRel;
  const baseNoExt = basename.replace(/\.[a-z0-9]+$/i, "");
  const relNoExt = targetRel.replace(/\.[a-z0-9]+$/i, "");
  const dir = targetRel.split("/").slice(0, -1).join("/");

  const tokens = new Set<string>([basename, baseNoExt, relNoExt, relNoExt.replace(/^\//, "")]);
  // Only the basename for weak tokens to limit noise
  const hits = new Map<string, number>();
  const sources = new Set<string>();

  const testToken = (value: string): boolean => {
    if (value === basename || value === relNoExt) return true;
    if (value === baseNoExt && !WEAK_TOKENS.has(baseNoExt)) return true;
    return false;
  };

  for (const file of ctx.files) {
    if (file.abs === targetAbs) continue;
    if (file.kind === "env") continue;
    if (file.ext === ".json" && (file.rel.endsWith("package.json") || file.rel.endsWith("tsconfig.json"))) {
      continue;
    }
    const text = ctx.texts.get(file.abs) ?? "";
    if (text.length > 2 * 1024 * 1024) continue;
    let m: RegExpExecArray | null;
    QUOTED_RE.lastIndex = 0;
    while ((m = QUOTED_RE.exec(text)) !== null) {
      let value = m[1]!;
      value = value.split("?")[0]!;
      if (tokens.has(value) || testToken(value)) {
        hits.set(file.rel, (hits.get(file.rel) ?? 0) + 1);
        sources.add(file.rel);
        break;
      }
    }
    // directory-level references: "@/components" imports the dir
    if (dir && dir !== ".") {
      const dirToken = `/${dir}`;
      if (text.includes(`"${dirToken}`) || text.includes(`'${dirToken}`) || text.includes(`\`${dirToken}`)) {
        sources.add(file.rel);
      }
    }
  }

  let count = 0;
  for (const n of hits.values()) count += n;
  void tokens;
  return { count: count + sources.size, sources: [...sources].slice(0, 20) };
}