import * as path from "node:path";
import type { AnalyzerContext } from "../analyzer/index.js";
import type {
  Candidate,
  CandidateEvidence,
  DuplicateInfo,
  DynamicRisk,
  ScorePart,
  WorkspaceInfo,
} from "../types/index.js";
import { relPosix } from "../utils/fs.js";
import { collectGitEvidence, gitPackageHistory } from "../analyzer/git.js";
import { scoreConfidence, categoryFor } from "../scoring/scorer.js";
import { shortHash } from "../utils/hash.js";
import { findStringReferences } from "./string-refs.js";
import {
  computeDependencyUsage,
  globRisk,
  hardImportersOf,
  isEntryOrVirtual,
  isGenerated,
  isInsideVirtualDir,
  isReferencedPath,
  isTestPath,
  lineCount,
  summaryOf,
} from "./detector.js";
import { envLoaderInstalled, PLATFORM_INJECTED, CLOUD_PLATFORM_PREFIXES } from "../analyzer/env.js";
import { isTestUtility } from "../analyzer/tests.js";

export interface DetectOptions {
  onProgress?: (stage: string, message?: string) => void;
}

export interface DetectResult {
  candidates: Candidate[];
  duplicates: DuplicateInfo[];
  warnings: string[];
  infoMessages: string[];
}

const WEAK_EXTENSIONS = new Set([".d.ts", ".md", ".json"]);

function mkId(type: string, key: string): string {
  return `${type}:${shortHash(key)}`;
}

function scriptUsageOf(ctx: AnalyzerContext, abs: string): string[] {
  const out: string[] = [];
  for (const [, scripts] of ctx.scriptsByWorkspace) {
    for (const script of scripts.values()) {
      if (script.fileUsage.has(abs)) out.push(script.name);
    }
  }
  return out;
}

function configUsageOf(ctx: AnalyzerContext, abs: string): { rel: string; count: number }[] {
  const out: { rel: string; count: number }[] = [];
  const refs = ctx.configAnalysis.fileUsage.get(abs);
  if (refs) {
    for (const rel of refs) {
      const existing = out.find((o) => o.rel === rel);
      if (existing) existing.count++;
      else out.push({ rel, count: 1 });
    }
  }
  return out;
}

function dynamicRiskFor(
  ctx: AnalyzerContext,
  abs: string,
  importers: string[],
): DynamicRisk {
  const node = ctx.graph.files.get(abs);
  const globMatched = node?.matchGlob.size ?? 0;
  if (globMatched > 0) return "high";
  if (node?.dynamicImporters.size) return "medium";
  // Dynamic imports with template/variable arguments anywhere heighten risk.
  for (const [fileAbs, summary] of ctx.ast) {
    void fileAbs;
    for (const ref of summary.imports) {
      if (ref.kind === "dynamic" && ref.specifier.includes("${")) {
        void importers;
        return "medium";
      }
    }
  }
  return "none";
}

function testRefsOf(ctx: AnalyzerContext, abs: string): string[] {
  const node = ctx.graph.files.get(abs);
  if (!node) return [];
  return [...node.importedBy].filter((f) => isTestPath(ctx, f));
}

