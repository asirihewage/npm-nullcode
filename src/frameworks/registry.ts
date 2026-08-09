import type { FrameworkAdapter, FrameworkContext, FrameworkName } from "../types/index.js";
import { NextAdapter } from "./next.js";
import { AngularAdapter, NodeAdapter, ReactAdapter, ViteAdapter, VueAdapter, WebpackAdapter } from "./webpack-react.js";

const ALL_ADAPTERS: FrameworkAdapter[] = [
  new NextAdapter(),
  new ViteAdapter(),
  new WebpackAdapter(),
  new AngularAdapter(),
  new VueAdapter(),
  new ReactAdapter(),
  new NodeAdapter(),
];

export function detectFramework(ctx: FrameworkContext, prefer?: "auto" | FrameworkName): FrameworkName {
  if (prefer && prefer !== "auto") return prefer;

  let best: FrameworkAdapter = ALL_ADAPTERS[0]!;
  let bestScore = -1;
  for (const adapter of ALL_ADAPTERS) {
    const score = adapter.detect(ctx);
    if (score > bestScore) {
      bestScore = score;
      best = adapter;
    }
  }
  if (bestScore <= 0) {
    return "unknown";
  }
  return best.name;
}

export function adaptersFor(
  framework: FrameworkName,
): FrameworkAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.name === framework);
}

export function allAdapters(): FrameworkAdapter[] {
  return ALL_ADAPTERS;
}

export { ALL_ADAPTERS };