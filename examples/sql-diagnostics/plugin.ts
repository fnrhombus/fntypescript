import { definePlugin } from "fntypescript/define-plugin.js";
import type ts from "typescript/lib/tsserverlibrary";

const SQL_KEYWORDS = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "WITH", "EXPLAIN"];

/**
 * Reports a warning when a `sql` tagged template literal does not start with a
 * recognised SQL keyword. Catches typos and copy-paste errors before they become
 * runtime failures.
 */
export default definePlugin({
  name: "sql-diagnostics",

  getSemanticDiagnostics(ctx, prior, fileName) {
    const program = ctx.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    const ts = ctx.typescript;
    const extra: ts.Diagnostic[] = [];

    function visit(node: ts.Node): void {
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === "sql"
      ) {
        const templateText = ts.isNoSubstitutionTemplateLiteral(node.template)
          ? node.template.text
          : node.template.head.text;

        const trimmed = templateText.trimStart().toUpperCase();
        const startsWithKeyword = SQL_KEYWORDS.some((kw) => trimmed.startsWith(kw));

        if (trimmed && !startsWithKeyword) {
          extra.push({
            file: sourceFile,
            start: node.getStart(sourceFile),
            length: node.getWidth(sourceFile),
            messageText: `sql: query does not start with a recognised SQL keyword (${SQL_KEYWORDS.join(", ")}).`,
            category: ts.DiagnosticCategory.Warning,
            code: 900002,
            source: "sql-diagnostics",
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return [...prior, ...extra];
  },
});
