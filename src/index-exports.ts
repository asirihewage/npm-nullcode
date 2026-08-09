export { analyzeProject } from "./analyzer/index.js";
export { detectCandidates } from "./candidates/index.js";
export { buildCleanupPlan, persistPlan, persistScanResult } from "./cleanup/plan.js";
export { applyPlan, restoreBackup } from "./cleanup/apply.js";
export { renderTerminalReport, renderExplain } from "./reporters/terminal.js";
export { renderJsonReport } from "./reporters/json.js";
export { renderSarifReport } from "./reporters/sarif.js";
export { evaluateCi, renderCiReport } from "./reporters/ci.js";
export { createLogger, type Logger } from "./utils/logger.js";