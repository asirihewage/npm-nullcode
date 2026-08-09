import { describe, expect, it } from "vitest";
import { analyzeLockfile, countVersions } from "../../src/analyzer/lockfile.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function withLock(rel: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nullcode-lock-"));
  fs.writeFileSync(path.join(dir, rel), content);
  return dir;
}

describe("analyzeLockfile", () => {
  it("detects multiple versions from package-lock.json", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/other/node_modules/lodash": { name: "lodash", version: "3.10.1" },
        "node_modules/axios": { version: "1.7.2" },
      },
    });
    const dir = withLock("package-lock.json", lock);
    const info = analyzeLockfile(dir);
    expect(info.lockKind).toBe("package-lock");
    expect(countVersions(info.names).get("lodash")).toBe(2);
    expect(countVersions(info.names).get("axios")).toBe(1);
  });

  it("parses pnpm-lock.yaml names", () => {
    const yaml = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      axios:\n        specifier: ^1.7.0\npackages:\n  axios@1.7.2:\n    resolution: {integrity: sha512-x}\n  lodash@4.17.21:\n    resolution: {integrity: sha512-y}\n`;
    const dir = withLock("pnpm-lock.yaml", yaml);
    const info = analyzeLockfile(dir);
    expect(info.lockKind).toBe("pnpm-lock");
    expect(info.names.get("axios")).toEqual(["1.7.2"]);
    expect(info.names.get("lodash")).toEqual(["4.17.21"]);
  });

  it("returns none when no lockfile exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nullcode-lock2-"));
    const info = analyzeLockfile(dir);
    expect(info.lockKind).toBe("none");
  });
});