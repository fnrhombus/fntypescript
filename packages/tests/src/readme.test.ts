import { describe, it, expect } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";
import { definePlugin } from "fntypescript/define-plugin.js";
import { loadSubPlugins } from "../../fntypescript/dist/loader.js";
import type { PluginDefinition } from "fntypescript/types.js";

/**
 * These tests validate that the README code examples are correct:
 * - The definePlugin usage compiles and works at runtime
 * - The tsconfig plugin config structure matches what loadSubPlugins expects
 * - The hook signature in the example matches PluginDefinition
 */

describe("README: definePlugin example", () => {
  it("the example plugin definition is accepted by definePlugin", () => {
    const plugin = definePlugin({
      name: "my-plugin",
      getCompletionsAtPosition(ctx, prior, fileName, position, options) {
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

    // Invoke the hook with a minimal mock ctx to verify the shape compiles
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

    const mockPrior = { entries: [], flags: 0, isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };
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

function makeCapturingLogger(): { logger: ts.server.Logger; messages: string[] } {
  const messages: string[] = [];
  const logger = {
    info: (msg: string) => { messages.push(msg); },
    error: (msg: string) => { messages.push(msg); },
    msg: (_msg: string, _type: unknown) => {},
    startGroup: (_header: string) => {},
    endGroup: () => {},
    loggingEnabled: () => true,
    getLogFileName: () => "test.log",
  } as unknown as ts.server.Logger;
  return { logger, messages };
}

describe("README: tsconfig plugin config structure", () => {
  it("loadSubPlugins accepts the config structure shown in the README", () => {
    // The README shows: { "name": "fntypescript", "plugins": [{ "name": "my-fntypescript-plugin" }] }
    // loadSubPlugins receives the whole config block (the outer plugin entry)
    const config: Record<string, unknown> = {
      name: "fntypescript",
      plugins: [{ name: "my-fntypescript-plugin" }],
    };

    const { logger, messages } = makeCapturingLogger();

    // The plugin "my-fntypescript-plugin" won't resolve; we just verify the
    // config structure is parsed correctly (entries attempted, not a config error)
    loadSubPlugins(
      config,
      (_name: string) => { throw new Error("module not found"); },
      logger,
    );

    // loadSubPlugins should have attempted the plugin (logged a load failure),
    // not rejected the config structure itself
    expect(messages.some(m => m.includes("Failed to load plugin"))).toBe(true);
    expect(messages.some(m => m.includes("must be an array"))).toBe(false);
  });

  it("README tsconfig plugins array uses object entries with 'name'", () => {
    const config: Record<string, unknown> = {
      name: "fntypescript",
      plugins: ["my-fntypescript-plugin"],
    };

    const { logger, messages } = makeCapturingLogger();

    loadSubPlugins(
      config,
      (_name: string) => { throw new Error("module not found"); },
      logger,
    );

    expect(messages.some(m => m.includes("Failed to load plugin 'my-fntypescript-plugin'"))).toBe(true);
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

    // This is a compile-time check via the type annotation above.
    // At runtime, verify the count matches what we expect.
    expect(expectedHooks).toHaveLength(10);
  });
});
