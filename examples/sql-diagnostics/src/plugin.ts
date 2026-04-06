import { definePlugin } from "fntypescript";
import type ts from "typescript";

const SQL_KEYWORDS = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER"];

/**
 * Reports a warning when a `sql` tagged template literal doesn't start
 * with a recognized SQL keyword. Catches typos and misplaced strings
 * before they reach the database.
 */
export const sqlDiagnostics = definePlugin({
  name: "sql-diagnostics",

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
        node.tag.text === "sql"
      ) {
        const templateText = ts.isNoSubstitutionTemplateLiteral(node.template)
          ? node.template.text
          : node.template.head.text;

        const trimmed = templateText.trim();
        const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase() ?? "";
        if (trimmed && !SQL_KEYWORDS.includes(firstWord)) {
          extra.push({
            file: sourceFile,
            start: node.getStart(sourceFile),
            length: node.getWidth(sourceFile),
            messageText: `sql: query does not start with a known SQL keyword (${SQL_KEYWORDS.join(", ")}).`,
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
