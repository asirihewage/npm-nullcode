import ts from "typescript";
import type { AstSummary, ExportRef, ImportRef } from "../../types/index.js";

const SCRIPT_KIND: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
};

export function parseSource(filePath: string, text: string): ts.SourceFile | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const scriptKind = SCRIPT_KIND[ext] ?? ts.ScriptKind.TS;
  try {
    return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
  } catch {
    return null;
  }
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isExportIdentifier(
  m: ts.ModifierLike | undefined,
): m is ts.ModifierLike {
  return (
    m !== undefined &&
    (m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

function collectNamedFromClause(
  clause: ts.NamedExportBindings | ts.NamedImports | ts.NamedExports | undefined,
  out: string[],
): void {
  if (!clause) return;
  if (ts.isNamespaceImport(clause) || ts.isNamespaceExport(clause)) {
    out.push("*");
    return;
  }
  for (const el of clause.elements) {
    out.push(el.name.text);
  }
}

/**
 * Extracts a summary of imports, exports, environment variable references,
 * JSX components and dynamic-import glob patterns from a single file.
 */
export function analyzeAst(filePath: string, text: string): AstSummary {
  const sourceFile = parseSource(filePath, text);
  const summary: AstSummary = {
    imports: [],
    exports: [],
    reexports: [],
    env: [],
    jsxComponents: [],
    globPatterns: [],
    hasJsx: false,
    hasJsxRuntimeUse: false,
  };
  if (!sourceFile) return summary;
  if (text.indexOf("@jsxRuntime") !== -1) summary.hasJsxRuntimeUse = true;

  const processEnvAccesses: ts.PropertyAccessExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec)) {
        const requested: string[] = [];
        collectNamedFromClause(node.importClause?.namedBindings, requested);
        if (node.importClause?.name) requested.push("default");
        const typeOnly = node.importClause?.isTypeOnly === true;
        if (node.importClause?.name && typeOnly) {
          requested.length = 0;
          requested.push("default");
        }
        summary.imports.push({
          specifier: spec.text,
          line: lineOf(sourceFile, node),
          kind: "import",
          requested,
          typeOnly,
        });
      }
      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        summary.reexports.push(node.moduleSpecifier.text);
        if (node.exportClause) {
          for (const el of node.exportClause.elements) {
            summary.exports.push({
              name: el.name.text,
              line: lineOf(sourceFile, el),
              kind: "value",
              isDefault: false,
            });
          }
        }
      } else if (node.exportClause) {
        for (const el of node.exportClause.elements) {
          summary.exports.push({
            name: el.name.text,
            line: lineOf(sourceFile, el),
            kind: node.isTypeOnly ? "type" : "value",
            isDefault: false,
          });
        }
      }
      return;
    }

    if (ts.isExportAssignment(node)) {
      // `export default <expr>`; if it has a name-bearing declaration, record it.
      const expr = node.expression;
      let name: string | undefined;
      if ((ts.isIdentifier(expr) || ts.isStringLiteral(expr)) && !node.isExportEquals) {
        name = "default";
      } else if (ts.isFunctionDeclaration(expr) || ts.isClassDeclaration(expr)) {
        name = expr.name?.text ?? "default";
      } else if (!node.isExportEquals) {
        name = "default";
      }
      if (name) {
        summary.exports.push({
          name,
          line: lineOf(sourceFile, node),
          kind: "value",
          isDefault: name === "default",
        });
      }
      return;
    }

    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      const exported = node.modifiers?.some(isExportIdentifier);
      if (exported && node.name) {
        summary.exports.push({
          name: node.name.text,
          line: lineOf(sourceFile, node),
          kind: "value",
          isDefault: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false,
        });
      }
      return;
    }

    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const isType = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          summary.exports.push({
            name: decl.name.text,
            line: lineOf(sourceFile, decl),
            kind: isType ? "type" : "value",
            isDefault: false,
          });
        }
      }
      return;
    }

    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      node.name
    ) {
      const kind = ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) ? "value" : "type";
      summary.exports.push({
        name: node.name.text,
        line: lineOf(sourceFile, node),
        kind,
        isDefault: false,
      });
      return;
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        summary.imports.push({
          specifier: arg.text,
          line: lineOf(sourceFile, node),
          kind: "require",
          requested: [],
          typeOnly: false,
        });
      }
      return;
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        summary.imports.push({
          specifier: arg.text,
          line: lineOf(sourceFile, node),
          kind: "dynamic",
          requested: [],
          typeOnly: false,
        });
      }
      return;
    }

    if (ts.isImportTypeNode(node) && node.argument && ts.isLiteralTypeNode(node.argument)) {
      const lit = node.argument.literal;
      if (ts.isStringLiteral(lit)) {
        summary.imports.push({
          specifier: lit.text,
          line: lineOf(sourceFile, node),
          kind: "dynamic",
          requested: [],
          typeOnly: true,
        });
      }
      return;
    }

    // import.meta.glob('...') / import.meta.globEager / globSync
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ["glob", "globEager", "globSync"].includes(node.expression.name.text)
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        summary.globPatterns.push(arg.text);
      }
      return;
    }

    // require.context(dir, recursive, regexp)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "context" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "require"
    ) {
      const dir = node.arguments[0];
      const rx = node.arguments[2];
      if (dir && ts.isStringLiteral(dir)) {
        const re = rx && ts.isRegularExpressionLiteral(rx) ? rx.text : ".*";
        summary.globPatterns.push(`${dir.text}/**/*${re}`);
      }
      return;
    }

    // new URL('./x', import.meta.url)
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments &&
      node.arguments.length >= 1
    ) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteral(first)) {
        summary.imports.push({
          specifier: first.text,
          line: lineOf(sourceFile, node),
          kind: "dynamic",
          requested: [],
          typeOnly: false,
        });
      }
      return;
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "env"
    ) {
      const base = node.expression.expression;
      if (
        (ts.isIdentifier(base) && base.text === "process") ||
        base.kind === ts.SyntaxKind.ImportKeyword
      ) {
        processEnvAccesses.push(node);
        return;
      }
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "env"
    ) {
      const base = node.expression.expression;
      if (ts.isIdentifier(base) && base.text === "process") {
        const arg = node.argumentExpression;
        if (arg && ts.isStringLiteral(arg)) {
          summary.env.push({ key: arg.text, line: lineOf(sourceFile, node) });
        }
        return;
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      summary.hasJsx = true;
      const tag = node.tagName;
      if (ts.isIdentifier(tag)) {
        const name = tag.text;
        if (/^[A-Z]/.test(name)) summary.jsxComponents.push(name);
      } else if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.name)) {
        summary.jsxComponents.push(tag.name.text);
      }
      return;
    }
  };

  ts.forEachChild(sourceFile, function walk(node) {
    visit(node);
    ts.forEachChild(node, walk);
  });

  for (const access of processEnvAccesses) {
    summary.env.push({
      key: access.name.text,
      line: lineOf(sourceFile, access),
    });
  }

  return summary;
}

