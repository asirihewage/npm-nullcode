import type { AliasMap, FrameworkContext } from "../types/index.js";
import { absPath, BaseAdapter, fileAtRoot, hasDep } from "./adapter.js";

export class ReactAdapter extends BaseAdapter {
  override readonly name = "react" as const;

  override detect(ctx: FrameworkContext): number {
    let score = 0;
    if (hasDep(ctx, "react") || hasDep(ctx, "react-dom")) {
      score += 30;
      if (ctx.allFiles.some((f) => /\.(tsx|jsx)$/.test(f))) score += 15;
    }
    return score;
  }

  override entries(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    for (const name of ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx", "src/App.tsx", "src/App.jsx"]) {
      const p = absPath(ctx, name);
      if (p) out.push(p);
    }
    return out;
  }

  override virtualFiles(): string[] {
    return [];
  }

  override implicitPackages(ctx: FrameworkContext): string[] {
    const pkgs: string[] = [];
    if (hasDep(ctx, "react")) pkgs.push("react");
    if (hasDep(ctx, "react-dom")) pkgs.push("react-dom");
    if (hasDep(ctx, "@types/react")) pkgs.push("@types/react");
    if (hasDep(ctx, "@types/react-dom")) pkgs.push("@types/react-dom");
    return pkgs;
  }

  override aliasMaps(): AliasMap[] {
    return [];
  }
}

export class ViteAdapter extends BaseAdapter {
  override readonly name = "vite" as const;

  override detect(ctx: FrameworkContext): number {
    let score = 0;
    if (hasDep(ctx, "vite")) score += 40;
    if (ctx.allFiles.some((f) => /^(vite|vitest)\.config\.[a-z]+$/.test(f))) score += 25;
    if (fileAtRoot(ctx, "index.html")) score += 10;
    return score;
  }

  override entries(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    const html = absPath(ctx, "index.html");
    if (html) out.push(html);
    for (const name of ["src/main.ts", "src/main.tsx", "src/main.js", "src/main.jsx", "src/index.ts", "src/index.js"]) {
      const p = absPath(ctx, name);
      if (p) out.push(p);
    }
    return out;
  }

  override virtualFiles(): string[] {
    return [];
  }

  override implicitPackages(ctx: FrameworkContext): string[] {
    if (hasDep(ctx, "vite")) return ["vite", "vite/client"];
    return [];
  }

  override aliasMaps(): AliasMap[] {
    return [];
  }
}

export class WebpackAdapter extends BaseAdapter {
  override readonly name = "webpack" as const;

  override detect(ctx: FrameworkContext): number {
    let score = 0;
    if (hasDep(ctx, "webpack")) score += 40;
    if (ctx.allFiles.some((f) => /^webpack\.config\.[a-z]+$/.test(f))) score += 20;
    // Object-based config via package.json or babel-free setups
    if (hasDep(ctx, "@babel/core")) score += 5;
    return score;
  }

  override entries(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    for (const name of ["src/index.ts", "src/index.js", "src/main.ts", "src/main.js"]) {
      const p = absPath(ctx, name);
      if (p) out.push(p);
    }
    return out;
  }

  override virtualFiles(): string[] {
    return [];
  }

  override implicitPackages(ctx: FrameworkContext): string[] {
    if (hasDep(ctx, "webpack")) return ["webpack"];
    return [];
  }

  override aliasMaps(): AliasMap[] {
    return [];
  }
}

export class AngularAdapter extends BaseAdapter {
  override readonly name = "angular" as const;

  override detect(ctx: FrameworkContext): number {
    let score = 0;
    if (hasDep(ctx, "@angular/core") || hasDep(ctx, "@angular/cli")) score += 40;
    if (fileAtRoot(ctx, "angular.json")) score += 15;
    if (ctx.allFiles.some((f) => /^src\/main\.ts$/.test(f)) && ctx.allFiles.some((f) => /\.component\.ts$/.test(f))) score += 10;
    return score;
  }

  override entries(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    for (const name of ["src/main.ts", "src/polyfills.ts", "src/polyfills.js"]) {
      const p = absPath(ctx, name);
      if (p) out.push(p);
    }
    return out;
  }

