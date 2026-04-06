import { definePlugin } from "fntypescript/define-plugin.js";
import type ts from "typescript/lib/tsserverlibrary";

/**
 * Augments go-to-definition for `handler("name")` call expressions.
 * When the cursor is on a string literal that is the first argument to a
 * function named `handler`, this plugin adds a DefinitionInfo pointing to
 * `handlers/<name>.ts` relative to the source file.
 *
 * Inspired by how tRPC and Hono route registries let you navigate from a
 * handler name string directly to the handler implementation.
 */
export default definePlugin({
  name: "custom-definitions",

  getDefinitionAndBoundSpan(ctx, prior, fileName, position) {
    const program = ctx.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    const ts = ctx.typescript;
    const handlerArg = findHandlerStringArg(ts, sourceFile, position);
    if (!handlerArg) return prior;

    const handlerName = handlerArg.text;
    const dirName = fileName.replace(/[/\\][^/\\]+$/, "");
    const targetFile = `${dirName}/handlers/${handlerName}.ts`;

    // Only add the definition if the handler file exists in the program
    if (!program.getSourceFile(targetFile)) return prior;

    const customDefinition: ts.DefinitionInfo = {
      fileName: targetFile,
      textSpan: { start: 0, length: 0 },
      kind: ts.ScriptElementKind.moduleElement,
      name: handlerName,
      containerKind: ts.ScriptElementKind.unknown,
      containerName: "",
    };

    const existingDefinitions = prior?.definitions ?? [];

    return {
      textSpan: prior?.textSpan ?? {
        start: handlerArg.getStart(sourceFile) + 1, // +1 to skip opening quote
        length: handlerName.length,
      },
      definitions: [...existingDefinitions, customDefinition],
    };
  },
});

/**
 * Finds a string literal at `position` that is the first argument of a call
 * expression where the callee is an identifier named `handler`.
 */
function findHandlerStringArg(
  ts: typeof import("typescript/lib/tsserverlibrary"),
  sourceFile: ts.SourceFile,
  position: number,
): ts.StringLiteral | undefined {
  let result: ts.StringLiteral | undefined;

  function visit(node: ts.Node): void {
    if (result) return;

    if (
      ts.isStringLiteral(node) &&
      node.getStart(sourceFile) <= position &&
      position <= node.getEnd()
    ) {
      const parent = node.parent;
      if (
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === "handler" &&
        parent.arguments[0] === node
      ) {
        result = node;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}
