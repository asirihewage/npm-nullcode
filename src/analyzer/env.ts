import type { EnvDefinition } from "../types/index.js";

/** Parses a `.env` style file into key/value pairs. */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    value = value.replace(/^["']|["']$/g, "");
    out.set(m[1]!, value);
  }
  return out;
}

/** Extracts env keys from a Dockerfile (`ENV KEY`, `ENV KEY=value`). */
export function parseDockerEnv(text: string): string[] {
  const keys: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = /^ENV\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*.*)?$/.exec(line);
    if (m) keys.push(m[1]!);
  }
  return keys;
}

/**
 * Extracts env keys from CI configuration. Only keys declared inside `env:`
 * blocks (workflows / .gitlab-ci.yml) count as injections; keys set in other
 * places are ignored to avoid false positives on unrelated yaml keys.
 */
export function parseCiEnv(text: string): string[] {
  const keys: string[] = [];
  const lines = text.split(/\r?\n/);
  let inEnvBlock = false;
  let envIndent = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const indent = rawLine.length - rawLine.trimStart().length;
    if (inEnvBlock) {
      if (trimmed.length === 0) continue;
      const keyRe = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/;
      const isNested = /^[a-z-]+:/.test(trimmed) || trimmed === "env:";
      if (rawLine.startsWith(" ".repeat(envIndent)) && keyRe.test(trimmed) && !isNested) {
        const m = keyRe.exec(trimmed);
        if (m && !["on", "name", "if", "run", "uses", "with", "steps", "jobs"].includes(m[1]!)) {
          keys.push(m[1]!);
          continue;
        }
      }
      if (indent <= envIndent) {
        inEnvBlock = false;
        if (trimmed !== "env:") continue;
      }
    }
    if (trimmed === "env:") {
      inEnvBlock = true;
      envIndent = indent;
    }
  }
  return keys;
}

/** Extracts env keys used inside npm scripts (`$KEY`, `${KEY}`, `%KEY%`). */
export function scanScriptEnv(script: string): string[] {
  const keys = new Set<string>();
  const dollarRe = /\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = dollarRe.exec(script)) !== null) {
    const raw = m[1]!;
    keys.add(raw.startsWith("{") ? raw.slice(1, -1) : raw);
  }
  const percentRe = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
  while ((m = percentRe.exec(script)) !== null) {
    keys.add(m[1]!);
  }
  return [...keys];
}

/** Platform/runtime-injected variables that are commonly used without being
 * configured anywhere in the repo. Never flag these. */
export const PLATFORM_INJECTED = new Set([
  "NODE_ENV",
  "CI",
  "PATH",
  "HOME",
  "HOMEPATH",
  "USER",
  "USERNAME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "OSTYPE",
  "PWD",
  "LANG",
  "LC_ALL",
  "NODE_OPTIONS",
  "npm_config",
  "npm_package",
  "npm_lifecycle",
  "npm_execpath",
  "npm_node_execpath",
  "npm_command",
  "npm_config_registry",
  "NPM_CONFIG_REGISTRY",
  "NPM_TOKEN",
  "YARN_VERSION",
  "PNPM_VERSION",
  "COREPACK_HOME",
  "COREPACK_ROOT",
  "COREPACK_ENABLE_STRICT",
  "GIT_SSH_COMMAND",
  "COLORTERM",
  "FORCE_COLOR",
  "NO_COLOR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY",
]);

/** Packages that implicitly load .env files at runtime. When present, keys
 * defined in .env files are consumed by the framework and must not be flagged. */
export function envLoaderInstalled(pkgNames: Set<string>): { lib: boolean; framework: boolean } {
  const lib = ["dotenv", "dotenv-expand", "@nestjs/config", "env-cmd", "zod-env"].some((p) =>
    pkgNames.has(p),
  );
  const framework = ["next", "nuxt", "astro", "redwoodjs", "remix", "sveltekit"].some((p) =>
    pkgNames.has(p),
  );
  return { lib, framework };
}

/** Keys injected by hosting platforms that should never be flagged even if
 * unused in source (they may be consumed by runtime libraries). */
export const CLOUD_PLATFORM_PREFIXES = ["AWS_", "AZURE_", "GCP_", "GOOGLE_", "NETLIFY_", "VERCEL_", "CF_", "CLOUDFLARE_", "GITHUB_", "GITLAB_", "GH_", "RAILWAY_", "RENDER_", "FLY_", "HEROKU_"];