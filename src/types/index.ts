export type FrameworkName =
  | "javascript"
  | "typescript"
  | "node"
  | "react"
  | "next"
  | "vite"
  | "webpack"
  | "angular"
  | "vue"
  | "express"
  | "nestjs"
  | "unknown";

export type CandidateType =
  | "dependency"
  | "devDependency"
  | "optionalDependency"
  | "dependency_dead_only"
  | "duplicate_dependency"
  | "source_file"
  | "unused_export"
  | "env_defined_unused"
  | "env_example_only"
  | "config_file"
  | "test_util"
  | "css_file"
  | "unused_script";

export type ConfidenceCategory =
  | "SAFE_TO_REMOVE"
  | "LIKELY_UNUSED"
  | "REVIEW_REQUIRED"
  | "PROBABLY_USED"
  | "USED";

export type DynamicRisk = "none" | "low" | "medium" | "high";

export interface ScorePart {
  label: string;
  points: number;
}

export interface GitEvidence {
  available: boolean;
  lastCommit?: string;
  commitCount?: number;
  monthsSinceLastChange: number | null;
  removedFromHistory?: boolean;
}

export interface CandidateEvidence {
  type: CandidateType;
  imports: number;
  importFiles: string[];
  requires: number;
  dynamicImports: number;
  scripts: string[];
  configs: string[];
  stringRefs: number;
  testRefs: number;
  git?: GitEvidence;
  framework: FrameworkName;
  dynamicRisk: DynamicRisk;
  deadOnly?: boolean;
  exported?: string[];
  importedByCount?: number;
  pending?: boolean;
  referencedBy?: string[];
  lines?: number;
}

export interface AiAssessment {
  used: boolean;
  provider?: string;
  model?: string;
  adjustment?: number;
  reasoning?: string;
  verdict?: string;
}

export interface Candidate {
  id: string;
  type: CandidateType;
  name: string;
  key: string;
  path?: string;
  packageName?: string;
  version?: string;
  dependencyType?: "dependencies" | "devDependencies" | "optionalDependencies";
  confidence: number;
  category: ConfidenceCategory;
  recommendation: string;
  action?: { kind: "uninstall" | "delete" | "edit" | "keep"; command?: string };
  evidence: CandidateEvidence;
  scoreParts: ScorePart[];
  ai?: AiAssessment;
}

export interface DuplicateInfo {
  package: string;
  detail: string;
  locations: string[];
}

export interface ScanStats {
  files: number;
  sourceFiles: number;
  dependencies: number;
  imports: number;
  configReferences: number;
  git: boolean;
}

export interface ScanResult {
  tool: string;
  version: string;
  rootDir: string;
  framework: FrameworkName;
  ai: { used: boolean; provider?: string; model?: string; refused?: string };
  stats: ScanStats;
  candidates: Candidate[];
  duplicates: DuplicateInfo[];
  warnings: string[];
  infoMessages: string[];
}

export interface ResolvedConfig {
  root: string;
  ignore: string[];
  threshold: number;
  framework: "auto" | FrameworkName;
  ai: boolean;
  enableCache: boolean;
  verbose: boolean;
  noColor: boolean;
  ciThreshold: number;
}

export interface ImportRef {
  specifier: string;
  line: number;
  kind: "import" | "require" | "dynamic";
  requested: string[];
  typeOnly: boolean;
}

export interface ExportRef {
  name: string;
  line: number;
  kind: "value" | "type";
  isDefault: boolean;
}

export interface EnvRef {
  key: string;
  line: number;
}

export interface AstSummary {
  imports: ImportRef[];
  exports: ExportRef[];
  reexports: string[];
  env: EnvRef[];
  jsxComponents: string[];
  globPatterns: string[];
  hasJsx: boolean;
  hasJsxRuntimeUse: boolean;
}

export interface ResolvedImport {
  kind: "file" | "package" | "builtin" | "alias" | "unresolved";
  filePath?: string;
  packageName?: string;
  specifier: string;
}

export interface FileUsage {
  importers: string[];
  dynamicImporters: string[];
  globMatched: string[];
  stringRefs: number;
  configRefs: string[];
  scriptRefs: string[];
}

export interface AliasMap {
  from: string;
  to: string;
  hasStar: boolean;
}

export interface FrameworkAdapter {
  name: FrameworkName;
  detect(ctx: FrameworkContext): number;
  entries(ctx: FrameworkContext): string[];
  virtualFiles(ctx: FrameworkContext): string[];
  implicitPackages(ctx: FrameworkContext): string[];
  aliasMaps(ctx: FrameworkContext): AliasMap[];
  description(): string;
}

export interface FrameworkContext {
  root: string;
  rootDir: string;
  workspaces: WorkspaceInfo[];
  allFiles: string[];
  pkgNames: Set<string>;
}

export interface WorkspaceInfo {
  dir: string;
  name: string;
  version?: string;
  pkgJson: Record<string, unknown>;
  dependencies: Map<string, string>;
  devDependencies: Map<string, string>;
  optionalDependencies: Map<string, string>;
}

export interface LockInfo {
  lockKind: "package-lock" | "pnpm-lock" | "yarn-lock" | "none";
  names: Map<string, string[]>;
}

export interface IndexedFile {
  abs: string;
  rel: string;
  ext: string;
  kind:
    | "source"
    | "test"
    | "config"
    | "env"
    | "css"
    | "html"
    | "json"
    | "doc"
    | "lock"
    | "other";
  lines: number;
  size: number;
  generated: boolean;
}

export interface EntryPoints {
  packageJsonMain: string[];
  scriptEntries: string[];
  frameworkEntries: string[];
  testEntries: string[];
  htmlEntries: string[];
}

export interface EnvDefinition {
  key: string;
  value: string;
  file: string;
  kind: "env-file" | "example" | "docker" | "ci";
}

export interface ConfigFileInfo {
  abs: string;
  rel: string;
  tool: string;
  auto: boolean;
  legacy: boolean;
}

export interface ScriptInfo {
  name: string;
  value: string;
  pkgUsage: Map<string, number>;
  fileUsage: Set<string>;
}

export interface DeepSeekEvidencePayload {
  candidate: string;
  type: CandidateType;
  references: Record<string, number>;
  imports: string[];
  imported_by: string[];
  exports: string[];
  string_references: string[];
  package_references: string[];
  git: Record<string, string | number | boolean | null | undefined>;
  framework: string;
  dynamic_import_risk: DynamicRisk;
  dead_only?: boolean;
  pending?: boolean;
}