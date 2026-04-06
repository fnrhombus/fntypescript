import { definePlugin } from "fntypescript/define-plugin.js";

/**
 * Plugin that allows decorators on standalone function declarations
 * by suppressing TS1206 ("Decorators are not valid here.") when the
 * decorator is attached to a FunctionDeclaration node.
 *
 * The TypeScript parser already preserves the decorator in the AST —
 * it just flags it as an error. We remove that error.
 */
export const allowFunctionDecorators = definePlugin({
  name: "allow-function-decorators",

  getSemanticDiagnostics(ctx, prior, _fileName) {
    const ts = ctx.typescript;
    return prior.filter((d) => {
      if (d.code !== 1206) return true;
      if (!d.file || d.start === undefined) return true;
      const node = findAncestor(ts, d.file, d.start, ts.SyntaxKind.FunctionDeclaration);
      return !node;
    });
  },

  getSyntacticDiagnostics(ctx, prior, _fileName) {
    return prior.filter((d) => d.code !== 1206);
  },
});

/** Walk up from a position to find an ancestor of the given kind. */
function findAncestor(
  ts: typeof import("typescript/lib/tsserverlibrary"),
  sourceFile: import("typescript/lib/tsserverlibrary").SourceFile,
  pos: number,
  kind: import("typescript/lib/tsserverlibrary").SyntaxKind,
): import("typescript/lib/tsserverlibrary").Node | undefined {
  let node = findTokenAtPosition(ts, sourceFile, pos);
  while (node) {
    if (node.kind === kind) return node;
    node = node.parent;
  }
  return undefined;
}

function findTokenAtPosition(
  ts: typeof import("typescript/lib/tsserverlibrary"),
  sourceFile: import("typescript/lib/tsserverlibrary").SourceFile,
  pos: number,
): import("typescript/lib/tsserverlibrary").Node {
  let current: import("typescript/lib/tsserverlibrary").Node = sourceFile;
  ts.forEachChild(sourceFile, function visit(node): void {
    if (node.pos <= pos && pos < node.end) {
      current = node;
      ts.forEachChild(node, visit);
    }
  });
  return current;
}
