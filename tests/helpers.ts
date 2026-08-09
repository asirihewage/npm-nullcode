import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const FIXTURES = path.join(__dirname, "fixtures");

export function copyFixtureToTemp(name: string): string {
  const src = path.join(FIXTURES, name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `nullcode-${name}-`));
  copyDir(src, dest);
  return dest;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

export function fixturePath(name: string): string {
  return path.join(FIXTURES, name);
}

export function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

export function pick(
  candidates: Array<{ name: string }>,
  name: string,
): { name: string } & Record<string, unknown> {
  const found = candidates.find((c) => c.name === name);
  if (!found) throw new Error(`no candidate named '${name}'`);
  return found as { name: string } & Record<string, unknown>;
}