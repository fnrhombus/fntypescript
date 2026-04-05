import { describe, it, expect, vi } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";
import { composeHook, createPluginLogger } from "./compose.js";
import { definePlugin } from "./define-plugin.js";
import type { HookContext } from "./types.js";

function makeBaseService(overrides: Record<string, unknown> = {}): ts.LanguageService {
  return {
    getSemanticDiagnostics: vi.fn().mockReturnValue([{ code: 1000 }]),
    getCompletionsAtPosition: vi.fn().mockReturnValue({ entries: [{ name: "base" }] }),
    getQuickInfoAtPosition: vi.fn().mockReturnValue({ kind: "keyword", kindModifiers: "", textSpan: { start: 0, length: 1 } }),
    ...overrides,
  } as unknown as ts.LanguageService;
}

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    fileName: "file.ts",
    languageService: makeBaseService(),
    typescript: {} as typeof ts,
    project: {} as ts.server.Project,
    config: {},
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe("composeHook", () => {
  it("returns baseMethod directly when no plugins define the hook (zero overhead)", () => {
    const base = makeBaseService();
    const baseMethod = base.getSemanticDiagnostics!.bind(base);
    const plugin = definePlugin({ name: "no-hooks" });

    const composed = composeHook(baseMethod, [plugin], "getSemanticDiagnostics", () => makeContext());

    expect(composed).toBe(baseMethod);
  });

  it("returns baseMethod directly with zero plugins", () => {
    const base = makeBaseService();
    const baseMethod = base.getSemanticDiagnostics!.bind(base);

    const composed = composeHook(baseMethod, [], "getSemanticDiagnostics", () => makeContext());

    expect(composed).toBe(baseMethod);
  });

  it("single plugin appends a diagnostic to the base result", () => {
    const baseDiag = { code: 1000 } as ts.Diagnostic;
    const pluginDiag = { code: 9999 } as ts.Diagnostic;
    const base = makeBaseService({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const baseMethod = (base.getSemanticDiagnostics as (...args: unknown[]) => unknown).bind(base);
    const plugin = definePlugin({
      name: "appender",
      getSemanticDiagnostics(_ctx, prior, _fileName) {
        return [...prior, pluginDiag];
      },
    });

    const composed = composeHook(
      baseMethod as (fileName: string) => ts.Diagnostic[],
      [plugin],
      "getSemanticDiagnostics",
      () => makeContext({ languageService: base }),
    );
    const result = composed("file.ts");

    expect(result).toEqual([baseDiag, pluginDiag]);
  });

  it("two plugins both appending diagnostics produces base + A + B in order", () => {
    const baseDiag = { code: 1000 } as ts.Diagnostic;
    const diagA = { code: 1001 } as ts.Diagnostic;
    const diagB = { code: 1002 } as ts.Diagnostic;
    const base = makeBaseService({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const baseMethod = (base.getSemanticDiagnostics as (...args: unknown[]) => unknown).bind(base);
    const pluginA = definePlugin({
      name: "plugin-a",
      getSemanticDiagnostics(_ctx, prior, _fileName) {
        return [...prior, diagA];
      },
    });
    const pluginB = definePlugin({
      name: "plugin-b",
      getSemanticDiagnostics(_ctx, prior, _fileName) {
        return [...prior, diagB];
      },
    });

    const composed = composeHook(
      baseMethod as (fileName: string) => ts.Diagnostic[],
      [pluginA, pluginB],
      "getSemanticDiagnostics",
      () => makeContext({ languageService: base }),
    );
    const result = composed("file.ts");

    expect(result).toEqual([baseDiag, diagA, diagB]);
  });

  it("two plugins with different hooks each work independently", () => {
    const baseDiag = { code: 1000 } as ts.Diagnostic;
    const pluginDiag = { code: 9999 } as ts.Diagnostic;
    const baseCompletion = { entries: [{ name: "base" }] } as unknown as ts.CompletionInfo;
    const pluginCompletion = { entries: [{ name: "plugin" }] } as unknown as ts.CompletionInfo;

    const base = makeBaseService({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
      getCompletionsAtPosition: vi.fn().mockReturnValue(baseCompletion),
    });

    const diagMethod = (base.getSemanticDiagnostics as (...args: unknown[]) => unknown).bind(base);
    const completionMethod = (base.getCompletionsAtPosition as (...args: unknown[]) => unknown).bind(base);

    const pluginA = definePlugin({
      name: "diag-plugin",
      getSemanticDiagnostics(_ctx, prior, _fileName) {
        return [...prior, pluginDiag];
      },
    });
    const pluginB = definePlugin({
      name: "completion-plugin",
      getCompletionsAtPosition(_ctx, _prior, _fileName, _pos, _opts) {
        return pluginCompletion;
      },
    });

    const composedDiag = composeHook(
      diagMethod as (fileName: string) => ts.Diagnostic[],
      [pluginA, pluginB],
      "getSemanticDiagnostics",
      () => makeContext({ languageService: base }),
    );
    const composedCompletion = composeHook(
      completionMethod as (fileName: string, pos: number, opts: undefined) => ts.CompletionInfo | undefined,
      [pluginA, pluginB],
      "getCompletionsAtPosition",
      () => makeContext({ languageService: base }),
    );

    expect(composedDiag("file.ts")).toEqual([baseDiag, pluginDiag]);
    expect(composedCompletion("file.ts", 0, undefined)).toBe(pluginCompletion);
  });

  it("hook receives correct context properties", () => {
    const capturedCtx: HookContext[] = [];
    const base = makeBaseService({
      getSemanticDiagnostics: vi.fn().mockReturnValue([]),
    });
    const baseMethod = (base.getSemanticDiagnostics as (...args: unknown[]) => unknown).bind(base);
    const mockProject = { projectName: "test" } as unknown as ts.server.Project;
    const mockTs = {} as typeof ts;
    const mockConfig = { key: "value" };
    const mockLogger = { info: vi.fn(), error: vi.fn() };

    const plugin = definePlugin({
      name: "ctx-checker",
      getSemanticDiagnostics(ctx, prior, _fileName) {
        capturedCtx.push(ctx);
        return prior;
      },
    });

    const ctx: HookContext = {
      fileName: "test.ts",
      languageService: base,
      typescript: mockTs,
      project: mockProject,
      config: mockConfig,
      logger: mockLogger,
    };

    const composed = composeHook(
      baseMethod as (fileName: string) => ts.Diagnostic[],
      [plugin],
      "getSemanticDiagnostics",
      () => ctx,
    );
    composed("test.ts");

    expect(capturedCtx[0]).toBe(ctx);
    expect(capturedCtx[0].languageService).toBe(base);
    expect(capturedCtx[0].typescript).toBe(mockTs);
    expect(capturedCtx[0].project).toBe(mockProject);
    expect(capturedCtx[0].config).toBe(mockConfig);
    expect(capturedCtx[0].logger).toBe(mockLogger);
  });

  it("throwing hook does not crash the service and returns prior", () => {
    const baseDiag = { code: 1000 } as ts.Diagnostic;
    const base = makeBaseService({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const baseMethod = (base.getSemanticDiagnostics as (...args: unknown[]) => unknown).bind(base);
    const mockLogger = { info: vi.fn(), error: vi.fn() };

    const plugin = definePlugin({
      name: "thrower",
      getSemanticDiagnostics(_ctx, _prior, _fileName) {
        throw new Error("boom");
      },
    });

    const composed = composeHook(
      baseMethod as (fileName: string) => ts.Diagnostic[],
      [plugin],
      "getSemanticDiagnostics",
      () => makeContext({ logger: mockLogger }),
    );
    const result = composed("file.ts");

    expect(result).toEqual([baseDiag]);
  });

  it("error from throwing hook is logged", () => {
    const base = makeBaseService({
      getSemanticDiagnostics: vi.fn().mockReturnValue([]),
    });
    const baseMethod = (base.getSemanticDiagnostics as (...args: unknown[]) => unknown).bind(base);
    const mockLogger = { info: vi.fn(), error: vi.fn() };

    const plugin = definePlugin({
      name: "thrower",
      getSemanticDiagnostics(_ctx, _prior, _fileName) {
        throw new Error("boom");
      },
    });

    const composed = composeHook(
      baseMethod as (fileName: string) => ts.Diagnostic[],
      [plugin],
      "getSemanticDiagnostics",
      () => makeContext({ logger: mockLogger }),
    );
    composed("file.ts");

    expect(mockLogger.error).toHaveBeenCalledOnce();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("hook receives all original arguments", () => {
    const capturedArgs: unknown[][] = [];
    const base = makeBaseService({
      getCompletionsAtPosition: vi.fn().mockReturnValue({ entries: [] }),
    });
    const baseMethod = (base.getCompletionsAtPosition as (...args: unknown[]) => unknown).bind(base);

    const plugin = definePlugin({
      name: "arg-checker",
      getCompletionsAtPosition(ctx, prior, fileName, position, options) {
        capturedArgs.push([ctx, prior, fileName, position, options]);
        return prior;
      },
    });

    const composed = composeHook(
      baseMethod as (fileName: string, position: number, options: undefined) => ts.CompletionInfo | undefined,
      [plugin],
      "getCompletionsAtPosition",
      () => makeContext({ languageService: base }),
    );
    composed("file.ts", 42, undefined);

    expect(capturedArgs[0][2]).toBe("file.ts");
    expect(capturedArgs[0][3]).toBe(42);
    expect(capturedArgs[0][4]).toBeUndefined();
  });
});

describe("createPluginLogger", () => {
  it("prefixes info messages with plugin name", () => {
    const serverLogger = {
      info: vi.fn(),
      msg: vi.fn(),
    } as unknown as ts.server.Logger;

    const logger = createPluginLogger("my-plugin", serverLogger);
    logger.info("hello");

    expect(serverLogger.info).toHaveBeenCalledWith("[fntypescript:my-plugin] hello");
  });

  it("prefixes error messages with plugin name", () => {
    const serverLogger = {
      info: vi.fn(),
      msg: vi.fn(),
    } as unknown as ts.server.Logger;

    const logger = createPluginLogger("my-plugin", serverLogger);
    logger.error("something broke");

    expect(serverLogger.msg).toHaveBeenCalledWith(
      "[fntypescript:my-plugin] ERROR: something broke",
      expect.anything(),
    );
  });
});
