/**
 * allow-function-decorators — fntypescript plugin + ts-patch transformer
 *
 * This file contains two complementary pieces that work together to allow
 * decorators on standalone function declarations in TypeScript:
 *
 *   1. A **Language Service plugin** (via fntypescript's `definePlugin`)
 *      that suppresses TS1206 errors in your editor. This runs inside
 *      tsserver — the process that powers IDE features like red squiggles,
 *      autocomplete, and hover info.
 *
 *   2. A **compiler transformer** (via ts-patch) that does two things
 *      at build time:
 *        a) Removes TS1206 diagnostics so `tspc` doesn't fail
 *        b) Rewrites the AST to strip decorator syntax and emit
 *           equivalent runtime code (e.g. `greet = log(greet)`)
 *
 * WHY TWO PIECES?
 *
 * TypeScript's architecture separates the Language Service (editor tooling)
 * from the Compiler (tsc/emit). They share the parser and type checker, but
 * plugins can only hook into the Language Service — there's no official
 * compiler plugin API. ts-patch fills that gap by monkey-patching tsc to
 * support transformer plugins.
 *
 * fntypescript handles the Language Service side. ts-patch handles the
 * compiler side. Together, they give you the full experience: no errors
 * in your editor AND working compiled output.
 *
 * HOW DECORATORS ON FUNCTIONS WORK UNDER THE HOOD
 *
 * TypeScript's parser already recognizes `@decorator function foo() {}`
 * and attaches the decorator to the FunctionDeclaration's `modifiers` array.
 * The AST is valid — the error is purely semantic (TS1206: "Decorators are
 * not valid here"). By suppressing that diagnostic and transforming the
 * output, we unlock something the parser already supports.
 */

import { definePlugin } from "fntypescript";
import type ts from "typescript";

// =====================================================================
// PART 1: Language Service Plugin (editor-time)
// =====================================================================
//
// This plugin is loaded by tsserver when your editor opens a project
// with `"plugins": [{ "name": "fntypescript" }]` in tsconfig.json.
//
// It intercepts diagnostic requests and filters out TS1206 errors
// that are attached to FunctionDeclaration nodes. Other TS1206 errors
// (e.g., decorators on `if` statements, which would be truly invalid)
// are left alone.
// =====================================================================

export const allowFunctionDecorators = definePlugin({
  name: "allow-function-decorators",

  /**
   * Filter semantic diagnostics.
   *
   * Semantic diagnostics come from the type checker. TS1206 sometimes
   * appears here depending on the TS version and `experimentalDecorators`
   * setting. We check the AST to confirm the diagnostic is on a
   * FunctionDeclaration before suppressing it.
   */
  getSemanticDiagnostics(ctx, prior, _fileName) {
    return prior.filter((d) => {
      // Keep all non-1206 diagnostics untouched
      if (d.code !== 1206) return true;

      // If we can't locate the source, keep the diagnostic (defensive)
      if (!d.file || d.start === undefined) return true;

      // Only suppress if the diagnostic is on a FunctionDeclaration
      return !findAncestor(ctx.typescript, d.file, d.start, ctx.typescript.SyntaxKind.FunctionDeclaration);
    });
  },

  /**
   * Filter syntactic diagnostics.
   *
   * Syntactic diagnostics come from the parser. TS1206 is almost always
   * reported here. We do a simpler filter since all TS1206 at the syntax
   * level are decorator-related.
   */
  getSyntacticDiagnostics(_ctx, prior, _fileName) {
    return prior.filter((d) => d.code !== 1206);
  },
});

// =====================================================================
// PART 2: Compiler Transformer (build-time, via ts-patch)
// =====================================================================
//
// This transformer runs during `tspc` (ts-patch's patched tsc).
// It's registered in tsconfig.json:
//
//   "plugins": [
//     { "transform": "./src/plugin.ts", "import": "transformer" }
//   ]
//
// ts-patch calls this function with the program, config, and an `extras`
// object that lets us manipulate diagnostics and access the TS instance.
//
// The transformer does two things:
//   1. Removes TS1206 diagnostics (so the build succeeds)
//   2. Rewrites the AST to apply decorators as runtime function calls
//
// Example transformation:
//
//   Input:
//     @log
//     @memoize
//     function greet(name: string) { return `Hello, ${name}!`; }
//
//   Output:
//     function greet(name) { return `Hello, ${name}!`; }
//     greet = memoize(log(greet));
//
// Decorators are applied inside-out (closest to function first),
// matching TC39/class decorator semantics.
// =====================================================================

