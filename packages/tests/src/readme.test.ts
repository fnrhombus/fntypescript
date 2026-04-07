import { describe, it, expect } from "vitest";
import { definePlugin } from "fntypescript/define-plugin.js";
import type { PluginDefinition } from "fntypescript/types.js";

/**
 * These tests validate that the README code examples are correct
 * using only public API imports (those in the exports map).
 */

describe("README: definePlugin example", () => {
  it("the example plugin definition is accepted by definePlugin", () => {
    const plugin = definePlugin({
      name: "my-plugin",
      getCompletionsAtPosition(ctx, prior, _fileName, _position, _options) {
        // Add custom completions
        return prior;
      },
    });

    expect(plugin.name).toBe("my-plugin");
  });

  it("ctx parameter shape is available in hooks (typescript, logger, config)", () => {
    let capturedCtxKeys: string[] = [];

    const plugin = definePlugin({
      name: "ctx-shape-test",
      getCompletionsAtPosition(ctx, prior) {
        capturedCtxKeys = Object.keys(ctx);
        return prior;
      },
    });

    const mockCtx = {
      fileName: "test.ts",
      languageService: {} as never,
      typescript: {} as never,
      project: {} as never,
      config: { foo: "bar" } as Record<string, unknown>,
      logger: {
        info: (_msg: string) => {},
        error: (_msg: string) => {},
      },
    };

    const mockPrior = {
      entries: [],
      flags: 0,
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
    };
    plugin.definition.getCompletionsAtPosition!(
      mockCtx,
      mockPrior as never,
      "test.ts",
      0,
      undefined,
    );

    expect(capturedCtxKeys).toContain("logger");
    expect(capturedCtxKeys).toContain("typescript");
    expect(capturedCtxKeys).toContain("config");
  });
});

describe("README: PluginDefinition hook names", () => {
  it("all hooks listed in the README are present in PluginDefinition", () => {
    const expectedHooks: Array<keyof PluginDefinition> = [
      "getSemanticDiagnostics",
      "getSyntacticDiagnostics",
      "getSuggestionDiagnostics",
      "getCompletionsAtPosition",
      "getCompletionEntryDetails",
      "getQuickInfoAtPosition",
      "getDefinitionAtPosition",
      "getDefinitionAndBoundSpan",
      "getSignatureHelpItems",
      "getCodeFixesAtPosition",
    ];

    expect(expectedHooks).toHaveLength(10);
  });
});
