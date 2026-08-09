import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**", "node_modules/**", "dist/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    environment: "node"
  }
});