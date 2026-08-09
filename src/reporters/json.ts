import type { ScanResult } from "../types/index.js";

export function renderJsonReport(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}