export async function detectCandidates(
  ctx: AnalyzerContext,
  opts: DetectOptions = {},
): Promise<DetectResult> {
  const warnings: string[] = [];
  const infoMessages: string[] = [];
  const duplicates: DuplicateInfo[] = [];
  const candidates: Candidate[] = [];

  /* ---------------- file candidates first (deps may depend on the set) ---------------- */

  opts.onProgress?.("files", "Detecting dead source files...");

  const reachableFromEntries = computeReachable(ctx);

  const fileCandidates: Candidate[] = [];
  const deadFiles = new Set<string>();

  for (const file of ctx.files) {
    if (file.kind !== "source" && file.kind !== "css" && file.kind !== "test") continue;
    if (file.generated) continue;
    if (file.ext === ".d.ts") continue;
    if (/\/?(generated|codegen|\.gen|\.cache)\//.test(file.rel)) continue;
    if (isEntryOrVirtual(ctx, file.abs)) continue;
    if (isInsideVirtualDir(ctx, file.abs)) continue;
    if (isTestPath(ctx, file.abs) && file.kind !== "test") continue;
    if (reachableFromEntries.has(file.abs)) continue;

    const importers = hardImportersOf(ctx, file.abs);
    const dynamicImporters = ctx.graph.files.get(file.abs)?.dynamicImporters ?? new Set<string>();
    const isReferenced = isReferencedPath(ctx, file.abs);

    // CSS: only flag unimported css that is also not matched by globs.
    if (file.kind === "css") {
      if (isReferenced) continue;
      const node = ctx.graph.files.get(file.abs);
      if (node && node.matchGlob.size > 0) continue;
      const strings = await findStringReferences(ctx, file.abs);
      const positives: ScorePart[] = [
        { label: "No imports anywhere in the project", points: 35 },
        { label: "Not referenced by any string/glob pattern", points: strings.count === 0 ? 15 : 0 },
        { label: "Not an entry point (index.html, angular styles)", points: 12 },
      ];
      const negatives: ScorePart[] = [];
      if (strings.count > 0) {
        negatives.push({ label: `Referenced via strings (${strings.count})`, points: -15 });
      }
      const { confidence, parts } = scoreConfidence({ positives, negatives });
      candidates.push({
        id: mkId("css_file", file.abs),
        type: "css_file",
        name: file.rel,
        key: file.abs,
        path: file.abs,
        confidence,
        category: categoryFor(confidence),
        recommendation:
          "Unreferenced stylesheet — verify it is not loaded by a bundler plugin before removing.",
        action: { kind: "delete" },
        evidence: {
          type: "css_file",
          imports: 0,
          importFiles: [],
          requires: 0,
          dynamicImports: 0,
          scripts: [],
          configs: [],
          stringRefs: strings.count,
          testRefs: 0,
          framework: ctx.framework,
          dynamicRisk: "none",
          referencedBy: strings.sources,
          lines: lineCount(ctx, file.abs),
        },
        scoreParts: parts,
      });
      continue;
    }

    if (file.kind === "test") {
      // Test files are auto-discovered by runners; only standalone test
      // utilities with zero references are candidates.
      if (isReferenced) continue;
      if (!isTestUtility(file.rel)) continue;
      if (file.rel.includes("__mocks__")) continue;
    } else if (isReferenced) {
      continue;
    }

    // A file with zero references — gather evidence.
    const strings = await findStringReferences(ctx, file.abs);
    const scripts = scriptUsageOf(ctx, file.abs);
    const configs = configUsageOf(ctx, file.abs);
    const testRefs = testRefsOf(ctx, file.abs);
    const exported = summaryOf(ctx, file.abs)?.exports ?? [];
    const exportsCount = exported.length;
    const globRiskCount = globRisk(ctx, file.abs);
    const dynamicImportersArr = [...dynamicImporters];
    const git = await collectGitEvidence(ctx.git, ctx.root, file.rel);
    const monthsAgo = git?.monthsSinceLastChange ?? null;

    const positives: ScorePart[] = [
      { label: "No imports found anywhere in the project", points: 40 },
      {
        label: "Not referenced in any string literal or glob pattern",
        points: strings.count === 0 ? 12 : 0,
      },
      { label: "Not referenced by any configuration file", points: configs.length === 0 ? 8 : 0 },
      { label: "Not referenced by npm scripts", points: scripts.length === 0 ? 8 : 0 },
    ];
    const negatives: ScorePart[] = [];
    if (strings.count > 0) {
      negatives.push({ label: `Referenced through strings (${strings.count})`, points: -12 });
    }
    if (configs.length > 0) {
      negatives.push({ label: "Referenced in configuration", points: -8 });
    }
    if (scripts.length > 0) {
      negatives.push({ label: "Referenced by npm scripts", points: -8 });
    }
    if (globRiskCount > 0) {
      negatives.push({ label: "Matches a dynamic import glob pattern", points: -20 });
    }
    if (dynamicImportersArr.length > 0) {
      negatives.push({ label: "Loaded via dynamic import()", points: -20 });
    }
    if (git && git.monthsSinceLastChange !== null && git.monthsSinceLastChange >= 12) {
      positives.push({
        label: `Not modified in ${Math.round(git.monthsSinceLastChange)} months (git)`,
        points: 8,
      });
    }
    if (git && git.monthsSinceLastChange !== null && git.monthsSinceLastChange < 3) {
      negatives.push({ label: "Modified recently (git)", points: -8 });
    }
    if (testRefs.length === 0) {
      positives.push({ label: "Not referenced by tests", points: 4 });
    }
    if (exportsCount === 0 && !isReferenced) {
      positives.push({ label: "Exports nothing (no public API surface)", points: 5 });
    }
    if (isLibraryWorkspace(ctx, file.abs)) {
      negatives.push({ label: "Inside a published package workspace", points: -10 });
    }
    negatives.push({ label: "External tooling may reference known paths", points: -10 });

    const { confidence, parts } = scoreConfidence({ positives, negatives });

    const evidence: CandidateEvidence = {
      type: "source_file",
      imports: 0,
      importFiles: [],
      requires: 0,
      dynamicImports: dynamicImportersArr.length,
      scripts: scripts.map((s) => `script:${s}`),
      configs: configs.map((c) => `config:${c.rel}`),
      stringRefs: strings.count,
      testRefs: testRefs.length,
      git,
      framework: ctx.framework,
      dynamicRisk: dynamicRiskFor(ctx, file.abs, dynamicImportersArr),
      importedByCount: 0,
      referencedBy: [...strings.sources, ...scripts.map((s) => s)],
      exported: exported.map((e) => e.name),
      pending: git?.available === true && git.lastCommit === undefined,
      lines: lineCount(ctx, file.abs),
    };

    const c: Candidate = {
      id: mkId("source_file", file.abs),
      type: "source_file",
      name: file.rel,
      key: file.abs,
      path: file.abs,
      confidence,
      category: categoryFor(confidence),
      recommendation: buildFileRecommendation(evidence),
      action: { kind: "delete" },
      evidence,
      scoreParts: parts,
    };
    candidates.push(c);
    fileCandidates.push(c);
    if (confidence >= 60) deadFiles.add(file.abs);
  }

  /* ---------------- dependencies ---------------- */

  opts.onProgress?.("deps", "Detecting unused dependencies...");

  const implicit = new Set<string>(ctx.implicitPackages);

  const envLoader = envLoaderInstalled(ctx.pkgNames);

  for (const ws of ctx.workspaces) {
    const sections: Array<{
      key: "dependencies" | "devDependencies" | "optionalDependencies";
      deps: Map<string, string>;
    }> = [
      { key: "dependencies", deps: ws.dependencies },
      { key: "devDependencies", deps: ws.devDependencies },
      { key: "optionalDependencies", deps: ws.optionalDependencies },
    ];
    for (const section of sections) {
      for (const [name, version] of section.deps) {
        if (implicit.has(name)) continue;
        const usage = computeDependencyUsage(ctx, name);
        const allUsage = [
          ...usage.importFiles,
          ...usage.requireFiles,
          ...usage.dynamicFiles,
        ];

        if (allUsage.length === 0 && usage.scriptNames.length === 0 && usage.configFiles.length === 0) {
          // ----- completely unused -----
          const dockerNpx = dockerOrCiNpx(ctx, name);
          const gitHist = await gitPackageHistory(ctx.git, ws.dir, name);
          const monthsAgo = gitHist?.monthsSinceLastChange ?? null;
          const positives: ScorePart[] = [
            { label: "0 imports, 0 require(), 0 dynamic imports", points: 50 },
            { label: "0 npm script references", points: 15 },
            { label: "0 config references", points: 10 },
            { label: "0 test references", points: 5 },
          ];
          const negatives: ScorePart[] = [];
          if (dockerNpx) {
            negatives.push({ label: `Referenced by npx in ${dockerNpx}`, points: -25 });
          }
          if (monthsAgo !== null && monthsAgo >= 12) {
            positives.push({
              label: `Declared in package.json for ${Math.round(monthsAgo)} months (git)`,
              points: 10,
            });
          }
          if (gitHist === undefined || gitHist.lastCommit === undefined) {
            negatives.push({ label: "No git history for this dependency (new or untracked)", points: -5 });
          }
          if (section.key === "devDependencies" && ws.devDependencies.get(name) && ws.dependencies.has(name)) {
            negatives.push({ label: "Also listed in dependencies", points: -5 });
          }
          const { confidence, parts } = scoreConfidence({ positives, negatives });
          const c: Candidate = {
            id: mkId("dependency", `${ws.dir}:${name}`),
            type: section.key === "dependencies" ? "dependency" : section.key === "optionalDependencies" ? "optionalDependency" : "devDependency",
            name,
            key: name,
            packageName: name,
            version,
            dependencyType: section.key,
            confidence,
            category: categoryFor(confidence),
            recommendation:
              "No usage detected in source, scripts, configuration or tests. Run `npm uninstall " +
              name +
              "` after a manual sanity check.",
            action: { kind: "uninstall" },
            evidence: {
              type: section.key === "dependencies" ? "dependency" : "devDependency",
              imports: 0,
              importFiles: [],
              requires: 0,
              dynamicImports: 0,
              scripts: [],
              configs: [],
              stringRefs: 0,
              testRefs: 0,
              git: gitHist,
              framework: ctx.framework,
              dynamicRisk: templateImportRisk(ctx, name),
              lines: 0,
            },
            scoreParts: parts,
          };
          candidates.push(c);
          continue;
        }

        if (allUsage.length > 0 && allUsage.every((f) => deadFiles.has(f))) {
          // ----- used only by dead code -----
          const gitHist = await gitPackageHistory(ctx.git, ws.dir, name);
          const positives: ScorePart[] = [
            { label: "Imported only by files no one imports", points: 25 },
            { label: "0 npm script references", points: 10 },
            { label: "0 config references", points: 5 },
          ];
          const negatives: ScorePart[] = [];
          if (gitHist && gitHist.monthsSinceLastChange !== null && gitHist.monthsSinceLastChange >= 12) {
            positives.push({
              label: `Declared ${Math.round(gitHist.monthsSinceLastChange)} months ago (git)`,
              points: 5,
            });
          } else {
            negatives.push({ label: "Recent git activity on package.json", points: -5 });
          }
          const { confidence, parts } = scoreConfidence({ positives, negatives });
          const c: Candidate = {
            id: mkId("dependency_dead_only", `${ws.dir}:${name}`),
            type: "dependency_dead_only",
            name,
            key: name,
            packageName: name,
            version,
            dependencyType: section.key,
            confidence,
            category: categoryFor(confidence),
            recommendation:
              "Used only by modules that are themselves unreferenced. Removing those modules first makes this dependency removable.",
            action: { kind: "keep" },
            evidence: {
              type: "dependency_dead_only",
              imports: allUsage.length,
              importFiles: [...new Set(allUsage)].slice(0, 10),
              requires: usage.requireFiles.length,
              dynamicImports: usage.dynamicFiles.length,
              scripts: [],
              configs: [],
              stringRefs: 0,
              testRefs: 0,
              git: gitHist,
              framework: ctx.framework,
              dynamicRisk: "none",
              deadOnly: true,
            },
            scoreParts: parts,
          };
          candidates.push(c);
          continue;
        }

        // referenced — informational only in the JSON (not a candidate)
        if (usage.dynamicFiles.length > 0 && usage.importFiles.length === 0 && usage.requireFiles.length === 0) {
          // dynamic-only usage: real usage, keep quiet.
        }
      }
    }
  }

  /* ---------------- duplicates ---------------- */

  for (const ws of ctx.workspaces) {
    for (const [name] of ws.dependencies) {
      if (ws.devDependencies.has(name)) {
        duplicates.push({
          package: name,
          detail: `Listed in both dependencies and devDependencies of ${ws.name}`,
          locations: [path.join(ws.dir, "package.json")],
        });
      }
    }
  }
  // multiple versions across the lockfile
  if (ctx.lock.lockKind !== "none") {
    for (const [name, versions] of ctx.lock.names) {
      if (versions.length > 1) {
        duplicates.push({
          package: name,
          detail: `Resolved to ${versions.length} distinct versions: ${versions.join(", ")}`,
          locations: [path.join(ctx.root, "package-lock.json")],
        });
      }
    }
  }

  /* ---------------- unused exports ---------------- */

  opts.onProgress?.("exports", "Detecting unused exports...");

  for (const [fileAbs, node] of ctx.graph.files) {
    if (node.importedBy.size === 0 && node.hardImportedBy.size === 0) continue;
    if ([...node.hardImportedBy].some((f) => ctx.entries.has(f))) continue;
    if (isEntryOrVirtual(ctx, fileAbs)) continue;
    if (isLibraryWorkspace(ctx, fileAbs)) continue;
    if (summaryOf(ctx, fileAbs) === undefined) continue;
    if (node.namespaceImporters.size > 0) continue;
    SummaryLoop: for (const exportName of summaryOf(ctx, fileAbs)!.exports) {
      if (exportName.isDefault) continue;
      const requested = node.importersByExport.get(exportName.name);
      if (requested && requested.size > 0) continue;
      const rel = relPosix(fileAbs, ctx.root);
      const git = await collectGitEvidence(ctx.git, ctx.root, rel);
      const positives: ScorePart[] = [
        { label: "Export is not imported by any module", points: 55 },
        { label: "No namespace imports of this module", points: 10 },
        { label: "Module has direct importers (file is alive)", points: 10 },
      ];
      const negatives: ScorePart[] = [];
      if (git && git.monthsSinceLastChange !== null && git.monthsSinceLastChange >= 12) {
        positives.push({
          label: `Not modified in ${Math.round(git.monthsSinceLastChange)} months (git)`,
          points: 5,
        });
      }
      if (node.importersRequestingDefault.size > 0) {
        negatives.push({ label: "Module imported with default import", points: -10 });
      }
      const exportedAsWhole = summaryOf(ctx, fileAbs)!.reexports.length > 0;
      if (exportedAsWhole) {
        negatives.push({ label: "Module re-exported wholesale somewhere", points: -15 });
      }
      const { confidence, parts } = scoreConfidence({ positives, negatives });
      const c: Candidate = {
        id: mkId("unused_export", `${fileAbs}#${exportName.name}`),
        type: "unused_export",
        name: `${rel}#${exportName.name}`,
        key: `${fileAbs}#${exportName.name}`,
        path: fileAbs,
        confidence,
        category: categoryFor(confidence),
        recommendation: `Export '${exportName.name}' is never imported. Safe to delete after checking for dynamic access.`,
        action: { kind: "edit" },
        evidence: {
          type: "unused_export",
          imports: requested?.size ?? 0,
          importFiles: [],
          requires: 0,
          dynamicImports: 0,
          scripts: [],
          configs: [],
          stringRefs: 0,
          testRefs: 0,
          git,
          framework: ctx.framework,
          dynamicRisk: "none",
          exported: [exportName.name],
          importedByCount: node.hardImportedBy.size,
          lines: lineCount(ctx, fileAbs),
        },
        scoreParts: parts,
      };
      if (confidence < 60 && !hasReExportOf(ctx, fileAbs, exportName.name)) {
        continue SummaryLoop;
      }
      candidates.push(c);
    }
  }

  /* ---------------- environment variables ---------------- */

  opts.onProgress?.("env", "Checking environment variables...");

  const realEnvDefs = ctx.envDefs.filter((d) => d.kind === "env-file");
  const exampleDefs = ctx.envDefs.filter((d) => d.kind === "example");
  const ciDockerKeys = new Set(
    ctx.envDefs.filter((d) => d.kind === "ci" || d.kind === "docker").map((d) => d.key),
  );

  if (ctx.envDefs.length > 0) {
    if (envLoader.lib || envLoader.framework) {
      infoMessages.push(
        "Environment variables are consumed by a runtime loader (dotenv/Next) — skipping 'defined but unused' findings.",
      );
    } else {
      const seenKeys = new Set<string>();
      for (const def of realEnvDefs) {
        if (seenKeys.has(def.key)) continue;
        seenKeys.add(def.key);
        if (PLATFORM_INJECTED.has(def.key)) continue;
        if (CLOUD_PLATFORM_PREFIXES.some((p) => def.key.startsWith(p))) continue;
        const used = ctx.envUsage.has(def.key);
        if (used) continue;
        if (ciDockerKeys.has(def.key)) continue;
        const positives: ScorePart[] = [
          { label: "Defined in a .env file", points: 20 },
          { label: "Referenced nowhere in source, scripts or configs", points: 40 },
          { label: "Not declared in CI or Docker", points: 12 },
          { label: "Not a platform-injected variable", points: 8 },
        ];
        const { confidence, parts } = scoreConfidence({ positives, negatives: [] });
        const c: Candidate = {
          id: mkId("env_defined_unused", def.key),
          type: "env_defined_unused",
          name: def.key,
          key: def.key,
          confidence,
          category: categoryFor(confidence),
          recommendation:
            "Defined in a .env file but never referenced. Consider removing it (and from CI providers) after verification.",
          action: { kind: "edit" },
          evidence: {
            type: "env_defined_unused",
            imports: 0,
            importFiles: [def.file],
            requires: 0,
            dynamicImports: 0,
            scripts: [],
            configs: [],
            stringRefs: 0,
            testRefs: 0,
            framework: ctx.framework,
            dynamicRisk: "none",
          },
          scoreParts: parts,
        };
        candidates.push(c);
      }

      for (const def of exampleDefs) {
        if (seenKeys.has(def.key)) continue;
        seenKeys.add(def.key);
        if (PLATFORM_INJECTED.has(def.key)) continue;
        const used = ctx.envUsage.has(def.key);
        if (used) continue;
        if (ciDockerKeys.has(def.key)) continue;
        const positives: ScorePart[] = [
          { label: "Only present in .env.example", points: 25 },
          { label: "Referenced nowhere in source, scripts or configs", points: 40 },
          { label: "Not declared in CI or Docker", points: 10 },
        ];
        const { confidence, parts } = scoreConfidence({ positives, negatives: [] });
        const c: Candidate = {
          id: mkId("env_example_only", def.key),
          type: "env_example_only",
          name: def.key,
          key: def.key,
          confidence,
          category: categoryFor(confidence),
          recommendation:
            "Only documented in .env.example and referenced nowhere. Likely a stale documentation entry — verify before removing.",
          action: { kind: "keep" },
          evidence: {
            type: "env_example_only",
            imports: 0,
            importFiles: [def.file],
            requires: 0,
            dynamicImports: 0,
            scripts: [],
            configs: [],
            stringRefs: 0,
            testRefs: 0,
            framework: ctx.framework,
            dynamicRisk: "none",
          },
          scoreParts: parts,
        };
        candidates.push(c);
      }
    }

    // referenced but never defined — informational
    for (const [key, files] of ctx.envUsage) {
      if (ctx.envDefs.some((d) => d.key === key)) continue;
      if (PLATFORM_INJECTED.has(key)) continue;
      if (CLOUD_PLATFORM_PREFIXES.some((p) => key.startsWith(p))) continue;
      if (ciDockerKeys.has(key)) continue;
      if (/^script:/.test([...files][0] ?? "")) continue;
      if (files.size === 1 && [...files][0]?.includes("script:")) continue;
      infoMessages.push(
        `INFO env: ${key} is referenced (${files.size} location${files.size === 1 ? "" : "s"}) but never defined in .env* — likely provided at runtime.`,
      );
    }
  }

  /* ---------------- configuration files ---------------- */

  opts.onProgress?.("config", "Checking configuration files...");

  const toolNames = new Set<string>();
  for (const ws of ctx.workspaces) {
    for (const n of ws.dependencies.keys()) toolNames.add(n);
    for (const n of ws.devDependencies.keys()) toolNames.add(n);
  }

  for (const cfg of ctx.configFiles) {
    if (cfg.tool === "unknown") continue;
    if (cfg.tool === "typescript") continue; // tsconfig is required by editors
    if (cfg.tool === "next" || cfg.tool === "nuxt") continue; // framework configs are entries
    const scriptsUsing = scriptUsageOf(ctx, cfg.abs);
    if (scriptsUsing.length > 0) continue;
    const toolInstalled = toolNames.has(cfg.tool);
    const strings = await findStringReferences(ctx, cfg.abs);

    if (!toolInstalled) {
      // Tool absent: the config is dead weight unless referenced directly.
      if (strings.count > 0) continue;
      const positives: ScorePart[] = [
        { label: `Configures '${cfg.tool}' which is not installed`, points: 40 },
        { label: "Not referenced by any npm script", points: 15 },
      ];
      const { confidence, parts } = scoreConfidence({ positives, negatives: [] });
      const c: Candidate = {
        id: mkId("config_file", cfg.abs),
        type: "config_file",
        name: cfg.rel,
        key: cfg.abs,
        path: cfg.abs,
        confidence,
        category: categoryFor(confidence),
        recommendation:
          `Configures '${cfg.tool}', which is not a dependency of any package. Likely leftover from a removed tool.`,
        action: { kind: "delete" },
        evidence: {
          type: "config_file",
          imports: 0,
          importFiles: [],
          requires: 0,
          dynamicImports: 0,
          scripts: [],
          configs: [],
          stringRefs: strings.count,
          testRefs: 0,
          framework: ctx.framework,
          dynamicRisk: "none",
          lines: lineCount(ctx, cfg.abs),
        },
        scoreParts: parts,
      };
      candidates.push(c);
      continue;
    }

    if (cfg.legacy) {
      const positives: ScorePart[] = [
        { label: "Legacy config format superseded by a modern sibling", points: 45 },
        { label: "Tool is installed and reads the modern config", points: 25 },
      ];
      const { confidence, parts } = scoreConfidence({ positives, negatives: [] });
      const c: Candidate = {
        id: mkId("config_file", cfg.abs),
        type: "config_file",
        name: cfg.rel,
        key: cfg.abs,
        path: cfg.abs,
        confidence,
        category: categoryFor(confidence),
        recommendation:
          "This legacy config coexists with a modern flat config. npm-cleanup only flags this when the modern format is active.",
        action: { kind: "delete" },
        evidence: {
          type: "config_file",
          imports: 0,
          importFiles: [],
          requires: 0,
          dynamicImports: 0,
          scripts: [],
          configs: [],
          stringRefs: strings.count,
          testRefs: 0,
          framework: ctx.framework,
          dynamicRisk: "none",
          lines: lineCount(ctx, cfg.abs),
        },
        scoreParts: parts,
      };
      candidates.push(c);
    }
  }

  /* ---------------- test utilities ---------------- */

  for (const file of ctx.files) {
    if (file.kind !== "test") continue;
    if (!isTestUtility(file.rel)) continue;
    if (isReferencedPath(ctx, file.abs)) continue;
    if (file.generated) continue;
    if (isEntryOrVirtual(ctx, file.abs)) continue;
    const git = await collectGitEvidence(ctx.git, ctx.root, file.rel);
    const positives: ScorePart[] = [
      { label: "Test utility never imported by any test", points: 35 },
      { label: "Not referenced by scripts or configs", points: 15 },
    ];
    const negatives: ScorePart[] = [];
    if (!ctx.testFiles.has(file.abs)) {
      negatives.push({ label: "Lives in a conventionally discovered test location", points: -10 });
    }
    const { confidence, parts } = scoreConfidence({ positives, negatives });
    const c: Candidate = {
      id: mkId("test_util", file.abs),
      type: "test_util",
      name: file.rel,
      key: file.abs,
      path: file.abs,
      confidence,
      category: categoryFor(confidence),
      recommendation: "Test utility with zero references — safe to remove once no test imports it.",
      action: { kind: "delete" },
      evidence: {
        type: "test_util",
        imports: 0,
        importFiles: [],
        requires: 0,
        dynamicImports: 0,
        scripts: [],
        configs: [],
        stringRefs: 0,
        testRefs: 0,
        git,
        framework: ctx.framework,
        dynamicRisk: "none",
        lines: lineCount(ctx, file.abs),
      },
      scoreParts: parts,
    };
    candidates.push(c);
  }

  /* ---------------- warnings ---------------- */

  if (candidates.filter((c) => c.category === "SAFE_TO_REMOVE").length === 0) {
    infoMessages.push("No high-confidence candidates found — nothing meets the 90% safety bar.");
  }
  if (ctx.lock.lockKind === "none") {
    warnings.push("No supported lockfile found (package-lock.json / pnpm-lock.yaml / yarn.lock). Duplicate-version detection is limited.");
  }
  if (!ctx.git.available) {
    warnings.push("Git history not available — age-based evidence is missing and confidence scores may be lower.");
  }

  void fileCandidates;
  return { candidates, duplicates, warnings, infoMessages };
}

/* ---------------- helpers ---------------- */

function computeReachable(ctx: AnalyzerContext): Set<string> {
  const reachable = new Set<string>();
  const stack = [...ctx.entries];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    reachable.add(file);
    const node = ctx.graph.files.get(file);
    if (!node) continue;
    for (const ref of node.imports.values()) {
      if (ref.kind === "file" && ref.filePath) stack.push(ref.filePath);
    }
  }
  return reachable;
}

