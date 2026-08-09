import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createResolverContext,
  resolveImport,
  aliasesFromTsconfig,
  aliasesFromBundlerConfig,
} from "../../src/analyzer/resolver.js";

function tmpFixture(content: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nullcode-resolver-"));
  for (const [rel, text] of Object.entries(content)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return dir;
}

describe("resolveImport", () => {
  it("resolves relative specifiers with extensions and index files", () => {
    const dir = tmpFixture({
      "src/a.ts": "",
      "src/b.tsx": "",
      "src/sub/index.ts": "",
      "src/importer.ts": "",
    });
    const ctx = createResolverContext(dir, [], new Map());
    expect(resolveImport("./a", path.join(dir, "src/importer.ts"), ctx)).toEqual({
      kind: "file",
      filePath: path.join(dir, "src", "a.ts"),
      specifier: "./a",
    });
    expect(resolveImport("./b", path.join(dir, "src/importer.ts"), ctx)).toEqual({
      kind: "file",
      filePath: path.join(dir, "src", "b.tsx"),
      specifier: "./b",
    });
    expect(resolveImport("./sub", path.join(dir, "src/importer.ts"), ctx)).toEqual({
      kind: "file",
      filePath: path.join(dir, "src", "sub", "index.ts"),
      specifier: "./sub",
    });
  });

  it("classifies bare specifiers as packages (scoped included)", () => {
    const dir = tmpFixture({ "a.ts": "" });
    const ctx = createResolverContext(dir, [], new Map());
    expect(resolveImport("lodash", path.join(dir, "a.ts"), ctx)).toEqual({
      kind: "package",
      packageName: "lodash",
      specifier: "lodash",
    });
    expect(resolveImport("@scope/pkg/sub", path.join(dir, "a.ts"), ctx)).toEqual({
      kind: "package",
      packageName: "@scope/pkg",
      specifier: "@scope/pkg/sub",
    });
  });

  it("classifies node: builtins", () => {
    const dir = tmpFixture({ "a.ts": "" });
    const ctx = createResolverContext(dir, [], new Map());
    expect(resolveImport("node:fs", path.join(dir, "a.ts"), ctx).kind).toBe("builtin");
  });

  it("resolves tsconfig path aliases", () => {
    const dir = tmpFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
      "src/api.ts": "",
      "src/worker.ts": `import { api } from "@/api";`,
    });
    const ctx = createResolverContext(dir, aliasesFromTsconfig(path.join(dir, "tsconfig.json"), dir), new Map());
    const res = resolveImport("@/api", path.join(dir, "src/worker.ts"), ctx);
    expect(res.kind).toBe("file");
    expect(res.filePath).toBe(path.join(dir, "src", "api.ts"));
  });

  it("resolves vite-style aliases from config files", () => {
    const dir = tmpFixture({
      "vite.config.ts": `import path from "path";
export default { resolve: { alias: { "@": path.resolve(__dirname, "src") } } };`,
      "src/api.ts": "",
      "src/main.ts": `import { api } from "@/api";`,
    });
    const aliases = aliasesFromBundlerConfig(path.join(dir, "vite.config.ts"), dir);
    expect(aliases).toHaveLength(1);
    const ctx = createResolverContext(dir, aliases, new Map());
    const res = resolveImport("@/api", path.join(dir, "src/main.ts"), ctx);
    expect(res.kind).toBe("file");
    expect(res.filePath).toBe(path.join(dir, "src", "api.ts"));
  });

  it("strips ?query suffixes from specifiers", () => {
    const dir = tmpFixture({ "styles.css": "", "a.ts": "" });
    const ctx = createResolverContext(dir, [], new Map());
    // css isn't resolvable via TS extensions; expects unresolved but query stripped
    const res = resolveImport("./styles.css?raw", path.join(dir, "a.ts"), ctx);
    expect(res.specifier).toBe("./styles.css?raw");
    expect(res.kind).not.toBe("package");
  });
});