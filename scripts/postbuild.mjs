import { readFile, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "index.js");
const text = await readFile(out, "utf8");
if (!text.startsWith("#!")) {
  await writeFile(out, "#!/usr/bin/env node\n" + text, "utf8");
}
try {
  await chmod(out, 0o755);
} catch {
  // chmod is a no-op on Windows; ignore.
}
console.log("postbuild: CLI entry ready at dist/cli/index.js");