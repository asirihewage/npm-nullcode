import { describe, expect, it } from "vitest";
import {
  parseEnvFile,
  parseDockerEnv,
  parseCiEnv,
  scanScriptEnv,
  PLATFORM_INJECTED,
  CLOUD_PLATFORM_PREFIXES,
} from "../../src/analyzer/env.js";

describe("env parsing", () => {
  it("parses .env files including comments and quotes", () => {
    const map = parseEnvFile(
      `# comment
API_URL=https://api.example.com
DEBUG_MODE="false"
EMPTY=
`,
    );
    expect(map.get("API_URL")).toBe("https://api.example.com");
    expect(map.get("DEBUG_MODE")).toBe("false");
    expect(map.get("EMPTY")).toBe("");
    expect(map.size).toBe(3);
  });

  it("extracts keys from Dockerfiles", () => {
    expect(parseDockerEnv("FROM node\nENV NODE_ENV production\nENV PORT=3000")).toEqual([
      "NODE_ENV",
      "PORT",
    ]);
  });

  it("extracts keys only from env: blocks in CI yaml", () => {
    const yaml = `name: ci
on: [push]
env:
  GLOBAL_VAR: "1"
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      JOB_VAR: "x"
    steps:
      - name: run
        run: echo hi
`;
    const keys = parseCiEnv(yaml);
    expect(keys).toContain("GLOBAL_VAR");
    expect(keys).toContain("JOB_VAR");
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("runs-on");
  });

  it("finds env usage inside npm scripts", () => {
    const keys = scanScriptEnv('node ./x.js --port $PORT && echo ${CI} and %DEBUG%');
    expect(keys).toEqual(["PORT", "CI", "DEBUG"]);
  });
});

describe("env safety lists", () => {
  it("protects platform-injected variables", () => {
    expect(PLATFORM_INJECTED.has("NODE_ENV")).toBe(true);
    expect(PLATFORM_INJECTED.has("CI")).toBe(true);
    expect(PLATFORM_INJECTED.has("PATH")).toBe(true);
  });

  it("protects cloud platform prefixes", () => {
    expect(CLOUD_PLATFORM_PREFIXES.some((p) => "AWS_SECRET_KEY".startsWith(p))).toBe(true);
  });
});