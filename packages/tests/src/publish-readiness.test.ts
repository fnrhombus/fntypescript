import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const README_PATH = resolve(__dirname, "../../../README.md");
// Run module resolution relative to packages/tests so workspace deps are found
const TESTS_PKG_ROOT = resolve(__dirname, "..");

/**
 * Extracts fenced TypeScript code blocks (```ts ... ```) from a markdown string.
 */
function extractTsCodeBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /^```ts\r?\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Compiles a TypeScript code snippet and returns any error diagnostics.
 * Uses a virtual filename in TESTS_PKG_ROOT/src so module resolution finds
 * workspace dependencies (e.g. fntypescript) via packages/tests/node_modules.
 */
function compileSnippet(code: string, blockIndex: number): ts.Diagnostic[] {
  const virtualPath = resolve(TESTS_PKG_ROOT, "src", `_readme-block-${blockIndex}.ts`);

  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    skipLibCheck: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => TESTS_PKG_ROOT;

  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (name === virtualPath) {
      return ts.createSourceFile(name, code, languageVersion);
    }
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = (name) => {
    if (name === virtualPath) return true;
    return originalFileExists(name);
  };

  const originalReadFile = host.readFile.bind(host);
  host.readFile = (name) => {
    if (name === virtualPath) return code;
    return originalReadFile(name);
  };

  const program = ts.createProgram([virtualPath], options, host);
  const sourceFile = program.getSourceFile(virtualPath);

  return [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ].filter((d) => d.category === ts.DiagnosticCategory.Error);
}

describe("README TypeScript code blocks", () => {
  const readme = readFileSync(README_PATH, "utf-8");
  const blocks = extractTsCodeBlocks(readme);

  it("README has at least one TypeScript code block", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  blocks.forEach((block, i) => {
    it(`code block ${i + 1} compiles without errors`, () => {
      const errors = compileSnippet(block, i);
      const messages = errors.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      );
      expect(messages).toEqual([]);
    });
  });
});
