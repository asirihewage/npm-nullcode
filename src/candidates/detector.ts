import * as path from "node:path";
import type { AnalyzerContext } from "../analyzer/index.js";
import type { AstSummary } from "../types/index.js";
import { relPosix } from "../utils/fs.js";

export interface DependencyUsage {
  importFiles: string[];
  requireFiles: string[];
  dynamicFiles: string[];
  scriptNames: string[];
  configFiles: string[];
  binNames: string[];
}

/**
 * Combines all reference sources to answer: is this dependency used anywhere?
 */
export function computeDependencyUsage(
  ctx: AnalyzerContext,
  pkgName: string,
): DependencyUsage {
  const usage: DependencyUsage = {
    importFiles: [],
    requireFiles: [],
    dynamicFiles: [],
    scriptNames: [],
    configFiles: [],
    binNames: [],
  };

  for (const [fileAbs, summary] of ctx.ast) {
    for (const ref of summary.imports) {
      const node = ctx.graph.files.get(fileAbs);
      const resolved = node?.imports.get(ref.specifier);
      if (resolved?.kind !== "package" || resolved.packageName !== pkgName) continue;
      if (ref.kind === "require") usage.requireFiles.push(fileAbs);
      else if (ref.kind === "dynamic") usage.dynamicFiles.push(fileAbs);
      else usage.importFiles.push(fileAbs);
    }
    for (const spec of summary.reexports) {
      const resolved = ctx.resolver.resolve(spec, fileAbs);
      if (resolved?.kind === "package" && resolved.packageName === pkgName) {
        usage.importFiles.push(fileAbs);
      }
    }
  }

  // Scripts
  for (const [, scripts] of ctx.scriptsByWorkspace) {
    for (const script of scripts.values()) {
      if (script.pkgUsage.has(pkgName)) {
        usage.scriptNames.push(script.name + ": " + script.value);
      }
    }
  }

  // Config files
  const configRefs = ctx.configAnalysis.pkgUsage.get(pkgName);
  if (configRefs) {
    for (const rel of configRefs) usage.configFiles.push(rel);
  }

  return usage;
}

export interface FileCandidateInfo {
  abs: string;
  rel: string;
  kind: string;
  lines: number;
}

/** Determines whether a source file has any incoming reference at all. */
export function isReferencedPath(ctx: AnalyzerContext, abs: string): boolean {
  const node = ctx.graph.files.get(abs);
  if (!node) return false;
  return (
    node.importedBy.size > 0 ||
    node.hardImportedBy.size > 0 ||
    node.dynamicImporters.size > 0
  );
}

export function isEntryOrVirtual(ctx: AnalyzerContext, abs: string): boolean {
  return ctx.entries.has(abs) || ctx.virtual.has(abs);
}

export function isGenerated(ctx: AnalyzerContext, abs: string): boolean {
  const f = ctx.files.find((x) => x.abs === abs);
  return f?.generated ?? false;
}

export function fileKind(ctx: AnalyzerContext, abs: string): string {
  const f = ctx.files.find((x) => x.abs === abs);
  return f?.kind ?? "unknown";
}

export function lineCount(ctx: AnalyzerContext, abs: string): number {
  const f = ctx.files.find((x) => x.abs === abs);
  return f?.lines ?? 0;
}

export function isInsideVirtualDir(ctx: AnalyzerContext, abs: string): boolean {
  const rel = relPosix(abs, ctx.root);
  for (const v of ctx.virtual) {
    const relV = relPosix(v, ctx.root);
    if (rel.startsWith(relV + "/") || rel === relV) return true;
  }
  return false;
}

/** Can the file be reached through a dynamic import glob pattern? */
export function globRisk(ctx: AnalyzerContext, abs: string): number {
  const node = ctx.graph.files.get(abs);
  if (!node) return 0;
  return node.matchGlob.size;
}

export function allProjectFiles(ctx: AnalyzerContext): string[] {
  return ctx.files.map((f) => f.abs);
}

export function summaryOf(ctx: AnalyzerContext, abs: string): AstSummary | undefined {
  return ctx.ast.get(abs);
}

/** List of files importing this file directly (statically). */
export function hardImportersOf(ctx: AnalyzerContext, abs: string): string[] {
  const node = ctx.graph.files.get(abs);
  if (!node) return [];
  return [...node.hardImportedBy];
}

export function importersOf(ctx: AnalyzerContext, abs: string): string[] {
  const node = ctx.graph.files.get(abs);
  if (!node) return [];
  return [...node.importedBy];
}

export function isTestPath(ctx: AnalyzerContext, abs: string): boolean {
  return ctx.testFiles.has(abs);
}

export function sameDir(ctx: AnalyzerContext, abs: string, rel: string): string {
  void ctx;
  return path.join(path.dirname(abs), rel);
}