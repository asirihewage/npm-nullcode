import { createHash } from "node:crypto";

export function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function contentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}