export function transformer(
  _program: ts.Program,
  _config: Record<string, unknown>,
  extras: {
    ts: typeof ts;
    removeDiagnostic: (index: number) => void;
    diagnostics: readonly ts.Diagnostic[];
  },
) {
  // ── Step 1: Remove TS1206 diagnostics ──────────────────────────
  // Iterate backwards so removing an item doesn't shift later indices.
  for (let i = extras.diagnostics.length - 1; i >= 0; i--) {
    if (extras.diagnostics[i].code === 1206) {
      extras.removeDiagnostic(i);
    }
  }

  const tsInstance = extras.ts;
  const { factory } = tsInstance;

  // ── Step 2: AST transformation ─────────────────────────────────
  // We return a `TransformerBasePlugin` with a `before` transformer.
  // "before" means it runs before TypeScript's built-in transformers
  // (downlevel emit, module transforms, etc.).
  return {
    before: [
      (context: ts.TransformationContext): ts.Transformer<ts.SourceFile> => {
        return (sourceFile: ts.SourceFile): ts.SourceFile => {
          const newStatements: ts.Statement[] = [];

          for (const stmt of sourceFile.statements) {
            // Skip non-decorated or anonymous function declarations
            if (!tsInstance.isFunctionDeclaration(stmt) || !hasDecorators(tsInstance, stmt) || !stmt.name) {
              newStatements.push(stmt);
              continue;
            }

            // ── Separate decorators from other modifiers ─────────
            // Modifiers include things like `export`, `async`, `declare`,
            // AND decorators (in TS <5.0 they're all in `modifiers`;
            // in TS 5.0+ decorators moved but ts-patch normalizes this).
            const decorators = stmt.modifiers?.filter(
              (m): m is ts.Decorator => m.kind === tsInstance.SyntaxKind.Decorator,
            ) ?? [];
            const nonDecorators = stmt.modifiers?.filter(
              (m) => m.kind !== tsInstance.SyntaxKind.Decorator,
            );

            // ── Emit the clean function declaration ──────────────
            // Same function, just without the @ decorators.
            newStatements.push(
              context.factory.updateFunctionDeclaration(
                stmt,
                nonDecorators?.length ? nonDecorators : undefined,
                stmt.asteriskToken,
                stmt.name,
                stmt.typeParameters,
                stmt.parameters,
                stmt.type,
                stmt.body,
              ),
            );

            // ── Emit decorator application ───────────────────────
            // Build: fnName = d1(d2(d3(fnName)))
            //
            // For @log @memoize function greet() {}
            // decorators array is [log, memoize] (source order).
            // We apply inside-out: log first, then memoize wraps it.
            // Result: greet = memoize(log(greet))
            let expr: ts.Expression = factory.createIdentifier(stmt.name.text);
            for (const dec of decorators) {
              expr = factory.createCallExpression(dec.expression, undefined, [expr]);
            }
            newStatements.push(
              factory.createExpressionStatement(
                factory.createAssignment(
                  factory.createIdentifier(stmt.name.text),
                  expr,
                ),
              ),
            );
          }

          return factory.updateSourceFile(sourceFile, newStatements);
        };
      },
    ],
  };
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Check if a function declaration has any decorator modifiers.
 *
 * We use `(node as any).modifiers` because in TS 5.0+ the public API
 * moved decorators to `ts.getDecorators()`, but the internal AST node
 * still stores them in `modifiers` — and that's what we need for the
 * transformer to see them.
 */
function hasDecorators(tsInstance: typeof ts, node: ts.FunctionDeclaration): boolean {
  return !!(node as any).modifiers?.some((m: ts.ModifierLike) => m.kind === tsInstance.SyntaxKind.Decorator);
}

/**
 * Walk up from a character position in the source file to find an
 * ancestor node of the given SyntaxKind.
 *
 * Used by the Language Service plugin to confirm that a TS1206
 * diagnostic is attached to a FunctionDeclaration (and not some
 * other invalid decorator usage we shouldn't suppress).
 */
function findAncestor(
  tsInstance: typeof ts,
  sourceFile: ts.SourceFile,
  pos: number,
  kind: ts.SyntaxKind,
): ts.Node | undefined {
  // Find the deepest node at this position
  let current: ts.Node = sourceFile;
  tsInstance.forEachChild(sourceFile, function visit(node): void {
    if (node.pos <= pos && pos < node.end) {
      current = node;
      tsInstance.forEachChild(node, visit);
    }
  });
  // Walk up through parents looking for the target kind
  let node: ts.Node | undefined = current;
  while (node) {
    if (node.kind === kind) return node;
    node = node.parent;
  }
  return undefined;
}
