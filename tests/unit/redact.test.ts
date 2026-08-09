import { describe, expect, it } from "vitest";
import { redactSecrets, containsSecretShape } from "../../src/utils/redact.js";

describe("secret redaction", () => {
  it("redacts API keys and bearer tokens", () => {
    const text = 'x = "sk-ant-1234567890abcdef" and Bearer eyJhbGciOiJIUzI1NiJ9';
    const out = redactSecrets(text);
    expect(out).not.toContain("sk-ant");
    expect(out).not.toContain("eyJhbGci");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts assignment-style secrets (password=...)", () => {
    const out = redactSecrets("DB_PASSWORD=supersecretvalue123");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("supersecretvalue123");
  });

  it("redacts PEM private keys", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const out = redactSecrets(pem);
    expect(out).not.toContain("MIIEpAIB");
    expect(out).not.toContain("BEGIN RSA");
  });

  it("keeps ordinary code untouched", () => {
    const code = 'import { foo } from "./bar";\nconst x = 42;';
    expect(redactSecrets(code)).toBe(code);
  });

  it("detects secret shapes", () => {
    expect(containsSecretShape("ghp_1234567890abcdefghijkl")).toBe(true);
    expect(containsSecretShape("const answer = 42")).toBe(false);
  });
});