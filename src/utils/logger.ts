import { createColors, type Colors } from "picocolors";

let colors: Colors = createColors(true);

export function configureColors(enabled: boolean): void {
  colors = createColors(enabled);
}

export interface Logger {
  raw(text: string): void;
  progress(text: string): void;
  info(text: string): void;
  success(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  verbose(text: string): void;
  banner(text: string): void;
}

export function createLogger(opts: { verbose?: boolean; noColor?: boolean }): Logger {
  if (opts.noColor) configureColors(false);
  const verboseEnabled = opts.verbose ?? false;

  const c = colors;
  return {
    raw: (t) => process.stdout.write(t + "\n"),
    progress: (t) => process.stdout.write(`  ${c.dim("▸")} ${t}\n`),
    info: (t) => process.stdout.write(`${c.dim("ℹ")} ${t}\n`),
    success: (t) => process.stdout.write(`${c.green("✓")} ${t}\n`),
    warn: (t) => process.stdout.write(`${c.yellow("⚠")} ${t}\n`),
    error: (t) => process.stderr.write(`${c.red("✖")} ${t}\n`),
    verbose: (t) => {
      if (verboseEnabled) process.stdout.write(`${c.dim("·")} ${t}\n`);
    },
    banner: (t) => process.stdout.write(`${c.bold(t)}\n`),
  };
}

export type { Colors };