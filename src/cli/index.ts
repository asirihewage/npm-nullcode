import { Command } from "commander";
import { runCli } from "./run.js";

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name("npm-cleanup")
    .description("Find what you can safely remove from your JavaScript/TypeScript project.")
    .version("0.1.0", "-v, --version", "output the version number");

  program
    .option("--fix", "apply the cleanup plan (dry-run by default)")
    .option("-i, --interactive", "review candidates one by one before removal")
    .option("--json", "emit machine-readable JSON")
    .option("--ci", "CI mode: exit 1 when candidates exceed the threshold")
    .option("--sarif", "emit a SARIF 2.1 report")
    .option("--verbose", "show score breakdowns and extra detail")
    .option("--explain <item>", "show why a dependency/file/config was flagged")
    .option("--no-ai", "disable the LLM reasoning layer (deterministic only)")
    .option("--no-cache", "disable the analysis cache")
    .option("--threshold <n>", "confidence threshold for --fix/--ci (default 90)", "90")
    .option("--yes, -y", "skip confirmation when fixing")
    .option("--no-color", "disable ANSI colors")
    .option("--framework <name>", "force framework detection (auto, next, react, vite, webpack, angular, vue, node, express, nestjs, typescript, javascript)")
    .option("--ignore <patterns>", "comma-separated additional ignore patterns")
    .argument("[path]", "path to a specific file to focus the report on");

  const sub = (name: string, desc: string): Command =>
    program.command(name).description(desc);

  sub("scan", "run a full scan (default)").action(async () => {
    process.exitCode = await runCli({ tool: "scan", argv });
  });
  sub("deps", "scan for unused dependencies only").action(async () => {
    process.exitCode = await runCli({ tool: "deps", argv });
  });
  sub("files", "scan for dead source files only").action(async () => {
    process.exitCode = await runCli({ tool: "files", argv });
  });
  sub("config", "scan for unused configuration files only").action(async () => {
    process.exitCode = await runCli({ tool: "config", argv });
  });
  sub("env", "scan for unused environment variables only").action(async () => {
    process.exitCode = await runCli({ tool: "env", argv });
  });
  sub("explain <item>", "show detailed reasoning for a candidate").action(async (item: string) => {
    process.exitCode = await runCli({ tool: "explain", item, argv });
  });
  sub("init", "write a .npm-cleanupignore template").action(async () => {
    process.exitCode = await runCli({ tool: "init", argv });
  });

  program.action(async (_path?: string) => {
    process.exitCode = await runCli({ tool: "scan", argv, positional: _path });
  });

  program.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "commander.helpDisplayed") return 0;
    if (e.code === "commander.version") return 0;
    process.stderr.write(`npm-cleanup: ${e.message ?? String(err)}\n`);
    return 2;
  }
  return process.exitCode ?? 0;
}

if (process.argv[1] && /cli[/\\]index\.(js|ts)$/.test(process.argv[1])) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}