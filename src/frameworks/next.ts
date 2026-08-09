import type { AliasMap, FrameworkContext } from "../types/index.js";
import { absPath, BaseAdapter, fileAtRoot, hasDep, listDirFiles } from "./adapter.js";

export class NextAdapter extends BaseAdapter {
  override readonly name = "next" as const;

  override detect(ctx: FrameworkContext): number {
    let score = 0;
    if (hasDep(ctx, "next")) score += 40;
    if (fileAtRoot(ctx, "next.config.js") || fileAtRoot(ctx, "next.config.mjs") || fileAtRoot(ctx, "next.config.ts")) {
      score += 25;
    }
    if (listDirFiles(ctx, "app").length > 0) score += 20;
    if (listDirFiles(ctx, "pages").length > 0) score += 10;
    return score;
  }

  override entries(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    for (const rel of ctx.allFiles) {
      if (/^(app|pages)\/((?!\.)(?!\[\.\.\])[^/]+)+\/page\.(tsx|ts|jsx|js)$/.test(rel)) {
        const p = absPath(ctx, rel);
        if (p) out.push(p);
      }
      if (/^(app|pages)\/((?!\.)[^/]+)+\/(layout|middleware|not-found|error|loading|template|global-error|sitemap|robots|route)\.(tsx|ts|jsx|js)$/.test(rel)) {
        const p = absPath(ctx, rel);
        if (p) out.push(p);
      }
      if (/^(middleware|proxy|instrumentation)\.[jt]s$/.test(rel)) {
        const p = absPath(ctx, rel);
        if (p) out.push(p);
      }
    }
    return out;
  }

  override virtualFiles(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    for (const rel of ctx.allFiles) {
      const segments = rel.split("/");
      // Everything under app/ and pages/ is framework-managed: pages, layouts,
      // routes, middleware hooks and their co-located files. Never flagged.
      if (segments[0] === "app" || segments[0] === "pages") {
        const p = absPath(ctx, rel);
        if (p) out.push(p);
        continue;
      }
      if (/^(middleware|proxy|instrumentation)\.[jt]s$/.test(rel)) {
        const p = absPath(ctx, rel);
        if (p) out.push(p);
      }
    }
    return out;
  }

  override implicitPackages(ctx: FrameworkContext): string[] {
    const pkgs: string[] = [];
    if (hasDep(ctx, "next")) {
      pkgs.push("next");
    }
    // React is used implicitly by JSX in a Next app when not directly imported.
    if (listDirFiles(ctx, "app").length > 0 || listDirFiles(ctx, "pages").length > 0) {
      pkgs.push("react", "react-dom");
    }
    return pkgs;
  }

  override aliasMaps(): AliasMap[] {
    return [];
  }
}