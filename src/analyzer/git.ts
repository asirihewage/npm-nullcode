import type { GitEvidence } from "../types/index.js";
import { gitExec } from "../utils/exec.js";
import { monthsSince } from "../utils/format.js";

export interface GitInfo {
  available: boolean;
  root: string | null;
}

export async function detectGit(root: string): Promise<GitInfo> {
  try {
    const res = await gitExec(root, ["rev-parse", "--is-inside-work-tree"]);
    if (res.code === 0 && res.stdout.trim() === "true") {
      return { available: true, root };
    }
  } catch {
    // no git binary
  }
  return { available: false, root: null };
}

export async function gitLastCommit(root: string, relPath: string): Promise<string | null> {
  const res = await gitExec(root, ["log", "-1", "--format=%cI", "--", relPath]);
  if (res.code !== 0) return null;
  const line = res.stdout.trim().split("\n")[0];
  return line && line.length > 0 ? line : null;
}

export async function gitCommitCount(root: string, relPath: string): Promise<number> {
  const res = await gitExec(root, ["rev-list", "--count", "HEAD", "--", relPath]);
  if (res.code !== 0) return 0;
  const n = parseInt(res.stdout.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Was the path ever present in git history (even after deletion)? */
export async function gitEverExisted(root: string, relPath: string): Promise<boolean> {
  const res = await gitExec(root, ["log", "--all", "--format=%H", "--", relPath]);
  return res.code === 0 && res.stdout.trim().length > 0;
}

export async function collectGitEvidence(
  git: GitInfo,
  root: string,
  relPath: string,
): Promise<GitEvidence | undefined> {
  if (!git.available) return undefined;
  try {
    const [lastCommit, commitCount, existed] = await Promise.all([
      gitLastCommit(root, relPath),
      gitCommitCount(root, relPath),
      gitEverExisted(root, relPath),
    ]);
    const ev: GitEvidence = {
      available: true,
      lastCommit: lastCommit ?? undefined,
      commitCount: commitCount > 0 ? commitCount : undefined,
      monthsSinceLastChange: monthsSince(lastCommit ?? undefined),
    };
    if (existed && lastCommit === null) {
      ev.removedFromHistory = true;
    }
    return ev;
  } catch {
    return undefined;
  }
}

/** Commit count and age for a package.json entry (dependency-level history). */
export async function gitPackageHistory(
  git: GitInfo,
  root: string,
  packageName: string,
): Promise<GitEvidence | undefined> {
  if (!git.available) return undefined;
  try {
    const res = await gitExec(root, ["log", "-1", "--format=%cI", "-S", `"${packageName}"`, "--", "package.json"]);
    if (res.code !== 0 || res.stdout.trim().length === 0) return undefined;
    const lastCommit = res.stdout.trim().split("\n")[0];
    return {
      available: true,
      lastCommit,
      monthsSinceLastChange: monthsSince(lastCommit),
    };
  } catch {
    return undefined;
  }
}