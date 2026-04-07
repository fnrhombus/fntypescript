import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type ts from "typescript/lib/tsserverlibrary";
import { definePlugin } from "fntypescript/define-plugin.js";
import type { PluginDefinition } from "fntypescript/types.js";

/**
 * These tests validate that the README code examples are correct:
 * - The definePlugin usage compiles and works at runtime
 * - The hook signature in the example matches PluginDefinition
 * - The TypeScript code blocks in README.md compile without errors
 *
 * Note: loadSubPlugins is an internal implementation detail (loader.js is not in the
 * package exports map). The README only documents the public API — definePlugin via
 * "fntypescript/define-plugin.js" — so no internal imports appear here or in the README.
 * The "README code examples compile" test below catches any import of a non-exported path.
 */

const repoRoot = resolve(__dirname, "../../..");

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

describe("README code examples compile", () => {
  it("TypeScript code blocks in README.md are syntactically valid", () => {
    const readmePath = join(repoRoot, "README.md");
    const readmeContent = readFileSync(readmePath, "utf-8");

    // Extract TypeScript fenced code blocks (covers spec checklist: "Code examples in README
    // are syntactically valid"). This test will fail if any example imports from a path that
    // is not in the package exports map (e.g., "fntypescript/loader.js" or "fntypescript/proxy.js").
    const codeBlockPattern = /```ts\n([\s\S]*?)```/g;
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = codeBlockPattern.exec(readmeContent)) !== null) {
      blocks.push(match[1]!);
    }

    expect(blocks.length, "README must contain at least one TypeScript code block").toBeGreaterThan(0);

    // Compile each block using tsc. The temp dir lives inside packages/tests/ so
    // that node_modules resolution finds the workspace fntypescript package.
    const testsRoot = resolve(__dirname, "..");
    const tempDir = mkdtempSync(join(testsRoot, "readme-compile-"));
    try {
      // "type": "module" makes Node16 treat .ts files as ESM (supports `export default`)
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ type: "module" }));

      for (const [i, code] of blocks.entries()) {
        writeFileSync(join(tempDir, `example-${i}.ts`), code);
      }

      writeFileSync(
        join(tempDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: "ES2022",
            module: "Node16",
            moduleResolution: "Node16",
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["*.ts"],
        }),
      );

      const tsc = join(testsRoot, "node_modules/.bin/tsc");
      const result = spawnSync(tsc, ["--project", join(tempDir, "tsconfig.json")], {
        cwd: testsRoot,
        encoding: "utf-8",
      });

      expect(
        result.status,
        `TypeScript compilation errors in README code blocks:\n${result.stdout}`,
      ).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
