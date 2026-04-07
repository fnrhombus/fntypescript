import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { check } from "fntypescript/check.js";
import { definePlugin } from "fntypescript/define-plugin.js";

const FIXTURE_DIR = path.resolve(__dirname, "..", "fixtures", "check-project");
const TSCONFIG = path.join(FIXTURE_DIR, "tsconfig.json");
const TSCONFIG_WITH_ERRORS = path.join(FIXTURE_DIR, "tsconfig.with-errors.json");
const TSCONFIG_EMPTY = path.join(FIXTURE_DIR, "tsconfig.empty.json");
const TSCONFIG_MISSING = path.join(FIXTURE_DIR, "does-not-exist.json");

describe("check() — no errors, no plugins", () => {
  it("returns exitCode 0 when project has no type errors", () => {
    const result = check({ project: TSCONFIG });
    expect(result.exitCode).toBe(0);
  });

  it("returns empty diagnostics array when project has no type errors", () => {
    const result = check({ project: TSCONFIG });
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("check() — base TS errors, no plugins", () => {
  it("returns exitCode 1 when project has type errors", () => {
    const result = check({ project: TSCONFIG_WITH_ERRORS });
    expect(result.exitCode).toBe(1);
  });

  it("returns diagnostics when project has type errors", () => {
    const result = check({ project: TSCONFIG_WITH_ERRORS });
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("includes the expected TS2322 error code", () => {
    const result = check({ project: TSCONFIG_WITH_ERRORS });
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain(2322);
  });
});

describe("check() — plugin suppresses errors", () => {
  it("returns exitCode 0 when plugin removes all diagnostics", () => {
    const suppressAll = definePlugin({
      name: "suppress-all",
      getSemanticDiagnostics: (_ctx, _prior) => [],
    });
    const result = check({ project: TSCONFIG_WITH_ERRORS, plugins: [suppressAll] });
    expect(result.exitCode).toBe(0);
  });

  it("returns empty diagnostics when plugin clears them", () => {
    const suppressAll = definePlugin({
      name: "suppress-all",
      getSemanticDiagnostics: (_ctx, _prior) => [],
    });
    const result = check({ project: TSCONFIG_WITH_ERRORS, plugins: [suppressAll] });
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("check() — plugin adds diagnostics", () => {
  it("returns exitCode 1 when plugin injects a diagnostic into a clean project", () => {
    const injectError = definePlugin({
      name: "inject-error",
      getSemanticDiagnostics: (ctx, prior) => {
        const extraDiag = {
          messageText: "injected by plugin",
          category: 1 as const,
          code: 99999,
          file: undefined,
          start: undefined,
          length: undefined,
        };
        return [...prior, extraDiag];
      },
    });
    const result = check({ project: TSCONFIG, plugins: [injectError] });
    expect(result.exitCode).toBe(1);
  });

  it("includes plugin-injected diagnostics in the result", () => {
    const injectError = definePlugin({
      name: "inject-error",
      getSemanticDiagnostics: (_ctx, prior) => [
        ...prior,
        { messageText: "custom error", category: 1 as const, code: 99999, file: undefined, start: undefined, length: undefined },
      ],
    });
    const result = check({ project: TSCONFIG, plugins: [injectError] });
    const messages = result.diagnostics.map((d) =>
      typeof d.messageText === "string" ? d.messageText : d.messageText.messageText,
    );
    expect(messages).toContain("custom error");
  });
});

describe("check() — plugin hook throws", () => {
  it("preserves base diagnostics when plugin hook throws", () => {
    const crasher = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("hook exploded");
      },
    });
    const withoutPlugin = check({ project: TSCONFIG_WITH_ERRORS, plugins: [] });
    const withCrasher = check({ project: TSCONFIG_WITH_ERRORS, plugins: [crasher] });
    expect(withCrasher.diagnostics.length).toBe(withoutPlugin.diagnostics.length);
  });

  it("does not crash the check process when plugin hook throws", () => {
    const crasher = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("hook exploded");
      },
    });
    expect(() => check({ project: TSCONFIG, plugins: [crasher] })).not.toThrow();
  });
});

describe("check() — missing tsconfig", () => {
  it("throws an error when tsconfig does not exist", () => {
    expect(() => check({ project: TSCONFIG_MISSING })).toThrow();
  });
});

describe("check() — empty project", () => {
  it("returns exitCode 0 when no source files", () => {
    const result = check({ project: TSCONFIG_EMPTY });
    expect(result.exitCode).toBe(0);
  });

  it("returns empty diagnostics when no source files", () => {
    const result = check({ project: TSCONFIG_EMPTY });
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("check() — result shape", () => {
  it("returns an object with diagnostics array and numeric exitCode", () => {
    const result = check({ project: TSCONFIG });
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(typeof result.exitCode).toBe("number");
  });

  it("exitCode is 0 or 1", () => {
    const clean = check({ project: TSCONFIG });
    const errored = check({ project: TSCONFIG_WITH_ERRORS });
    expect([0, 1]).toContain(clean.exitCode);
    expect([0, 1]).toContain(errored.exitCode);
  });
});

describe("check() — hook context", () => {
  it("passes project: undefined in CLI context", () => {
    const received: (undefined | object)[] = [];
    const inspector = definePlugin({
      name: "ctx-inspector",
      getSemanticDiagnostics: (ctx, prior) => {
        received.push(ctx.project);
        return prior;
      },
    });
    check({ project: TSCONFIG, plugins: [inspector] });
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toBeUndefined();
  });

  it("passes correct fileName in hook context", () => {
    const receivedFileNames: string[] = [];
    const inspector = definePlugin({
      name: "ctx-inspector",
      getSemanticDiagnostics: (ctx, prior) => {
        receivedFileNames.push(ctx.fileName);
        return prior;
      },
    });
    check({ project: TSCONFIG, plugins: [inspector] });
    expect(receivedFileNames.length).toBeGreaterThan(0);
    expect(receivedFileNames[0]).toMatch(/valid\.ts$/);
  });
});
