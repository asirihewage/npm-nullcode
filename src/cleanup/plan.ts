import * as fs from "node:fs";
import * as path from "node:path";
import type { Candidate, ScanResult } from "../types/index.js";

export interface PlanItem {
  candidateId: string;
  action: "remove";
  kind: "dependency" | "file";
  name: string;
  path?: string;
  packageName?: string;
  version?: string;
  confidence: number;
  category: string;
  workspaceDir?: string;
}

export interface CleanupPlan {
  tool: string;
  version: string;
  createdAt: string;
  rootDir: string;
  dryRun: boolean;
  threshold: number;
  items: PlanItem[];
  skipped: PlanItem[];
}

const STATE_DIR = ".npm-cleanup";

function planItemsFor(candidates: Candidate[], threshold: number): {
  remove: PlanItem[];
  sketchy: PlanItem[];
} {
  const remove: PlanItem[] = [];
  const sketchy: PlanItem[] = [];
  for (const c of candidates) {
    if (c.confidence < threshold) {
      sketchy.push({
        candidateId: c.id,
        action: "remove",
        kind: c.path ? "file" : "dependency",
        name: c.name,
        path: c.path,
        packageName: c.packageName,
        version: c.version,
        confidence: c.confidence,
        category: c.category,
      });
      continue;
    }
    const item: PlanItem = {
      candidateId: c.id,
      action: "remove",
      kind: c.path ? "file" : "dependency",
      name: c.name,
      path: c.path,
      packageName: c.packageName,
      version: c.version,
      confidence: c.confidence,
      category: c.category,
    };
    if (c.path) {
      item.workspaceDir = c.path ? undefined : undefined;
    }
    remove.push(item);
  }
  return { remove, sketchy };
}

export function buildCleanupPlan(
  result: ScanResult,
  rootDir: string,
  opts: { threshold: number; dryRun: boolean },
): CleanupPlan {
  const { remove, sketchy } = planItemsFor(result.candidates, opts.threshold);
  return {
    tool: "npm-cleanup",
    version: result.version,
    createdAt: new Date().toISOString(),
    rootDir,
    dryRun: opts.dryRun,
    threshold: opts.threshold,
    items: remove,
    skipped: sketchy,
  };
}

export function stateDir(root: string): string {
  return path.join(root, STATE_DIR);
}

export function backupDir(root: string): string {
  return path.join(stateDir(root), "backup", new Date().toISOString().replace(/[:.]/g, "-"));
}

export async function persistScanResult(
  root: string,
  result: ScanResult,
): Promise<void> {
  try {
    await fs.promises.mkdir(stateDir(root), { recursive: true });
    await fs.promises.writeFile(
      path.join(stateDir(root), "scan-results.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
  } catch (err) {
    console.warn(`[warn] could not persist scan results: ${(err as Error).message}`);
  }
}

export async function persistPlan(root: string, plan: CleanupPlan): Promise<void> {
  try {
    await fs.promises.mkdir(stateDir(root), { recursive: true });
    await fs.promises.writeFile(
      path.join(stateDir(root), "cleanup-plan.json"),
      JSON.stringify(plan, null, 2),
      "utf8",
    );
  } catch (err) {
    console.warn(`[warn] could not persist cleanup plan: ${(err as Error).message}`);
  }
}