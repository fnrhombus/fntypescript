import { definePlugin } from "fntypescript/define-plugin.js";
import type ts from "typescript/lib/tsserverlibrary";

/**
 * Appends a documentation note to the hover tooltip for any symbol whose
 * inferred type name contains "Model". Useful for ORM authors (Prisma, Mongoose,
 * Sequelize) who want to surface schema-level context directly in the editor.
 */
export default definePlugin({
  name: "enhanced-hover",

  getQuickInfoAtPosition(ctx, prior, fileName, position) {
    if (!prior) return prior;

    // Check whether the displayed type contains "Model"
    const typeText = prior.displayParts?.map((p) => p.text).join("") ?? "";
    if (!typeText.includes("Model")) return prior;

    const note: ts.SymbolDisplayPart = {
      kind: "text",
      text: "\n\nThis type is a model. Refer to your schema definition for field constraints and relations.",
    };

    return {
      ...prior,
      documentation: [...(prior.documentation ?? []), note],
    };
  },
});
