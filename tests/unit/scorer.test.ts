import { describe, expect, it } from "vitest";
import { scoreConfidence, categoryFor } from "../../src/scoring/scorer.js";

describe("scoreConfidence", () => {
  it("combines evidence additively and caps at 99", () => {
    const { confidence } = scoreConfidence({
      positives: [
        { label: "a", points: 50 },
        { label: "b", points: 40 },
        { label: "c", points: 20 },
      ],
      negatives: [],
    });
    expect(confidence).toBe(99);
  });

  it("never returns 100", () => {
    const { confidence } = scoreConfidence({
      positives: [{ label: "all", points: 200 }],
      negatives: [],
    });
    expect(confidence).toBe(99);
  });

  it("never returns below 1", () => {
    const { confidence } = scoreConfidence({
      positives: [],
      negatives: [{ label: "nope", points: -300 }],
    });
    expect(confidence).toBe(1);
  });

  it("applies negative risk factors", () => {
    const { confidence } = scoreConfidence({
      positives: [{ label: "no imports", points: 50 }],
      negatives: [{ label: "dynamic import risk", points: -20 }],
    });
    expect(confidence).toBe(30);
  });

  it("applies AI adjustment within bounds", () => {
    const { confidence: down } = scoreConfidence({
      positives: [{ label: "p", points: 60 }],
      negatives: [],
      aiAdjustment: -30,
    });
    expect(down).toBe(35);
    const { confidence: up } = scoreConfidence({
      positives: [{ label: "p", points: 60 }],
      negatives: [],
      aiAdjustment: 30,
    });
    expect(up).toBe(69);
  });

  it("reports every contribution for transparency", () => {
    const { parts } = scoreConfidence({
      positives: [{ label: "evidence a", points: 40 }],
      negatives: [{ label: "risk b", points: -10 }],
    });
    expect(parts).toEqual([
      { label: "evidence a", points: 40 },
      { label: "risk b", points: -10 },
    ]);
  });
});

describe("categoryFor", () => {
  it("maps scores to categories with the configured thresholds", () => {
    expect(categoryFor(99)).toBe("SAFE_TO_REMOVE");
    expect(categoryFor(90)).toBe("SAFE_TO_REMOVE");
    expect(categoryFor(89)).toBe("LIKELY_UNUSED");
    expect(categoryFor(75)).toBe("LIKELY_UNUSED");
    expect(categoryFor(74)).toBe("REVIEW_REQUIRED");
    expect(categoryFor(60)).toBe("REVIEW_REQUIRED");
    expect(categoryFor(59)).toBe("PROBABLY_USED");
    expect(categoryFor(40)).toBe("PROBABLY_USED");
    expect(categoryFor(39)).toBe("USED");
    expect(categoryFor(1)).toBe("USED");
  });
});