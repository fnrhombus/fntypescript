import { describe, it, expect, vi } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";
import { composeHook, createPluginLogger } from "./compose.js";
import { definePlugin } from "./define-plugin.js";
import type { HookContext, Plugin } from "./types.js";

function makeMockLogger(): ts.server.Logger {
  return {
    info: vi.fn(),
    msg: vi.fn(),
    close: vi.fn(),
    loggingEnabled: vi.fn().mockReturnValue(true),
    perftrc: vi.fn(),
    startGroup: vi.fn(),
    endGroup: vi.fn(),
    getLogFileName: vi.fn().mockReturnValue(undefined),
  } as unknown as ts.server.Logger;
}

function makeMockContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    fileName: "file.ts",
    languageService: {} as ts.LanguageService,
    typescript: {} as typeof ts,
    project: {} as ts.server.Project,
    config: {},
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

function makeDiag(message: string): ts.Diagnostic {
  return {
    messageText: message,
    category: 1,
    code: 9999,
    file: undefined,
    start: undefined,
    length: undefined,
  } as ts.Diagnostic;
}

describe("composeHook", () => {
  it("returns baseMethod directly when no plugins define the hook", () => {
    const base = vi.fn().mockReturnValue([]);
    const ctx = makeMockContext();
    const composed = composeHook(base, [], "getSemanticDiagnostics", () => ctx);
    expect(composed).toBe(base);
  });

  it("returns base result unchanged when plugin does not define the hook", () => {
    const baseDiag = makeDiag("base");
    const base = vi.fn().mockReturnValue([baseDiag]);
    const ctx = makeMockContext();
    const plugin = definePlugin({ name: "no-hook" });
    const composed = composeHook(base, [plugin], "getSemanticDiagnostics", () => ctx);
    const result = composed("file.ts");
    expect(result).toEqual([baseDiag]);
  });

  it("single plugin with getSemanticDiagnostics appends its diagnostic", () => {
    const baseDiag = makeDiag("base");
    const pluginDiag = makeDiag("plugin");
    const base = vi.fn().mockReturnValue([baseDiag]);
    const ctx = makeMockContext();
    const plugin = definePlugin({
      name: "appender",
      getSemanticDiagnostics: (_ctx, prior, _fileName) => [...prior, pluginDiag],
    });
    const composed = composeHook(base, [plugin], "getSemanticDiagnostics", () => ctx);
    const result = composed("file.ts");
    expect(result).toEqual([baseDiag, pluginDiag]);
  });

  it("two plugins with the same hook compose in order (base + X + Y)", () => {
    const baseDiag = makeDiag("base");
    const xDiag = makeDiag("x");
    const yDiag = makeDiag("y");
    const base = vi.fn().mockReturnValue([baseDiag]);
    const ctx = makeMockContext();
    const pluginX = definePlugin({
      name: "x",
      getSemanticDiagnostics: (_ctx, prior, _fileName) => [...prior, xDiag],
    });
    const pluginY = definePlugin({
      name: "y",
      getSemanticDiagnostics: (_ctx, prior, _fileName) => [...prior, yDiag],
    });
    const composed = composeHook(base, [pluginX, pluginY], "getSemanticDiagnostics", () => ctx);
    const result = composed("file.ts");
    expect(result).toEqual([baseDiag, xDiag, yDiag]);
  });

  it("plugin with only getCompletionsAtPosition does not affect getSemanticDiagnostics", () => {
    const baseDiag = makeDiag("base");
    const base = vi.fn().mockReturnValue([baseDiag]);
    const ctx = makeMockContext();
    const plugin = definePlugin({
      name: "completions-only",
      getCompletionsAtPosition: (_ctx, prior) => prior,
    });
    const composed = composeHook(base, [plugin], "getSemanticDiagnostics", () => ctx);
    const result = composed("file.ts");
    expect(result).toEqual([baseDiag]);
  });

  it("two plugins with different hooks each work independently", () => {
    const baseDiag = makeDiag("base");
    const pluginDiag = makeDiag("semantic");
    const baseCompletions = { entries: [], isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };
    const pluginCompletions = { entries: [{ name: "extra" } as ts.CompletionEntry], isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };

    const pluginA = definePlugin({
      name: "a",
      getSemanticDiagnostics: (_ctx, prior) => [...prior, pluginDiag],
    });
    const pluginB = definePlugin({
      name: "b",
      getCompletionsAtPosition: (_ctx, _prior) => pluginCompletions,
    });

    const ctx = makeMockContext();
    const diagBase = vi.fn().mockReturnValue([baseDiag]);
    const completionsBase = vi.fn().mockReturnValue(baseCompletions);

    const composedDiags = composeHook(diagBase, [pluginA, pluginB], "getSemanticDiagnostics", () => ctx);
    const composedCompletions = composeHook(completionsBase, [pluginA, pluginB], "getCompletionsAtPosition", () => ctx);

    expect(composedDiags("file.ts")).toEqual([baseDiag, pluginDiag]);
    expect(composedCompletions("file.ts", 0, undefined)).toBe(pluginCompletions);
  });

  it("hook receives correct context (fileName, languageService, typescript, config, logger)", () => {
    const receivedCtx: HookContext[] = [];
    const base = vi.fn().mockReturnValue([]);
    const mockLanguageService = { dispose: vi.fn() } as unknown as ts.LanguageService;
    const mockTs = {} as typeof ts;
    const mockProject = {} as ts.server.Project;
    const mockConfig = { key: "value" };
    const ctx = makeMockContext({
      fileName: "ctx-test.ts",
      languageService: mockLanguageService,
      typescript: mockTs,
      project: mockProject,
      config: mockConfig,
    });
    const plugin = definePlugin({
      name: "ctx-checker",
      getSemanticDiagnostics: (hookCtx, prior) => {
        receivedCtx.push(hookCtx);
        return prior;
      },
    });
    const composed = composeHook(base, [plugin], "getSemanticDiagnostics", () => ctx);
    composed("ctx-test.ts");

    expect(receivedCtx).toHaveLength(1);
    expect(receivedCtx[0].fileName).toBe("ctx-test.ts");
    expect(receivedCtx[0].languageService).toBe(mockLanguageService);
    expect(receivedCtx[0].typescript).toBe(mockTs);
    expect(receivedCtx[0].project).toBe(mockProject);
    expect(receivedCtx[0].config).toBe(mockConfig);
    expect(receivedCtx[0].logger).toBeDefined();
  });

  it("hook that throws returns prior value without crashing", () => {
    const baseDiag = makeDiag("base");
    const base = vi.fn().mockReturnValue([baseDiag]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const ctx = makeMockContext({ logger });
    const plugin = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("hook exploded");
      },
    });
    const composed = composeHook(base, [plugin], "getSemanticDiagnostics", () => ctx);
    const result = composed("file.ts");
    expect(result).toEqual([baseDiag]);
  });

  it("logs an error when a hook throws", () => {
    const base = vi.fn().mockReturnValue([]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const ctx = makeMockContext({ logger });
    const plugin = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("hook exploded");
      },
    });
    const composed = composeHook(base, [plugin], "getSemanticDiagnostics", () => ctx);
    composed("file.ts");
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("zero plugins returns base method directly (pure passthrough)", () => {
    const base = vi.fn().mockReturnValue([]);
    const ctx = makeMockContext();
    const composed = composeHook(base, [], "getSemanticDiagnostics", () => ctx);
    expect(composed).toBe(base);
  });

  it("getCompletionsAtPosition hook receives all original args (ctx, prior, fileName, position, options)", () => {
    const receivedArgs: unknown[] = [];
    const baseCompletions = { entries: [], isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };
    const base = vi.fn().mockReturnValue(baseCompletions);
    const ctx = makeMockContext();
    const plugin = definePlugin({
      name: "arg-checker",
      getCompletionsAtPosition: (hookCtx, prior, fileName, position, options) => {
        receivedArgs.push(hookCtx, prior, fileName, position, options);
        return prior;
      },
    });
    const composed = composeHook(base, [plugin], "getCompletionsAtPosition", () => ctx);
    const opts = { triggerKind: 1 } as ts.GetCompletionsAtPositionOptions;
    composed("check.ts", 42, opts);

    expect(receivedArgs[1]).toBe(baseCompletions);
    expect(receivedArgs[2]).toBe("check.ts");
    expect(receivedArgs[3]).toBe(42);
    expect(receivedArgs[4]).toBe(opts);
  });
});

describe("createPluginLogger", () => {
  it("prefixes info messages with plugin name", () => {
    const serverLogger = makeMockLogger();
    const logger = createPluginLogger("my-plugin", serverLogger);
    logger.info("hello");
    expect(serverLogger.info).toHaveBeenCalledWith("[fntypescript:my-plugin] hello");
  });

  it("prefixes error messages with plugin name and ERROR:", () => {
    const serverLogger = makeMockLogger();
    const logger = createPluginLogger("my-plugin", serverLogger);
    logger.error("something broke");
    expect(serverLogger.msg).toHaveBeenCalledWith(
      "[fntypescript:my-plugin] ERROR: something broke",
      expect.anything()
    );
  });
});
