// Generates the integration-test fixtures under tests/fixtures/.
// Run: npm run fixtures
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");

function write(rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function pkgJson(name, extra) {
  return JSON.stringify(
    {
      name,
      version: "1.0.0",
      private: true,
      scripts: extra?.scripts ?? {},
      ...(extra?.deps ? { dependencies: extra.deps } : {}),
      ...(extra?.devDeps ? { devDependencies: extra.devDeps } : {}),
      ...(extra?.rest ?? {}),
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* 1. fixture-unused-dependency                                        */
/* ------------------------------------------------------------------ */
write(
  "fixture-unused-dependency/package.json",
  pkgJson("fixture-unused-dependency", {
    scripts: { lint: "eslint src" },
    deps: { axios: "^1.7.0", lodash: "^4.17.21" },
    devDeps: { eslint: "^9.0.0" },
  }),
);
write(
  "fixture-unused-dependency/src/index.js",
  `import { get } from "axios";

export async function load() {
  return get("/api");
}
`,
);
write(
  "fixture-unused-dependency/src/util.js",
  `export function helper() {
  return 42;
}
`,
);
write(
  "fixture-unused-dependency/eslint.config.mjs",
  `export default [{ ignores: [] }];
`,
);

/* ------------------------------------------------------------------ */
/* 2. fixture-used-dependency                                          */
/* ------------------------------------------------------------------ */
write(
  "fixture-used-dependency/package.json",
  pkgJson("fixture-used-dependency", {
    deps: { express: "^4.19.0", moment: "^2.30.0" },
  }),
);
write(
  "fixture-used-dependency/src/server.js",
  `const express = require("express");
const moment = require("moment");
const app = express();
app.get("/", (req, res) => res.send(moment().format()));
module.exports = app;
`,
);

/* ------------------------------------------------------------------ */
/* 3. fixture-dynamic-import                                           */
/* ------------------------------------------------------------------ */
write(
  "fixture-dynamic-import/package.json",
  pkgJson("fixture-dynamic-import", {
    deps: { moment: "^2.30.0" },
  }),
);
write(
  "fixture-dynamic-import/src/index.js",
  `export async function loadPage(name) {
  const mod = await import(\`./pages/\${name}.js\`);
  return mod;
}
`,
);
write(
  "fixture-dynamic-import/src/pages/alpha.js",
  `export default function alpha() { return "a"; }
`,
);
write(
  "fixture-dynamic-import/src/pages/beta.js",
  `export default function beta() { return "b"; }
`,
);
write(
  "fixture-dynamic-import/src/dynamic-moment.js",
  `export async function withMoment() {
  return import("moment");
}
`,
);

/* ------------------------------------------------------------------ */
/* 4. fixture-nextjs                                                   */
/* ------------------------------------------------------------------ */
write(
  "fixture-nextjs/package.json",
  pkgJson("fixture-nextjs", {
    scripts: { dev: "next dev", build: "next build" },
    deps: { next: "^14.2.0", react: "^18.3.0", "react-dom": "^18.3.0", lodash: "^4.17.21" },
  }),
);
write("fixture-nextjs/app/layout.tsx", `export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }\n`);
write("fixture-nextjs/app/page.tsx", `export default function Home() { return <h1>Home</h1>; }\n`);
write("fixture-nextjs/app/about/page.tsx", `export default function About() { return <h1>About</h1>; }\n`);
write("fixture-nextjs/app/api/route.ts", `export async function GET() { return new Response("ok"); }\n`);
write("fixture-nextjs/middleware.ts", `export function middleware() {}\n`);
write("fixture-nextjs/next.config.mjs", `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nexport default nextConfig;\n`);
write("fixture-nextjs/src/legacy.ts", `export function legacyThing() { return "legacy"; }\n`);

/* ------------------------------------------------------------------ */
/* 5. fixture-react                                                    */
/* ------------------------------------------------------------------ */
write(
  "fixture-react/package.json",
  pkgJson("fixture-react", {
    deps: { react: "^18.3.0", "react-dom": "^18.3.0", classnames: "^2.5.0" },
  }),
);
write("fixture-react/index.html", `<!doctype html><html><head><title>app</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`);
write("fixture-react/src/main.tsx", `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`);
write("fixture-react/src/App.tsx", `import { Button } from "./components/Button";
export function App() { return <div><Button label="hi" /></div>; }
`);
write("fixture-react/src/components/Button.tsx", `export function Button({ label }) { return <button>{label}</button>; }\n`);
write("fixture-react/src/components/UnusedButton.tsx", `export function UnusedButton() { return <button>unused</button>; }\n`);

/* ------------------------------------------------------------------ */
/* 6. fixture-vite                                                     */
/* ------------------------------------------------------------------ */
write(
  "fixture-vite/package.json",
  pkgJson("fixture-vite", {
    scripts: { dev: "vite", build: "vite build" },
    deps: { vite: "^6.0.0", vue: "^3.5.0" },
  }),
);
write(
  "fixture-vite/vite.config.ts",
  `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } }
});
`,
);
write("fixture-vite/index.html", `<!doctype html><html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n`);
write(
  "fixture-vite/src/main.ts",
  `import { createApp } from "vue";
import App from "./App.vue";
import { api } from "@/api";
const views = import.meta.glob("./views/known/*.vue");
createApp(App).mount("#app");
void api;
void views;
`,
);
write("fixture-vite/src/api.ts", `export const api = { get: () => Promise.resolve() };\n`);
write("fixture-vite/src/App.vue", `<template><p>hello</p></template>\n<script setup lang="ts">\nconst a = 1;\n</script>\n`);
write(
  "fixture-vite/src/views/known/a.vue",
  `<template><div>a</div></template>\n`,
);
write(
  "fixture-vite/src/views/unknown/b.vue",
  `<template><div>b</div></template>\n`,
);

/* ------------------------------------------------------------------ */
/* 7. fixture-webpack                                                  */
/* ------------------------------------------------------------------ */
write(
  "fixture-webpack/package.json",
  pkgJson("fixture-webpack", {
    scripts: { build: "webpack --mode production" },
    deps: { webpack: "^5.90.0", lodash: "^4.17.21" },
  }),
);
write(
  "fixture-webpack/webpack.config.js",
  `const path = require("path");
module.exports = {
  entry: "./src/index.js",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
};
`,
);
write("fixture-webpack/src/index.js", `import { util } from "@/util";\nconsole.log(util());\n`);
write("fixture-webpack/src/util.js", `export function util() { return 1; }\n`);
write("fixture-webpack/src/unused.js", `export function unused() { return 2; }\n`);

/* ------------------------------------------------------------------ */
/* 8. fixture-unused-env                                               */
/* ------------------------------------------------------------------ */
write(
  "fixture-unused-env/package.json",
  pkgJson("fixture-unused-env", {}),
);
write("fixture-unused-env/.env", `API_URL=https://api.example.com\nDEBUG_MODE=false\nNODE_ENV=development\n`);
write("fixture-unused-env/.env.example", `API_URL=https://api.example.com\nDEBUG_MODE=false\nENABLE_LEGACY_SEARCH=true\n`);
write(
  "fixture-unused-env/src/app.js",
  `export function connect() {
  return fetch(process.env.API_URL);
}
const env = process.env.NODE_ENV;
`,
);
write(
  "fixture-unused-env/.github/workflows/ci.yml",
  `name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      CI: "true"
    steps:
      - run: node src/app.js
`,
);

/* ------------------------------------------------------------------ */
/* 9. fixture-unused-config                                            */
/* ------------------------------------------------------------------ */
write(
  "fixture-unused-config/package.json",
  pkgJson("fixture-unused-config", {
    scripts: { build: "webpack --mode production" },
    devDeps: { webpack: "^5.90.0", eslint: "^9.0.0" },
  }),
);
write("fixture-unused-config/webpack.config.js", `module.exports = { entry: "./src/index.js" };\n`);
write("fixture-unused-config/vite.config.ts", `import { defineConfig } from "vite";\nexport default defineConfig({});\n`);
write("fixture-unused-config/eslint.config.mjs", `export default [];\n`);
write("fixture-unused-config/.eslintrc.json", `{ "extends": ["eslint:recommended"] }\n`);
write("fixture-unused-config/jest.config.js", `module.exports = { testMatch: ["**/*.test.js"] };\n`);
write("fixture-unused-config/src/index.js", `export default 1;\n`);

/* ------------------------------------------------------------------ */
/* 10. fixture-dead-export                                             */
/* ------------------------------------------------------------------ */
write(
  "fixture-dead-export/package.json",
  pkgJson("fixture-dead-export", {}),
);
write(
  "fixture-dead-export/src/lib/math.ts",
  `export function add(a: number, b: number): number { return a + b; }
export function sub(a: number, b: number): number { return a - b; }
export function multiply(a: number, b: number): number { return a * b; }
`,
);
write(
  "fixture-dead-export/src/main.ts",
  `import { add } from "./lib/math";
export function compute(): number { return add(1, 2); }
console.log(compute());
`,
);

/* ------------------------------------------------------------------ */
/* 11. fixture-framework-entrypoint                                    */
/* ------------------------------------------------------------------ */
write(
  "fixture-framework-entrypoint/package.json",
  pkgJson("fixture-framework-entrypoint", {
    scripts: { start: "node src/server.js", cli: "node bin/cli.js" },
    deps: {},
  }),
);
write(
  "fixture-framework-entrypoint/src/server.js",
  `const { routes } = require("./routes");
const http = require("http");
http.createServer(routes).listen(3000);
`,
);
write(
  "fixture-framework-entrypoint/src/routes.js",
  `const { utilities } = require("./utilities");
exports.routes = (req, res) => res.end(utilities.greet());
`,
);
write("fixture-framework-entrypoint/src/utilities.js", `exports.utilities = { greet: () => "hi" };\n`);
write("fixture-framework-entrypoint/src/legacy-one.js", `exports.legacy = true;\n`);
write(
  "fixture-framework-entrypoint/bin/cli.js",
  `const { run } = require("../lib/run");
run();
`,
);
write("fixture-framework-entrypoint/lib/run.js", `exports.run = () => console.log("run");\n`);

/* ------------------------------------------------------------------ */
/* 12. fixture-monorepo                                                */
/* ------------------------------------------------------------------ */
write(
  "fixture-monorepo/package.json",
  pkgJson("fixture-monorepo", {
    scripts: { typecheck: "tsc -p packages/a" },
    deps: { clipboard: "^2.0.11" },
    devDeps: { typescript: "^5.7.0" },
    rest: { workspaces: ["packages/*"] },
  }),
);
write("fixture-monorepo/pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
write(
  "fixture-monorepo/packages/a/package.json",
  pkgJson("@repo/a", {
    deps: { lodash: "^4.17.21" },
  }),
);
write("fixture-monorepo/packages/a/src/index.ts", `export function aThing(): string { return "a"; }\n`);
write(
  "fixture-monorepo/packages/b/package.json",
  pkgJson("@repo/b", {
    deps: { "@repo/a": "workspace:*" },
  }),
);
write(
  "fixture-monorepo/packages/b/src/index.ts",
  `import { aThing } from "@repo/a";
export function bThing(): string { return aThing() + "b"; }
`,
);

/* ------------------------------------------------------------------ */
/* 13. fixture-generated-code                                          */
/* ------------------------------------------------------------------ */
write(
  "fixture-generated-code/package.json",
  pkgJson("fixture-generated-code", {}),
);
write(
  "fixture-generated-code/src/generated/types.ts",
  `// @generated by codegen — do not edit
export interface GeneratedTypes { a: string }
`,
);
write(
  "fixture-generated-code/src/codegen-output/api.ts",
  `// This file is auto-generated. DO NOT EDIT.
export const apiGen = 1;
`,
);
write("fixture-generated-code/src/manual.ts", `export const manual = 1;\n`);

/* ------------------------------------------------------------------ */
/* 14. fixture-unused-test-util                                        */
/* ------------------------------------------------------------------ */
write(
  "fixture-unused-test-util/package.json",
  pkgJson("fixture-unused-test-util", {
    devDeps: {},
  }),
);
write("fixture-unused-test-util/src/pure.ts", `export function pure(a: number) { return a * 2; }\n`);
write(
  "fixture-unused-test-util/tests/helpers/makeTestData.ts",
  `export function makeTestData(): string[] { return ["x"]; }
`,
);
write(
  "fixture-unused-test-util/tests/app.test.ts",
  `import { pure } from "../src/pure";
import { makeTestData } from "./helpers/makeTestData";
test("pure doubles", () => { expect(pure(2)).toBe(4); });
expect(makeTestData()).toEqual(["x"]);
`,
);
write("fixture-unused-test-util/tests/legacyTestUtils.ts", `export function obsoleteHelper() { return 0; }\n`);

/* ------------------------------------------------------------------ */
/* 15. fixture-dead-code-cascade                                       */
/* ------------------------------------------------------------------ */
write(
  "fixture-dead-code-cascade/package.json",
  pkgJson("fixture-dead-code-cascade", {}),
);
write(
  "fixture-dead-code-cascade/src/App.tsx",
  `import { OldHelper } from "./helpers/old";
export function App() { return <div>{OldHelper()}</div>; }
`,
);
write("fixture-dead-code-cascade/src/helpers/old.ts", `export function OldHelper() { return "old"; }\n`);
write("fixture-dead-code-cascade/src/live.ts", `export const live = 1;\n`);

/* ------------------------------------------------------------------ */
/* 16. fixture-dup-deps                                                */
/* ------------------------------------------------------------------ */
write(
  "fixture-dup-deps/package.json",
  pkgJson("fixture-dup-deps", {
    deps: { lodash: "^4.17.21" },
    devDeps: { lodash: "^4.17.21" },
    rest: { workspaces: ["packages/*"] },
  }),
);
write("fixture-dup-deps/packages/a/package.json", pkgJson("dup-a", { deps: { lodash: "^3.10.1" } }));
write("fixture-dup-deps/packages/a/src/index.js", `export default 1;\n`);
write("fixture-dup-deps/packages/b/package.json", pkgJson("dup-b", { deps: { lodash: "^4.17.21" } }));
write("fixture-dup-deps/packages/b/src/index.js", `export default 2;\n`);
write(
  "fixture-dup-deps/package-lock.json",
  JSON.stringify(
    {
      name: "fixture-dup-deps",
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture-dup-deps", devDependencies: {} },
        "node_modules/lodash": { version: "4.17.21", dev: true },
        "node_modules/lodash3": { name: "lodash", version: "3.10.1" },
      },
      dependencies: { lodash: { version: "4.17.21" } },
    },
    null,
    2,
  ),
);

/* ------------------------------------------------------------------ */
/* 17. fixture-css                                                     */
/* ------------------------------------------------------------------ */
write(
  "fixture-css/package.json",
  pkgJson("fixture-css", {
    scripts: { build: "vite build" },
    deps: { vite: "^6.0.0" },
  }),
);
write("fixture-css/index.html", `<!doctype html><html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body></body></html>\n`);
write("fixture-css/src/styles/main.css", `body { margin: 0; }\n`);
write("fixture-css/src/styles/legacy.css", `.old { color: red; }\n`);
write("fixture-css/src/styles/legacy.scss", `$color: red;\n.old2 { color: $color; }\n`);

console.log(`fixtures written to ${root}`);