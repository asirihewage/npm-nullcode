import { execFile } from "node:child_process";
import * as path from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const TIMEOUT = 15_000;

export function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = TIMEOUT,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
      } as never,
      (error, stdout, stderr) => {
        const code = error
          ? typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code?: unknown }).code as number)
            : 1
          : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export function gitExec(root: string, args: string[]): Promise<ExecResult> {
  return runCommand("git", ["-C", root, ...args], root);
}

export function repoRoot(cwd: string): string {
  // Prefer the passed cwd; do not silently walk up to an unrelated repo.
  return path.resolve(cwd);
}