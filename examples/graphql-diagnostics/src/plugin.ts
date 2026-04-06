import { definePlugin } from "fntypescript";
import type ts from "typescript";

/**
 * Reports a diagnostic for any `gql` tagged template literal whose
 * content is empty or contains only whitespace — a common mistake when
 * scaffolding GraphQL queries.
 */
export const graphqlDiagnostics = definePlugin({
  name: "graphql-diagnostics",

  getSemanticDiagnostics(ctx, prior, fileName) {
    const program = ctx.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    const { typescript: ts } = ctx;
    const extra: ts.Diagnostic[] = [];

    function visit(node: ts.Node): void {
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === "gql"
      ) {
        const templateText = ts.isNoSubstitutionTemplateLiteral(node.template)
          ? node.template.text
          : node.template.head.text;

        if (templateText.trim() === "") {
          extra.push({
            file: sourceFile,
            start: node.getStart(sourceFile),
            length: node.getWidth(sourceFile),
            messageText: "gql: query body is empty. Did you forget to write your GraphQL query?",
            category: ts.DiagnosticCategory.Error,
            code: 900001,
            source: "graphql-diagnostics",
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return [...prior, ...extra];
  },
});