/**
 * Best-effort analysis for non-TypeScript files (e.g. `.vue` SFCs).
 * Extracts `import`/`require` lines with a regex; used as a fallback so we
 * do not claim these files have zero imports.
 */
export function analyzeRegexFallback(filePath: string, text: string): AstSummary {
  const summary: AstSummary = {
    imports: [],
    exports: [],
    reexports: [],
    env: [],
    jsxComponents: [],
    globPatterns: [],
    hasJsx: false,
    hasJsxRuntimeUse: false,
  };
  const importRe =
    /^\s*import\s+(?:type\s+)?(?:([\w$*{},\s]+?)\s+from\s+)?["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[2];
    if (!spec) continue;
    const requested: string[] = [];
    const clause = (m[1] ?? "").trim();
    if (clause) {
      if (clause.includes("*")) requested.push("*");
      else {
        for (const part of clause.split(",")) {
          const t = part.trim();
          if (!t) continue;
          if (/(^|\s)as\s/ || t.startsWith("{")) {
            const inner = t.includes("{") ? t.slice(t.indexOf("{") + 1, t.lastIndexOf("}")) : t;
            for (const n of inner.split(",").map((s) => s.trim()).filter(Boolean)) {
              if (n.includes(" as ")) requested.push(n.split(" as ")[1]!.trim());
              else requested.push(n);
            }
          } else {
            requested.push("default");
          }
        }
      }
    }
    summary.imports.push({
      specifier: spec,
      line: summary.imports.length + 1,
      kind: "import",
      requested,
      typeOnly: false,
    });
  }
  const requireRe = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = requireRe.exec(text)) !== null) {
    summary.imports.push({
      specifier: m[1]!,
      line: summary.imports.length + 1,
      kind: "require",
      requested: [],
      typeOnly: false,
    });
  }
  const envRe = /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = envRe.exec(text)) !== null) {
    summary.env.push({ key: m[1]!, line: summary.env.length + 1 });
  }
  const jsxRe = /<([A-Z][A-Za-z0-9_.]*)\b/g;
  while ((m = jsxRe.exec(text)) !== null) {
    const comp = m[1]!;
    const last = comp.split(".").at(-1)!;
    if (last === "Fragment") continue;
    summary.jsxComponents.push(last);
    summary.hasJsx = true;
  }
  return summary;
}