  override virtualFiles(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    for (const rel of ctx.allFiles) {
      if (/\.(component|module|service|directive|pipe|guard|interceptor|resolver)\.ts$/.test(rel)) {
        const p = absPath(ctx, rel);
        if (p) out.push(p);
      }
    }
    return out;
  }

  override implicitPackages(ctx: FrameworkContext): string[] {
    const pkgs: string[] = [];
    if (hasDep(ctx, "@angular/core")) {
      for (const p of ctx.pkgNames) {
        if (p.startsWith("@angular/")) pkgs.push(p);
      }
      pkgs.push("rxjs", "zone.js", "tslib");
    }
    if (hasDep(ctx, "@angular/cli")) pkgs.push("@angular/cli");
    return pkgs;
  }

  override aliasMaps(): AliasMap[] {
    return [];
  }
}

export class VueAdapter extends BaseAdapter {
  override readonly name = "vue" as const;

  override detect(ctx: FrameworkContext): number {
    let score = 0;
    if (hasDep(ctx, "vue")) score += 30;
    if (ctx.allFiles.some((f) => f.endsWith(".vue"))) score += 25;
    if (fileAtRoot(ctx, "vite.config.ts") || fileAtRoot(ctx, "vite.config.js")) score += 5;
    return score;
  }

  override entries(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    const html = absPath(ctx, "index.html");
    if (html) out.push(html);
    for (const name of ["src/main.ts", "src/main.js"]) {
      const p = absPath(ctx, name);
      if (p) out.push(p);
    }
    return out;
  }

  override virtualFiles(): string[] {
    return [];
  }

  override implicitPackages(ctx: FrameworkContext): string[] {
    const pkgs: string[] = [];
    if (hasDep(ctx, "vue")) pkgs.push("vue");
    for (const p of ctx.pkgNames) {
      if (p === "@vue/runtime-core" || p === "@vue/runtime-dom" || p === "@vue/compiler-sfc" || p === "@vue/compiler-core") pkgs.push(p);
    }
    return pkgs;
  }

  override aliasMaps(): AliasMap[] {
    return [];
  }
}

export class NodeAdapter extends BaseAdapter {
  override readonly name = "node" as const;

  override detect(ctx: FrameworkContext): number {
    let score = 5;
    if (hasDep(ctx, "express")) score += 40;
    if (hasDep(ctx, "@nestjs/core") || hasDep(ctx, "@nestjs/common")) score += 40;
    if (hasDep(ctx, "fastify")) score += 15;
    if (ctx.allFiles.some((f) => /^src\/(index|main|server|app)\.(ts|js)$/.test(f))) score += 10;
    return score;
  }

  override entries(ctx: FrameworkContext): string[] {
    const out: string[] = [];
    for (const name of ["src/main.ts", "src/index.ts", "src/server.ts", "src/app.ts", "src/main.js", "src/index.js", "src/server.js", "src/app.js"]) {
      const p = absPath(ctx, name);
      if (p) out.push(p);
    }
    return out;
  }

  override virtualFiles(ctx: FrameworkContext): string[] {
    // NestJS keeps decorator-driven modules that are wired via imports; no
    // implicit registration to protect here beyond the conventional entries.
    const out: string[] = [];
    for (const rel of ctx.allFiles) {
      if (hasDep(ctx, "@nestjs/core") && /\.module\.ts$/.test(rel)) {
        const p = absPath(ctx, rel);
        if (p) out.push(p);
      }
    }
    return out;
  }

  override implicitPackages(ctx: FrameworkContext): string[] {
    const pkgs: string[] = [];
    if (hasDep(ctx, "express")) pkgs.push("express");
    if (hasDep(ctx, "@nestjs/core")) {
      for (const p of ctx.pkgNames) {
        if (p.startsWith("@nestjs/")) pkgs.push(p);
      }
      pkgs.push("reflect-metadata", "rxjs");
    }
    return pkgs;
  }

  override aliasMaps(): AliasMap[] {
    return [];
  }
}