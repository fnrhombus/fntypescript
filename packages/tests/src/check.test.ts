import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { check } from "fntypescript/check.js";
import { definePlugin } from "fntypescript/define-plugin.js";
import type { HookContext } from "fntypescript/types.js";
import type ts from "typescript/lib/tsserverlibrary";

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/check-project");
const TSCONFIG = path.join(FIXTURE_DIR, "tsconfig.json");
const TSCONFIG_ALT = path.join(FIXTURE_DIR, "tsconfig.alt.json");
const TSCONFIG_EMPTY = path.join(FIXTURE_DIR, "tsconfig.empty.json");

// ── Programmatic API shape ────────────────────────────────────────────────────

describe("check() — return shape", () => {
  it("returns an object with diagnostics array and exitCode", () => {
    const result = check({ project: TSCONFIG, plugins: [] });
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("exitCode");
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});

// ── No-plugin baseline ────────────────────────────────────────────────────────

describe("check() — no plugins", () => {
  it("returns exitCode 0 when the project has no errors", () => {
    const result = check({ project: TSCONFIG_ALT, plugins: [] });
    const errors = result.diagnostics.filter((d) => d.category === 1); // Error
    expect(errors).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode 1 when the project has type errors", () => {
    const result = check({ project: TSCONFIG, plugins: [] });
    expect(result.exitCode).toBe(1);
  });

  it("includes the diagnostic in the returned array when there are errors", () => {
    const result = check({ project: TSCONFIG, plugins: [] });
    const errors = result.diagnostics.filter((d) => d.category === 1);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── Empty project ─────────────────────────────────────────────────────────────

describe("check() — empty project", () => {
  it("returns exitCode 0 for a project with no source files", () => {
    const result = check({ project: TSCONFIG_EMPTY, plugins: [] });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ── Plugin hooks ──────────────────────────────────────────────────────────────

describe("check() — plugin suppression", () => {
  it("plugin can suppress errors by returning empty diagnostics array", () => {
    const suppressor = definePlugin({
      name: "suppressor",
      getSemanticDiagnostics: (_ctx: HookContext, _prior: ts.Diagnostic[]) => [],
      getSyntacticDiagnostics: (_ctx: HookContext, _prior: ts.DiagnosticWithLocation[]) => [],
    });

    const result = check({ project: TSCONFIG, plugins: [suppressor] });
    const errors = result.diagnostics.filter((d) => d.category === 1);
    expect(errors).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });
});

describe("check() — plugin addition", () => {
  it("plugin can add diagnostics to a valid project", () => {
    const customDiag: ts.Diagnostic = {
      messageText: "Custom plugin error",
      category: 1, // Error
      code: 99999,
      file: undefined,
      start: undefined,
      length: undefined,
    };

    const adder = definePlugin({
      name: "adder",
      getSemanticDiagnostics: (_ctx: HookContext, prior: ts.Diagnostic[]) => [
        ...prior,
        customDiag,
      ],
    });

    const result = check({ project: TSCONFIG_ALT, plugins: [adder] });
    expect(result.diagnostics).toContain(customDiag);
    expect(result.exitCode).toBe(1);
  });
});

describe("check() — plugin error isolation", () => {
  it("hook that throws returns base diagnostics unchanged", () => {
    const crasher = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("plugin exploded");
      },
    });

    // Should not throw and should return base diagnostics
    const baseline = check({ project: TSCONFIG, plugins: [] });
    const withPlugin = check({ project: TSCONFIG, plugins: [crasher] });

    expect(withPlugin.diagnostics).toHaveLength(baseline.diagnostics.length);
    expect(withPlugin.exitCode).toBe(baseline.exitCode);
  });

  it("one bad plugin does not prevent other plugins from running", () => {
    const customDiag: ts.Diagnostic = {
      messageText: "From healthy plugin",
      category: 2, // Warning
      code: 99998,
      file: undefined,
      start: undefined,
      length: undefined,
    };

    const crasher = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("plugin exploded");
      },
    });

    const healthy = definePlugin({
      name: "healthy",
      getSemanticDiagnostics: (_ctx: HookContext, prior: ts.Diagnostic[]) => [
        ...prior,
        customDiag,
      ],
    });

    const result = check({ project: TSCONFIG_ALT, plugins: [crasher, healthy] });
    expect(result.diagnostics).toContain(customDiag);
  });
});

// ── Custom tsconfig path ──────────────────────────────────────────────────────

describe("check() — custom tsconfig", () => {
  it("uses the specified tsconfig path via options.project", () => {
    // tsconfig.alt.json only includes valid.ts, so no errors expected
    const result = check({ project: TSCONFIG_ALT, plugins: [] });
    expect(result.exitCode).toBe(0);
  });

  it("tsconfig.json (default with error file) produces errors", () => {
    const result = check({ project: TSCONFIG, plugins: [] });
    expect(result.exitCode).toBe(1);
  });
});

// ── Config error handling ─────────────────────────────────────────────────────

describe("check() — config errors", () => {
  it("throws when tsconfig.json does not exist", () => {
    expect(() =>
      check({ project: path.join(FIXTURE_DIR, "nonexistent.json"), plugins: [] }),
    ).toThrow();
  });

  it("error message mentions the missing file", () => {
    const missing = path.join(FIXTURE_DIR, "does-not-exist.json");
    expect(() => check({ project: missing, plugins: [] })).toThrow(
      expect.objectContaining({ message: expect.stringContaining("Cannot read tsconfig") }),
    );
  });
});

// ── Hook context ──────────────────────────────────────────────────────────────

describe("check() — hook context", () => {
  it("passes fileName, languageService, and typescript to each hook", () => {
    const received: Partial<HookContext>[] = [];

    const inspector = definePlugin({
      name: "inspector",
      getSemanticDiagnostics: (ctx: HookContext, prior: ts.Diagnostic[]) => {
        received.push({
          fileName: ctx.fileName,
          languageService: ctx.languageService,
          typescript: ctx.typescript,
        });
        return prior;
      },
    });

    check({ project: TSCONFIG_ALT, plugins: [inspector] });

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]?.fileName).toBeTruthy();
    expect(received[0]?.languageService).toBeDefined();
    expect(received[0]?.typescript).toBeDefined();
  });

  it("project is undefined in CLI context", () => {
    let capturedProject: ts.server.Project | undefined = undefined as ts.server.Project | undefined;

    const inspector = definePlugin({
      name: "inspector",
      getSemanticDiagnostics: (ctx: HookContext, prior: ts.Diagnostic[]) => {
        capturedProject = ctx.project;
        return prior;
      },
    });

    check({ project: TSCONFIG_ALT, plugins: [inspector] });
    expect(capturedProject).toBeUndefined();
  });
});
