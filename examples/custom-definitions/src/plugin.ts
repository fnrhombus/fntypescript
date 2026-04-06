import { definePlugin } from "fntypescript/define-plugin.js";
import type ts from "typescript";
import * as path from "path";
import * as fs from "fs";

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

    const targetFile = path.join(path.dirname(fileName), "handlers", `${handlerArg.text}.ts`);
    if (!fs.existsSync(targetFile)) return prior;

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
