/**
 * Tests for the composition engine and plugin logger behavior, exercised
 * through the create() path rather than testing internals directly.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";
import { definePlugin } from "fntypescript/define-plugin.js";
import type { HookContext, Plugin } from "fntypescript/types.js";

type InitModule = {
  create: (info: ts.server.PluginCreateInfo, plugins: Plugin[]) => ts.LanguageService;
};

let _init: InitModule;

beforeAll(async () => {
  const mod = await import("fntypescript");
  const init = (mod as unknown as { default: (m: { typescript: typeof ts }) => InitModule }).default;
  _init = init({ typescript: {} as typeof ts });
});

function getInit(): InitModule {
  return _init;
}

function makeMockServerLogger() {
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

function makeMockInfo(
  overrides: {
    semanticDiags?: ts.Diagnostic[];
    completions?: ts.CompletionInfo;
    config?: Record<string, unknown>;
    serverLogger?: ts.server.Logger;
  } = {},
): ts.server.PluginCreateInfo {
  const serverLogger = overrides.serverLogger ?? makeMockServerLogger();
  const baseDiags = overrides.semanticDiags ?? [];
  const baseCompletions = overrides.completions ?? { entries: [], isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };

  return {
    languageService: {
      getSemanticDiagnostics: vi.fn().mockReturnValue(baseDiags),
      getCompletionsAtPosition: vi.fn().mockReturnValue(baseCompletions),
      dispose: vi.fn(),
    } as unknown as ts.LanguageService,
    config: overrides.config ?? {},
    project: {
      projectService: {
        logger: serverLogger,
      },
    } as unknown as ts.server.Project,
    serverHost: {} as ts.server.ServerHost,
    languageServiceHost: {} as ts.LanguageServiceHost,
  };
}

function callSemanticDiags(proxy: ts.LanguageService, fileName = "file.ts"): ts.Diagnostic[] {
  return (proxy as unknown as Record<string, (...a: unknown[]) => ts.Diagnostic[]>)
    ["getSemanticDiagnostics"](fileName);
}

function callCompletions(proxy: ts.LanguageService, fileName = "file.ts", position = 0): ts.CompletionInfo {
  return (proxy as unknown as Record<string, (...a: unknown[]) => ts.CompletionInfo>)
    ["getCompletionsAtPosition"](fileName, position, undefined);
}

describe("composition via create()", () => {
  it("returns base result unchanged when no plugins provided", () => {
    const init = getInit();
    const baseDiag = makeDiag("base");
    const info = makeMockInfo({ semanticDiags: [baseDiag] });
    const proxy = init.create(info, []);
    const result = callSemanticDiags(proxy);
    expect(result).toEqual([baseDiag]);
  });

  it("returns base result unchanged when plugin does not define the hook", () => {
    const init = getInit();
    const baseDiag = makeDiag("base");
    const info = makeMockInfo({ semanticDiags: [baseDiag] });
    const plugin = definePlugin({ name: "no-hook" });
    const proxy = init.create(info, [plugin]);
    const result = callSemanticDiags(proxy);
    expect(result).toEqual([baseDiag]);
  });

  it("single plugin with getSemanticDiagnostics appends its diagnostic", () => {
    const init = getInit();
    const baseDiag = makeDiag("base");
    const pluginDiag = makeDiag("plugin");
    const info = makeMockInfo({ semanticDiags: [baseDiag] });
    const plugin = definePlugin({
      name: "appender",
      getSemanticDiagnostics: (_ctx, prior, _fileName) => [...prior, pluginDiag],
    });
    const proxy = init.create(info, [plugin]);
    const result = callSemanticDiags(proxy);
    expect(result).toEqual([baseDiag, pluginDiag]);
  });

  it("two plugins with the same hook compose in order (base + X + Y)", () => {
    const init = getInit();
    const baseDiag = makeDiag("base");
    const xDiag = makeDiag("x");
    const yDiag = makeDiag("y");
    const info = makeMockInfo({ semanticDiags: [baseDiag] });
    const pluginX = definePlugin({
      name: "x",
      getSemanticDiagnostics: (_ctx, prior, _fileName) => [...prior, xDiag],
    });
    const pluginY = definePlugin({
      name: "y",
      getSemanticDiagnostics: (_ctx, prior, _fileName) => [...prior, yDiag],
    });
    const proxy = init.create(info, [pluginX, pluginY]);
    const result = callSemanticDiags(proxy);
    expect(result).toEqual([baseDiag, xDiag, yDiag]);
  });

  it("plugin with only getCompletionsAtPosition does not affect getSemanticDiagnostics", () => {
    const init = getInit();
    const baseDiag = makeDiag("base");
    const info = makeMockInfo({ semanticDiags: [baseDiag] });
    const plugin = definePlugin({
      name: "completions-only",
      getCompletionsAtPosition: (_ctx, prior) => prior,
    });
    const proxy = init.create(info, [plugin]);
    const result = callSemanticDiags(proxy);
    expect(result).toEqual([baseDiag]);
  });

  it("two plugins with different hooks each work independently", () => {
    const init = getInit();
    const baseDiag = makeDiag("base");
    const pluginDiag = makeDiag("semantic");
    const baseCompletions = { entries: [], isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };
    const pluginCompletions = { entries: [{ name: "extra" } as ts.CompletionEntry], isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };

    const info = makeMockInfo({ semanticDiags: [baseDiag], completions: baseCompletions });

    const pluginA = definePlugin({
      name: "a",
      getSemanticDiagnostics: (_ctx, prior) => [...prior, pluginDiag],
    });
    const pluginB = definePlugin({
      name: "b",
      getCompletionsAtPosition: (_ctx, _prior) => pluginCompletions,
    });

    const proxy = init.create(info, [pluginA, pluginB]);
    expect(callSemanticDiags(proxy)).toEqual([baseDiag, pluginDiag]);
    expect(callCompletions(proxy)).toBe(pluginCompletions);
  });

  it("hook receives correct fileName from the call arguments", () => {
    const init = getInit();
    const receivedFileNames: string[] = [];
    const info = makeMockInfo();
    const plugin = definePlugin({
      name: "filename-checker",
      getSemanticDiagnostics: (ctx, prior, _fileName) => {
        receivedFileNames.push(ctx.fileName);
        return prior;
      },
    });
    const proxy = init.create(info, [plugin]);
    callSemanticDiags(proxy, "my-special-file.ts");
    expect(receivedFileNames).toEqual(["my-special-file.ts"]);
  });

  it("hook receives correct languageService, typescript, and project in context", () => {
    const init = getInit();
    const received: Partial<HookContext>[] = [];
    const info = makeMockInfo();
    const plugin = definePlugin({
      name: "ctx-checker",
      getSemanticDiagnostics: (ctx, prior) => {
        received.push({ languageService: ctx.languageService, typescript: ctx.typescript, project: ctx.project });
        return prior;
      },
    });
    const proxy = init.create(info, [plugin]);
    callSemanticDiags(proxy);
    expect(received).toHaveLength(1);
    expect(received[0].languageService).toBeDefined();
    expect(received[0].typescript).toBeDefined();
    expect(received[0].project).toBe(info.project);
  });

  it("hook that throws returns prior value without crashing", () => {
    const init = getInit();
    const baseDiag = makeDiag("base");
    const info = makeMockInfo({ semanticDiags: [baseDiag] });
    const plugin = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("hook exploded");
      },
    });
    const proxy = init.create(info, [plugin]);
    const result = callSemanticDiags(proxy);
    expect(result).toEqual([baseDiag]);
  });

  it("getCompletionsAtPosition hook receives all original args (ctx, prior, fileName, position, options)", () => {
    const init = getInit();
    const receivedArgs: unknown[] = [];
    const baseCompletions = { entries: [], isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false };
    const info = makeMockInfo({ completions: baseCompletions });
    const plugin = definePlugin({
      name: "arg-checker",
      getCompletionsAtPosition: (hookCtx, prior, fileName, position, options) => {
        receivedArgs.push(hookCtx, prior, fileName, position, options);
        return prior;
      },
    });
    const proxy = init.create(info, [plugin]);
    const opts = { triggerKind: 1 } as ts.GetCompletionsAtPositionOptions;
    (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)
      ["getCompletionsAtPosition"]("check.ts", 42, opts);

    expect(receivedArgs[1]).toBe(baseCompletions);
    expect(receivedArgs[2]).toBe("check.ts");
    expect(receivedArgs[3]).toBe(42);
    expect(receivedArgs[4]).toBe(opts);
  });
});

describe("per-plugin context via create()", () => {
  it("each plugin receives its own config slice from tsconfig plugins array", () => {
    const init = getInit();
    const receivedConfigs: Record<string, unknown>[] = [];
    const config = {
      plugins: [
        { name: "plugin-a", optionA: true },
        { name: "plugin-b", optionB: "hello" },
      ],
    };
    const info = makeMockInfo({ config });
    const pluginA = definePlugin({
      name: "plugin-a",
      getSemanticDiagnostics: (ctx, prior) => {
        receivedConfigs.push({ plugin: "a", config: ctx.config });
        return prior;
      },
    });
    const pluginB = definePlugin({
      name: "plugin-b",
      getSemanticDiagnostics: (ctx, prior) => {
        receivedConfigs.push({ plugin: "b", config: ctx.config });
        return prior;
      },
    });
    const proxy = init.create(info, [pluginA, pluginB]);
    callSemanticDiags(proxy);

    const configA = receivedConfigs.find((r) => r["plugin"] === "a")?.["config"] as Record<string, unknown>;
    const configB = receivedConfigs.find((r) => r["plugin"] === "b")?.["config"] as Record<string, unknown>;
    expect(configA?.["optionA"]).toBe(true);
    expect(configB?.["optionB"]).toBe("hello");
  });

  it("plugins do not share config — each gets only its own slice", () => {
    const init = getInit();
    const receivedConfigs: Record<string, Record<string, unknown>>[] = [];
    const config = {
      plugins: [
        { name: "plugin-a", secret: "for-a-only" },
        { name: "plugin-b", secret: "for-b-only" },
      ],
    };
    const info = makeMockInfo({ config });
    const pluginA = definePlugin({
      name: "plugin-a",
      getSemanticDiagnostics: (ctx, prior) => {
        receivedConfigs.push({ a: ctx.config as Record<string, unknown> });
        return prior;
      },
    });
    const pluginB = definePlugin({
      name: "plugin-b",
      getSemanticDiagnostics: (ctx, prior) => {
        receivedConfigs.push({ b: ctx.config as Record<string, unknown> });
        return prior;
      },
    });
    const proxy = init.create(info, [pluginA, pluginB]);
    callSemanticDiags(proxy);

    const configA = receivedConfigs.find((r) => "a" in r)?.["a"];
    const configB = receivedConfigs.find((r) => "b" in r)?.["b"];
    expect(configA?.["secret"]).toBe("for-a-only");
    expect(configB?.["secret"]).toBe("for-b-only");
    expect(configA).not.toBe(configB);
  });
});

describe("plugin logger via create()", () => {
  it("prefixes info messages with [fntypescript:pluginName]", () => {
    const init = getInit();
    const serverLogger = makeMockServerLogger();
    const info = makeMockInfo({ serverLogger });
    const plugin = definePlugin({
      name: "my-plugin",
      getSemanticDiagnostics: (ctx, prior) => {
        ctx.logger.info("hello from plugin");
        return prior;
      },
    });
    const proxy = init.create(info, [plugin]);
    callSemanticDiags(proxy);
    expect(serverLogger.info).toHaveBeenCalledWith("[fntypescript:my-plugin] hello from plugin");
  });

  it("prefixes error messages with [fntypescript:pluginName] ERROR:", () => {
    const init = getInit();
    const serverLogger = makeMockServerLogger();
    const info = makeMockInfo({ serverLogger });
    const plugin = definePlugin({
      name: "my-plugin",
      getSemanticDiagnostics: (ctx, prior) => {
        ctx.logger.error("something broke");
        return prior;
      },
    });
    const proxy = init.create(info, [plugin]);
    callSemanticDiags(proxy);
    expect(serverLogger.msg).toHaveBeenCalledWith(
      "[fntypescript:my-plugin] ERROR: something broke",
      expect.anything(),
    );
  });

  it("logs an error with plugin name when a hook throws", () => {
    const init = getInit();
    const serverLogger = makeMockServerLogger();
    const info = makeMockInfo({ serverLogger });
    const plugin = definePlugin({
      name: "crasher",
      getSemanticDiagnostics: () => {
        throw new Error("hook exploded");
      },
    });
    const proxy = init.create(info, [plugin]);
    callSemanticDiags(proxy);
    expect(serverLogger.msg).toHaveBeenCalledOnce();
    const [loggedMessage] = (serverLogger.msg as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(loggedMessage).toContain("[fntypescript:crasher]");
    expect(loggedMessage).toContain("hook exploded");
  });

  it("different plugins get different logger prefixes", () => {
    const init = getInit();
    const serverLogger = makeMockServerLogger();
    const info = makeMockInfo({ serverLogger });
    const pluginA = definePlugin({
      name: "plugin-a",
      getSemanticDiagnostics: (ctx, prior) => {
        ctx.logger.info("from a");
        return prior;
      },
    });
    const pluginB = definePlugin({
      name: "plugin-b",
      getSemanticDiagnostics: (ctx, prior) => {
        ctx.logger.info("from b");
        return prior;
      },
    });
    const proxy = init.create(info, [pluginA, pluginB]);
    callSemanticDiags(proxy);
    expect(serverLogger.info).toHaveBeenCalledWith("[fntypescript:plugin-a] from a");
    expect(serverLogger.info).toHaveBeenCalledWith("[fntypescript:plugin-b] from b");
  });
});
