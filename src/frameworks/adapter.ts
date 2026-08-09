import type { AliasMap, FrameworkAdapter, FrameworkContext } from "../types/index.js";
import { fileExists } from "../utils/fs.js";
import * as path from "node:path";

export abstract class BaseAdapter implements FrameworkAdapter {
  abstract readonly name: FrameworkAdapter["name"];
  abstract detect(ctx: FrameworkContext): number;
  abstract entries(ctx: FrameworkContext): string[];
  abstract virtualFiles(ctx: FrameworkContext): string[];
  abstract implicitPackages(ctx: FrameworkContext): string[];
  abstract aliasMaps(ctx: FrameworkContext): AliasMap[];
  description(): string {
    return this.name;
  }
}

export function fileAtRoot(ctx: FrameworkContext, name: string): boolean {
  return ctx.allFiles.includes(name);
}

export function anyFile(ctx: FrameworkContext, predicate: (rel: string) => boolean): boolean {
  return ctx.allFiles.some(predicate);
}

export function hasDep(ctx: FrameworkContext, name: string): boolean {
  return ctx.pkgNames.has(name);
}

export function absPath(ctx: FrameworkContext, rel: string): string | null {
  const p = path.resolve(ctx.rootDir, rel.replace(/^\//, ""));
  return fileExists(p) ? p : null;
}

export function listDirFiles(ctx: FrameworkContext, dir: string): string[] {
  return ctx.allFiles.filter((f) => f.startsWith(dir + "/"));
}