function isLibraryWorkspace(ctx: AnalyzerContext, fileAbs: string): boolean {
  const rel = relPosix(fileAbs, ctx.root);
  for (const ws of ctx.workspaces) {
    if (ws.name === "(root)") continue;
    // A file belongs to this workspace if its rel path starts with the
    // workspace dir name in relation to the root.
    const wsRel = relPosix(ws.dir, ctx.root);
    if (wsRel === ".") continue;
    if (!rel.startsWith(wsRel + "/")) continue;
    const privateField = ws.pkgJson["private"];
    const hasExports = ws.pkgJson["exports"] !== undefined;
    return privateField !== true && hasExports;
  }
  return false;
}

function templateImportRisk(ctx: AnalyzerContext, pkgName: string): DynamicRisk {
  for (const [, summary] of ctx.ast) {
    for (const ref of summary.imports) {
      if (ref.kind === "dynamic") {
        if (ref.specifier.includes("${")) return "medium";
        if (ref.specifier === pkgName) return "low";
      }
    }
  }
  return "none";
}

function dockerOrCiNpx(ctx: AnalyzerContext, pkgName: string): string | null {
  for (const file of ctx.files) {
    const base = path.basename(file.rel).toLowerCase();
    if (!base.startsWith("dockerfile") && !/^\.github\/workflows\//.test(file.rel) && file.rel !== ".gitlab-ci.yml") {
      continue;
    }
    const text = ctx.texts.get(file.abs) ?? "";
    const npxRe = /\b(?:npx|bunx|pnpm dlx)\s+["']?([^\s"'&;|]+)/g;
    let m: RegExpExecArray | null;
    while ((m = npxRe.exec(text)) !== null) {
      const cmd = m[1]!;
      if (cmd === pkgName || cmd.startsWith(pkgName + "@") || cmd.startsWith(pkgName + "/")) {
        return file.rel;
      }
    }
  }
  return null;
}

function hasReExportOf(ctx: AnalyzerContext, fileAbs: string, exportName: string): boolean {
  const node = ctx.graph.files.get(fileAbs);
  if (!node) return false;
  for (const importer of node.namespaceImporters) {
    const summary = summaryOf(ctx, importer);
    if (summary?.exports.some((e) => e.name === exportName)) return true;
  }
  return false;
}

function buildFileRecommendation(evidence: CandidateEvidence): string {
  const parts: string[] = [];
  parts.push("No usage was detected. nobody imports this file, references it in strings, or includes it from a script or config.");
  if (evidence.dynamicRisk === "medium" || evidence.dynamicRisk === "high") {
    parts.push("Dynamic access patterns exist in the project — verify before removing.");
  }
  if (evidence.pending) {
    parts.push("This file is not in git history (new or untracked).");
  }
  return parts.join(" ");
}