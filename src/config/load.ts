import * as fs from "node:fs";
import * as path from "node:path";
import type { FrameworkName } from "../types/index.js";
import { createIgnoreMatcher, mergeIgnoreLines, type IgnoreMatcher } from "../utils/ignore.js";
import { pathExists } from "../utils/fs.js";

export interface UserConfig {
  ignore?: string[];
  threshold?: number;
  framework?: "auto" | FrameworkName;
  ai?: boolean;
}

export interface LoadedConfig {
  ignoreLines: string[];
  matcher: IgnoreMatcher;
  userConfig: UserConfig;
  configPath?: string;
}

const CONFIG_FILE = ".npm-cleanupignore";

export function findNearestPackageJson(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (pathExists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readPackageJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function loadUserConfig(root: string): LoadedConfig {
  const lines: string[] = [];
  const ignoreFile = path.join(root, CONFIG_FILE);
  if (fs.existsSync(ignoreFile)) {
    try {
      const content = fs.readFileSync(ignoreFile, "utf8");
      for (const line of content.split(/\r?\n/)) {
        lines.push(line);
      }
    } catch {
      // ignore unreadable ignore files
    }
  }

  let userConfig: UserConfig = {};
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = readPackageJson(pkgPath);
    const section = pkg?.["npmCleanup"];
    if (section && typeof section === "object") {
      const s = section as Record<string, unknown>;
      userConfig = {
        ignore: Array.isArray(s.ignore) ? (s.ignore as string[]).map(String) : undefined,
        threshold: typeof s.threshold === "number" ? s.threshold : undefined,
        framework:
          typeof s.framework === "string"
            ? (s.framework as "auto" | FrameworkName)
            : undefined,
        ai: typeof s.ai === "boolean" ? s.ai : undefined,
      };
    }
  }

  const ignoreLines = mergeIgnoreLines(lines);
  return {
    ignoreLines,
    matcher: createIgnoreMatcher(ignoreLines),
    userConfig,
    configPath: fs.existsSync(ignoreFile) ? ignoreFile : undefined,
  };
}

export interface EffectiveOptions {
  ignore?: string[];
  threshold?: number;
  framework?: "auto" | FrameworkName;
  ai?: boolean;
  enableCache?: boolean;
  verbose?: boolean;
  noColor?: boolean;
}

export function mergeConfig(root: string, cli: EffectiveOptions): {
  matcher: IgnoreMatcher;
  threshold: number;
  framework: "auto" | FrameworkName;
  ai: boolean;
  enableCache: boolean;
  verbose: boolean;
  noColor: boolean;
  userConfig: UserConfig;
} {
  const loaded = loadUserConfig(root);
  const ignoreLines = [...loaded.ignoreLines, ...(cli.ignore ?? [])];
  return {
    matcher: createIgnoreMatcher(ignoreLines),
    threshold: cli.threshold ?? loaded.userConfig.threshold ?? 90,
    framework: cli.framework ?? loaded.userConfig.framework ?? "auto",
    ai: cli.ai ?? loaded.userConfig.ai ?? true,
    enableCache: cli.enableCache ?? true,
    verbose: cli.verbose ?? false,
    noColor: cli.noColor ?? false,
    userConfig: loaded.userConfig,
  };
}