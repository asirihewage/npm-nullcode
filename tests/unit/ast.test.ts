import { describe, expect, it } from "vitest";
import { analyzeAst, analyzeRegexFallback } from "../../src/analyzer/ast/index.js";

describe("analyzeAst", () => {
  it("extracts static imports with requested names", () => {
    const s = analyzeAst(
      "x.ts",
      `import axios from "axios";
import { add, sub as s } from "./lib/math";
import * as utils from "./utils";
import { type User } from "./types";
export const v = 1;
`,
    );
    const imps = s.imports;
    expect(imps).toHaveLength(4);
    expect(imps[0]).toMatchObject({ specifier: "axios", kind: "import", requested: ["default"] });
    expect(imps[1]!.requested).toEqual(["add", "s"]);
    expect(imps[2]!.requested).toEqual(["*"]);
    expect(imps[3]!.requested).toEqual(["User"]);
    expect(imps[3]!.typeOnly).toBe(true);
    expect(s.exports.map((e) => e.name)).toEqual(["v"]);
  });

  it("detects require() and dynamic import()", () => {
    const s = analyzeAst(
      "a.js",
      `const x = require("lodash");
const y = import("./lazy.js");
`,
    );
    expect(s.imports[0]).toMatchObject({ specifier: "lodash", kind: "require" });
    expect(s.imports[1]).toMatchObject({ specifier: "./lazy.js", kind: "dynamic" });
  });

  it("detects process.env and import.meta.env references", () => {
    const s = analyzeAst(
      "b.ts",
      `const a = process.env.API_URL;
const b = process.env["DEBUG_MODE"];
const c = import.meta.env.VITE_FOO;
`,
    );
    expect(s.env.map((e) => e.key)).toEqual(["API_URL", "DEBUG_MODE", "VITE_FOO"]);
  });

  it("detects JSX component usage", () => {
    const s = analyzeAst(
      "c.tsx",
      `export function View() {
  return <div><Button label="x" /><Foo.Bar /></div>;
}`,
    );
    expect(s.hasJsx).toBe(true);
    expect(s.jsxComponents).toContain("Button");
    expect(s.jsxComponents).toContain("Bar");
  });

  it("records exports of functions, classes, interfaces and defaults", () => {
    const s = analyzeAst(
      "d.ts",
      `export function fn() {}
export class Klass {}
export interface Proto {}
export type Alias = string;
const hidden = 1;
export default hidden;
`,
    );
    const names = s.exports.map((e) => e.name);
    expect(names).toEqual(["fn", "Klass", "Proto", "Alias", "default"]);
  });

  it("records re-exports and local export clauses", () => {
    const s = analyzeAst(
      "e.ts",
      `export { alpha } from "./a";
export * from "./b";
const beta = 1;
export { beta };
`,
    );
    expect(s.reexports).toEqual(["./a", "./b"]);
    expect(s.exports).toContainEqual(expect.objectContaining({ name: "alpha" }));
    expect(s.exports).toContainEqual(expect.objectContaining({ name: "beta" }));
  });

  it("detects import.meta.glob patterns", () => {
    const s = analyzeAst(
      "f.ts",
      `const views = import.meta.glob("./views/*.vue");
const more = import.meta.globEager("./widgets/**/*.tsx");
`,
    );
    expect(s.globPatterns).toEqual(["./views/*.vue", "./widgets/**/*.tsx"]);
  });

  it("detects new URL relative references", () => {
    const s = analyzeAst(
      "g.ts",
      `const u = new URL("./assets/logo.png", import.meta.url);
`,
    );
    expect(s.imports[0]).toMatchObject({ specifier: "./assets/logo.png", kind: "dynamic" });
  });

  it("is tolerant of syntax errors", () => {
    const s = analyzeAst("h.ts", `export function broken( {`);
    expect(s).toBeTruthy();
    expect(s.exports).toHaveLength(0);
  });
});

describe("analyzeRegexFallback (vue SFCs)", () => {
  it("extracts imports and template components from .vue files", () => {
    const text = `<template>
  <AlertBox msg="hi" />
</template>
<script setup lang="ts">
import { ref } from "vue";
import AlertBox from "./AlertBox.vue";
const count = ref(0);
</script>
`;
    const s = analyzeRegexFallback("c.vue", text);
    expect(s.imports.map((i) => i.specifier)).toEqual(["vue", "./AlertBox.vue"]);
    expect(s.jsxComponents).toContain("AlertBox");
    expect(s.hasJsx).toBe(true);
  });
});