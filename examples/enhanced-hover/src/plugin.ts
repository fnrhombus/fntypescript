import { definePlugin } from "fntypescript/define-plugin.js";
import type ts from "typescript";

/**
 * Augments hover documentation for symbols whose display text contains
 * "Model". Appends a note pointing users toward the framework's model
 * documentation, without discarding any existing hover information.
 */
export const enhancedHover = definePlugin({
  name: "enhanced-hover",

  getQuickInfoAtPosition(ctx, prior, _fileName, _position) {
    if (!prior) return prior;

    const displayText = prior.displayParts?.map((p) => p.text).join("") ?? "";
    if (!displayText.includes("Model")) return prior;

    const { typescript: ts } = ctx;

    const modelNote: ts.SymbolDisplayPart = {
      kind: "text",
      text: "\n\n**Model** — This type participates in the data model. See the framework docs for field definitions, relations, and query builder usage.",
    };

    const existingDocs = prior.documentation ?? [];

    return {
      ...prior,
      documentation: [...existingDocs, modelNote],
    };
  },
});
