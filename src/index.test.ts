import { describe, it, expect, vi } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";

type PluginModule = {
  create: (info: ts.server.PluginCreateInfo) => ts.LanguageService;
  getExternalFiles: (project: ts.server.Project) => string[];
};

function makeInit(): typeof import("./index.js") {
  // Re-import fresh each time via dynamic require workaround
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./index.js") as typeof import("./index.js");
}

function makeMockLanguageService(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    getCompletionsAtPosition: vi.fn().mockReturnValue({ entries: [] }),
    getQuickInfoAtPosition: vi.fn().mockReturnValue({ kind: "keyword" }),
    dispose: vi.fn(),
    ...overrides,
  };
}

function makeMockInfo(
  overrides: Partial<{
    languageService: Record<string, unknown>;
    config: Record<string, unknown>;
  }> = {}
): ts.server.PluginCreateInfo {
  return {
    languageService: (overrides.languageService ?? makeMockLanguageService()) as unknown as ts.LanguageService,
    config: overrides.config ?? {},
    project: {} as ts.server.Project,
    serverHost: {} as ts.server.ServerHost,
    languageServiceHost: {} as ts.LanguageServiceHost,
  };
}

describe("init", () => {
  it("returns an object with create and getExternalFiles functions", async () => {
    const { default: init } = await import("./index.js");
    const plugin = init({ typescript: {} as typeof ts }) as unknown as PluginModule;

    expect(typeof plugin.create).toBe("function");
    expect(typeof plugin.getExternalFiles).toBe("function");
  });

  it("create returns a LanguageService proxy with callable methods", async () => {
    const { default: init } = await import("./index.js");
    const plugin = init({ typescript: {} as typeof ts }) as unknown as PluginModule;
    const mockService = makeMockLanguageService();
    const info = makeMockInfo({ languageService: mockService });

    const proxy = plugin.create(info);

    (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)[
      "getCompletionsAtPosition"
    ]("file.ts", 0, {});

    expect(mockService["getCompletionsAtPosition"]).toHaveBeenCalledOnce();
  });

  it("create proxy passes return values from the base service through", async () => {
    const { default: init } = await import("./index.js");
    const plugin = init({ typescript: {} as typeof ts }) as unknown as PluginModule;
    const returnValue = { entries: [{ name: "bar" }] };
    const mockService = makeMockLanguageService({
      getCompletionsAtPosition: vi.fn().mockReturnValue(returnValue),
    });
    const info = makeMockInfo({ languageService: mockService });

    const proxy = plugin.create(info);
    const result = (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)[
      "getCompletionsAtPosition"
    ]("file.ts", 0, {});

    expect(result).toBe(returnValue);
  });

  it("getExternalFiles returns an empty array", async () => {
    const { default: init } = await import("./index.js");
    const plugin = init({ typescript: {} as typeof ts }) as unknown as PluginModule;

    const result = plugin.getExternalFiles({} as ts.server.Project);

    expect(result).toEqual([]);
  });

  it("info.config is stored and retrievable via getStoredConfig", async () => {
    const { default: init } = await import("./index.js");
    const plugin = init({ typescript: {} as typeof ts }) as PluginModule & {
      getStoredConfig: (proxy: ts.LanguageService) => unknown;
    };
    const config = { tag: "stored" };
    const info = makeMockInfo({ config });

    const proxy = plugin.create(info);

    expect(plugin.getStoredConfig(proxy)).toBe(config);
  });

  it("info.config is stored per proxy without cross-contamination between create calls", async () => {
    const { default: init } = await import("./index.js");
    const plugin = init({ typescript: {} as typeof ts }) as PluginModule & {
      getStoredConfig: (proxy: ts.LanguageService) => unknown;
    };

    const infoA = makeMockInfo({ config: { tag: "a" } });
    const infoB = makeMockInfo({ config: { tag: "b" } });

    const proxyA = plugin.create(infoA);
    const proxyB = plugin.create(infoB);

    expect(plugin.getStoredConfig(proxyA)).toEqual({ tag: "a" });
    expect(plugin.getStoredConfig(proxyB)).toEqual({ tag: "b" });
  });
});
