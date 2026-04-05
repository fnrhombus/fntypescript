import { describe, it, expect, vi } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";
import { definePlugin } from "./define-plugin.js";
import { composeHook, createPluginLogger } from "./compose.js";
import type { HookContext } from "./types.js";

function makeMockLogger(): ts.server.Logger {
  return {
    close: vi.fn(),
    getLogFileName: vi.fn().mockReturnValue(""),
    hasLevel: vi.fn().mockReturnValue(false),
    loggingEnabled: vi.fn().mockReturnValue(true),
    perftrc: vi.fn(),
    info: vi.fn(),
    msg: vi.fn(),
    startGroup: vi.fn(),
    endGroup: vi.fn(),
  } as unknown as ts.server.Logger;
}

function makeMockProject(logger?: ts.server.Logger): ts.server.Project {
  return {
    projectService: {
      logger: logger ?? makeMockLogger(),
    },
  } as unknown as ts.server.Project;
}

function makeMockTypescript(): typeof ts {
  return {
    server: {
      Msg: { Err: "Err" },
    },
  } as unknown as typeof ts;
}

function makeMockProxy(
  overrides: Record<string, unknown> = {}
): ts.LanguageService {
  return {
    getSemanticDiagnostics: vi.fn().mockReturnValue([]),
    getCompletionsAtPosition: vi.fn().mockReturnValue({ entries: [] }),
    getQuickInfoAtPosition: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as ts.LanguageService;
}

function makeContext(
  proxy: ts.LanguageService,
  typescript: typeof ts,
  project: ts.server.Project,
  pluginName: string,
  args: unknown[]
): HookContext {
  return {
    fileName: args[0] as string,
    languageService: proxy,
    typescript,
    project,
    config: {},
    logger: createPluginLogger(
      pluginName,
      (project as unknown as { projectService: { logger: ts.server.Logger } }).projectService.logger,
      typescript
    ),
  };
}

describe("composeHook", () => {
  it("zero plugins — returns base service result unchanged", () => {
    const proxy = makeMockProxy({
      getSemanticDiagnostics: vi.fn().mockReturnValue([{ code: 1 }]),
    });
    const typescript = makeMockTypescript();
    const project = makeMockProject();

    const composed = composeHook(
      [],
      "getSemanticDiagnostics",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    const result = composed("file.ts");
    expect(result).toEqual([{ code: 1 }]);
  });

  it("single plugin with hook — appends diagnostic to base result", () => {
    const baseDiag = { code: 1 } as unknown as ts.Diagnostic;
    const pluginDiag = { code: 2 } as unknown as ts.Diagnostic;
    const proxy = makeMockProxy({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const typescript = makeMockTypescript();
    const project = makeMockProject();

    const plugin = definePlugin({
      name: "test-plugin",
      getSemanticDiagnostics(_ctx, prior, _fileName) {
        return [...prior, pluginDiag];
      },
    });

    const composed = composeHook(
      [plugin],
      "getSemanticDiagnostics",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    const result = composed("file.ts");
    expect(result).toEqual([baseDiag, pluginDiag]);
  });

  it("single plugin without the hook — returns base result unchanged", () => {
    const baseDiag = { code: 1 } as unknown as ts.Diagnostic;
    const proxy = makeMockProxy({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const typescript = makeMockTypescript();
    const project = makeMockProject();

    const plugin = definePlugin({ name: "no-hook-plugin" }); // no getSemanticDiagnostics

    const composed = composeHook(
      [plugin],
      "getSemanticDiagnostics",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    const result = composed("file.ts");
    expect(result).toEqual([baseDiag]);
  });

  it("two plugins with same hook — both run in order, result is base + A + B", () => {
    const baseDiag = { code: 0 } as unknown as ts.Diagnostic;
    const diagA = { code: 1 } as unknown as ts.Diagnostic;
    const diagB = { code: 2 } as unknown as ts.Diagnostic;
    const proxy = makeMockProxy({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const typescript = makeMockTypescript();
    const project = makeMockProject();

    const pluginA = definePlugin({
      name: "plugin-a",
      getSemanticDiagnostics(_ctx, prior) {
        return [...prior, diagA];
      },
    });
    const pluginB = definePlugin({
      name: "plugin-b",
      getSemanticDiagnostics(_ctx, prior) {
        return [...prior, diagB];
      },
    });

    const composed = composeHook(
      [pluginA, pluginB],
      "getSemanticDiagnostics",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    const result = composed("file.ts");
    expect(result).toEqual([baseDiag, diagA, diagB]);
  });

  it("two plugins with different hooks — each works independently", () => {
    const baseDiag = { code: 0 } as unknown as ts.Diagnostic;
    const diagA = { code: 1 } as unknown as ts.Diagnostic;
    const proxy = makeMockProxy({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const typescript = makeMockTypescript();
    const project = makeMockProject();

    const pluginA = definePlugin({
      name: "plugin-a",
      getSemanticDiagnostics(_ctx, prior) {
        return [...prior, diagA];
      },
    });
    const pluginB = definePlugin({
      name: "plugin-b",
      // only has getQuickInfoAtPosition, not getSemanticDiagnostics
      getQuickInfoAtPosition(_ctx, _prior) {
        return { kind: "keyword" } as unknown as ts.QuickInfo;
      },
    });

    const composed = composeHook(
      [pluginA, pluginB],
      "getSemanticDiagnostics",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    const result = composed("file.ts");
    expect(result).toEqual([baseDiag, diagA]);
  });

  it("hook receives correct context — fileName from first arg", () => {
    const proxy = makeMockProxy();
    const typescript = makeMockTypescript();
    const logger = makeMockLogger();
    const project = makeMockProject(logger);
    let capturedCtx: HookContext | undefined;

    const plugin = definePlugin({
      name: "ctx-test",
      getSemanticDiagnostics(ctx, prior) {
        capturedCtx = ctx;
        return prior;
      },
    });

    const composed = composeHook(
      [plugin],
      "getSemanticDiagnostics",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    composed("target-file.ts");

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.fileName).toBe("target-file.ts");
    expect(capturedCtx!.languageService).toBe(proxy);
    expect(capturedCtx!.typescript).toBe(typescript);
    expect(capturedCtx!.project).toBe(project);
  });

  it("throwing hook is isolated — returns prior result, error is logged", () => {
    const baseDiag = { code: 1 } as unknown as ts.Diagnostic;
    const proxy = makeMockProxy({
      getSemanticDiagnostics: vi.fn().mockReturnValue([baseDiag]),
    });
    const typescript = makeMockTypescript();
    const logger = makeMockLogger();
    const project = makeMockProject(logger);

    const plugin = definePlugin({
      name: "throwing-plugin",
      getSemanticDiagnostics() {
        throw new Error("hook exploded");
      },
    });

    const composed = composeHook(
      [plugin],
      "getSemanticDiagnostics",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    let result: unknown;
    expect(() => {
      result = composed("file.ts");
    }).not.toThrow();

    expect(result).toEqual([baseDiag]);
    expect(logger.msg).toHaveBeenCalled();
  });

  it("hook receives all original arguments — getCompletionsAtPosition gets position and options", () => {
    const proxy = makeMockProxy({
      getCompletionsAtPosition: vi.fn().mockReturnValue({ entries: [] }),
    });
    const typescript = makeMockTypescript();
    const project = makeMockProject();
    let capturedArgs: unknown[] | undefined;

    const plugin = definePlugin({
      name: "args-test",
      getCompletionsAtPosition(ctx, prior, fileName, position, options) {
        capturedArgs = [fileName, position, options];
        return prior;
      },
    });

    const composed = composeHook(
      [plugin],
      "getCompletionsAtPosition",
      (name, args) => makeContext(proxy, typescript, project, name, args),
      proxy
    );

    const opts = { triggerCharacter: "." } as ts.GetCompletionsAtPositionOptions;
    composed("myfile.ts", 42, opts);

    expect(capturedArgs).toEqual(["myfile.ts", 42, opts]);
  });
});

describe("createPluginLogger", () => {
  it("prefixes info messages with plugin name", () => {
    const logger = makeMockLogger();
    const typescript = makeMockTypescript();
    const pluginLogger = createPluginLogger("my-plugin", logger, typescript);

    pluginLogger.info("hello");

    expect(logger.info).toHaveBeenCalledWith("[my-plugin] hello");
  });

  it("prefixes error messages with plugin name", () => {
    const logger = makeMockLogger();
    const typescript = makeMockTypescript();
    const pluginLogger = createPluginLogger("my-plugin", logger, typescript);

    pluginLogger.error("something broke");

    expect(logger.msg).toHaveBeenCalledWith("[my-plugin] something broke", "Err");
  });
});
