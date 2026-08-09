import type { Candidate, ScanResult } from "../types/index.js";

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId?: string };
      region?: { startLine?: number };
    };
  }>;
  properties?: Record<string, unknown>;
}

export function renderSarifReport(result: ScanResult, rootDir: string): object {
  const rules = new Map<string, { id: string; shortDescription: { text: string }; fullDescription: { text: string }; properties: Record<string, unknown> }>();
  const results: SarifResult[] = [];

  for (const c of result.candidates) {
    const ruleId = `nullcode/${c.type}`;
    if (!rules.has(ruleId)) {
      rules.set(ruleId, {
        id: ruleId,
        shortDescription: { text: c.type.replace(/_/g, " ") },
        fullDescription: { text: c.recommendation },
        properties: { tags: ["cleanup", c.type] },
      });
    }
    const level: SarifResult["level"] =
      c.category === "SAFE_TO_REMOVE" ? "error" : c.category === "LIKELY_UNUSED" ? "warning" : "note";
    const locs: SarifResult["locations"] = [];
    if (c.path) {
      const rel = c.path.replace(/\\/g, "/");
      const uri = rel.startsWith(rootDir) ? rel.slice(rootDir.length).replace(/^\//, "") : rel;
      locs.push({
        physicalLocation: {
          artifactLocation: { uri, uriBaseId: "%SRCROOT%" },
          region: { startLine: 1 },
        },
      });
    }
    results.push({
      ruleId,
      level,
      message: {
        text: `${c.name} — confidence ${c.confidence}% (${c.category}). ${c.recommendation}`,
      },
      ...(locs.length > 0 ? { locations: locs } : {}),
      properties: {
        confidence: c.confidence,
        category: c.category,
        type: c.type,
        scoreParts: c.scoreParts,
        evidence: {
          imports: c.evidence.imports,
          requires: c.evidence.requires,
          dynamicImports: c.evidence.dynamicImports,
          scripts: c.evidence.scripts.length,
          configs: c.evidence.configs.length,
        },
      },
    });
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "nullcode",
            semanticVersion: result.version,
            informationUri: "https://github.com/anomalyco/nullcode",
            rules: [...rules.values()],
          },
        },
        results,
        properties: {
          framework: result.framework,
          stats: result.stats,
        },
      },
    ],
  };
}

export type { Candidate as _SarifCandidate };