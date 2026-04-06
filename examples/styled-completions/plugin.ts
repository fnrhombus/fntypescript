import { definePlugin } from "fntypescript/define-plugin.js";
import type ts from "typescript/lib/tsserverlibrary";

const CSS_PROPERTIES: string[] = [
  "display", "color", "margin", "padding", "font-size",
  "background", "border", "width", "height", "position",
];

function isCursorInsideCssTemplate(
  ts: typeof import("typescript/lib/tsserverlibrary"),
  sourceFile: ts.SourceFile,
  position: number,
): boolean {
  let inside = false;

  function visit(node: ts.Node): void {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "css" &&
      position > node.template.getStart(sourceFile) &&
      position < node.template.getEnd()
    ) {
      inside = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return inside;
}

/**
 * Provides CSS property name completions when the cursor is inside a `css`
 * tagged template literal, merging them with any completions TypeScript
 * already provides.
 */
export default definePlugin({
  name: "styled-completions",

  getCompletionsAtPosition(ctx, prior, fileName, position, options) {
    const program = ctx.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    if (!isCursorInsideCssTemplate(ctx.typescript, sourceFile, position)) {
      return prior;
    }

    const cssEntries: ts.CompletionEntry[] = CSS_PROPERTIES.map((prop) => ({
      name: prop,
      kind: ctx.typescript.ScriptElementKind.memberVariableElement,
      kindModifiers: "",
      sortText: `0_${prop}`,
    }));

    if (!prior) {
      return {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        entries: cssEntries,
      };
    }

    return {
      ...prior,
      entries: [...cssEntries, ...prior.entries],
    };
  },
});
