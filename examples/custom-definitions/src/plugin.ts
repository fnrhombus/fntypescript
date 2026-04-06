import { definePlugin } from "fntypescript";
import type ts from "typescript";

export const customDefinitions = definePlugin({
  name: "custom-definitions",

  getDefinitionAndBoundSpan(ctx, prior, fileName, position) {
    const program = ctx.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    const { typescript: ts } = ctx;
    const handlerArg = findHandlerStringAtPosition(ts, sourceFile, position);
    if (!handlerArg) return prior;

    const dir = fileName.substring(0, fileName.lastIndexOf("/"));
    const targetFile = dir + "/handlers/" + handlerArg.text + ".ts";
    if (!program.getSourceFile(targetFile)) return prior;

    const definition: ts.DefinitionInfo = {
      fileName: targetFile,
      textSpan: { start: 0, length: 0 },
      name: handlerArg.text,
      kind: ts.ScriptElementKind.moduleElement,
      containerName: "handlers",
      containerKind: ts.ScriptElementKind.moduleElement,
    };
    const textSpan: ts.TextSpan = {
      start: handlerArg.getStart(sourceFile),
      length: handlerArg.getWidth(sourceFile),
    };

    if (!prior) return { definitions: [definition], textSpan };
    return { ...prior, definitions: [...(prior.definitions ?? []), definition], textSpan };
  },
});

function findHandlerStringAtPosition(
  ts: typeof import("typescript"),
  sourceFile: ts.SourceFile,
  position: number,
): ts.StringLiteral | undefined {
  let result: ts.StringLiteral | undefined;
  function visit(node: ts.Node): void {
    if (result) return;
    if (
      ts.isStringLiteral(node) &&
      node.pos <= position &&
      position <= node.end &&
      ts.isCallExpression(node.parent) &&
      ts.isIdentifier(node.parent.expression) &&
      node.parent.expression.text === "handler" &&
      node.parent.arguments[0] === node
    ) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return result;
}
