import { definePlugin } from "fntypescript";
import type ts from "typescript";

const CSS_PROPERTIES = [
  "display", "color", "margin", "padding", "font-size",
  "background", "border", "width", "height", "position",
];

export const styledCompletions = definePlugin({
  name: "styled-completions",

  getCompletionsAtPosition(ctx, prior, fileName, position, _options, _formattingSettings) {
    const program = ctx.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    const { typescript: ts } = ctx;
    if (!isInsideCssTemplate(ts, sourceFile, position)) return prior;

    const cssEntries: ts.CompletionEntry[] = CSS_PROPERTIES.map((name) => ({
      name,
      kind: ts.ScriptElementKind.memberVariableElement,
      sortText: "0",
      kindModifiers: "",
    }));

    if (!prior) {
      return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries: cssEntries };
    }
    return { ...prior, entries: [...prior.entries, ...cssEntries] };
  },
});

function isInsideCssTemplate(
  ts: typeof import("typescript"),
  sourceFile: ts.SourceFile,
  position: number,
): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "css" &&
      node.template.pos <= position &&
      position <= node.template.end
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}
