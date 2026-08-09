import * as fs from "node:fs";
import * as path from "node:path";
import type { CleanupPlan, PlanItem } from "./plan.js";
import { backupDir } from "./plan.js";
import { readPackageJson } from "../config/load.js";
import { relPosix } from "../utils/fs.js";

export interface ApplyResult {
  removed: PlanItem[];
  failed: PlanItem[];
  backupPath: string;
  modifiedPackageJson: string[];
}

/**
 * Executes a cleanup plan. Files are MOVED into `.npm-cleanup/backup/<ts>/`
 * (recoverable), dependencies are removed from package.json. package.json is
 * backed up first. Nothing is ever deleted permanently.
 */
export async function applyPlan(
  root: string,
  plan: CleanupPlan,
  onItem?: (item: PlanItem, status: "ok" | "fail" | "skip", detail: string) => void,
): Promise<ApplyResult> {
  const bDir = backupDir(root);
  await fs.promises.mkdir(bDir, { recursive: true });

  const result: ApplyResult = {
    removed: [],
    failed: [],
    backupPath: bDir,
    modifiedPackageJson: [],
  };

  // Group file removals by workspace package.json edits.
  const packageEdits = new Map<string, string[]>();
  for (const item of plan.items) {
    if (item.kind !== "dependency") continue;
    const pkgJsonPath = packageJsonFor(item, root);
    if (!pkgJsonPath) continue;
    packageEdits.set(pkgJsonPath, [...(packageEdits.get(pkgJsonPath) ?? []), item.packageName!]);
  }

  // Backup + edit package.json files.
  for (const [pkgJsonPath, names] of packageEdits) {
    const backupFile = path.join(bDir, path.basename(pkgJsonPath));
    try {
      await fs.promises.copyFile(pkgJsonPath, backupFile);
      const pkg = readPackageJson(pkgJsonPath);
      if (!pkg) {
        for (const n of names) {
          const item = plan.items.find((i) => i.packageName === n);
          if (item) {
            result.failed.push(item);
            onItem?.(item, "fail", `${n}: could not read package.json`);
          }
        }
        continue;
      }
      const sections = ["dependencies", "devDependencies", "optionalDependencies"];
      for (const n of names) {
        let removedFrom: string | null = null;
        for (const section of sections) {
          const current = pkg[section] as Record<string, string> | undefined;
          if (current && n in current) {
            delete current[n];
            removedFrom = section;
            if (Object.keys(current).length === 0) delete pkg[section];
          }
        }
        const item = plan.items.find((i) => i.packageName === n);
        if (item) {
          if (removedFrom) {
            item.workspaceDir = path.dirname(pkgJsonPath);
            result.removed.push(item);
            result.modifiedPackageJson.push(pkgJsonPath);
            onItem?.(item, "ok", `removed from ${removedFrom} of ${relPosix(pkgJsonPath, root)}`);
          } else {
            result.failed.push(item);
            onItem?.(item, "fail", `${n}: not found in package.json`);
          }
        }
      }
      await fs.promises.writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    } catch (err) {
      for (const n of names) {
        const item = plan.items.find((i) => i.packageName === n);
        if (item) {
          result.failed.push(item);
          onItem?.(item, "fail", (err as Error).message);
        }
      }
    }
  }

  // Move files to backup.
  for (const item of plan.items) {
    if (item.kind !== "file" || !item.path) continue;
    if (!fs.existsSync(item.path)) {
      result.failed.push(item);
      onItem?.(item, "fail", "file does not exist");
      continue;
    }
    const rel = relPosix(item.path, root);
    const destDir = path.join(bDir, "files", path.dirname(rel));
    try {
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.rename(item.path, path.join(destDir, path.basename(rel)));
      result.removed.push(item);
      onItem?.(item, "ok", `moved to backup/${rel}`);
    } catch (err) {
      result.failed.push(item);
      onItem?.(item, "fail", (err as Error).message);
    }
  }

  return result;
}

function packageJsonFor(item: PlanItem, root: string): string | null {
  if (!item.packageName) return null;
  const workspaceDir = item.workspaceDir;
  const candidate = workspaceDir
    ? path.join(workspaceDir, "package.json")
    : path.join(root, "package.json");
  return fs.existsSync(candidate) ? candidate : null;
}

/** Restore all backups from a backup directory. */
export async function restoreBackup(root: string, backupPath: string): Promise<number> {
  let restored = 0;
  const files = await fs.promises.readdir(path.join(backupPath, "files"), { withFileTypes: true }).catch(() => []);
  for (const entry of files) {
    const full = path.join(backupPath, "files", entry.name);
    if (!entry.isDirectory()) continue;
    const filesIn = await fs.promises.readdir(full).catch(() => []);
    for (const f of filesIn) {
      const dest = path.join(root, entry.name, f);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(path.join(full, f), dest);
      restored++;
    }
  }
  // package.json backups at top of backup dir
  const pkgBackups = await fs.promises.readdir(backupPath).catch(() => []);
  for (const f of pkgBackups) {
    if (f.endsWith(".json") && f !== "scan-results.json" && f !== "cleanup-plan.json") {
      const dest = path.join(root, "package.json");
      const src = path.join(backupPath, f);
      if (fs.statSync(src).isFile()) {
        await fs.promises.copyFile(src, dest);
        restored++;
      }
    }
  }
  return restored;
}